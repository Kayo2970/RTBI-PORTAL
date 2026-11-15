import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { deleteStoredFile, deleteStoredFilesForRecord, saveBase64File } from '@/lib/file-storage';
import { cascadeCloseAutoApprovals, deleteLinkedApprovalRequests, fanOutAutoApproval, getDefaultApproverIds } from '@/lib/approval-sync';
import { requireSession, ForbiddenError } from '@/lib/session';
import { getAccessLevelSettingsServer, canViewAllDesigns, hasCap } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const body = await request.json();

    // Two branches share this one merge-patch handler: an approve/reject
    // decision by a reviewer, vs a plain edit by the design's own submitter.
    // A resubmission (replacing the file after a rejection) resets styleStatus
    // back to pending as a side effect of updateDesignFile(); that is the
    // owner editing their own submission, not a review decision.
    const settings = await getAccessLevelSettingsServer();
    const existingDesigns = await readCollection<any>('designs');
    const existing = existingDesigns.find((d: any) => d.id === id);
    const isOwner = !!existing && actor.id === existing.designerId;
    const incomingStyleStatus = body.styleStatus;
    const isReviewAction = incomingStyleStatus === 'Style Approved' || incomingStyleStatus === 'Style Rejected';
    if (isReviewAction) {
      // Reviewers: Super User / CEO tiers, the chosen default approvers, or a
      // Group Policy DESIGN_STYLE_APPROVE grant.
      const approverIds = await getDefaultApproverIds();
      const isReviewer = actor.tier <= 2 || approverIds.includes(actor.id) || hasCap(actor, 'DESIGN_STYLE_APPROVE');
      if (!isReviewer) throw new ForbiddenError();
    } else if (!isOwner && !canViewAllDesigns(actor, settings)) {
      throw new ForbiddenError();
    }

    // A replaced file arrives the same way a brand-new submission's does —
    // a base64 data URL — so it needs the same on-disk treatment POST gives
    // it, not a blind merge that would poison designs.json with raw bytes.
    let previousStorageKey: string | undefined;
    if (typeof body.fileData === 'string' && body.fileData.startsWith('data:')) {
      const stored = await saveBase64File('designs', id, 0, body.fileName || 'file', body.fileData);
      body.fileUrl = stored.url;
      body.storageKey = stored.storageKey;
      body.fileSize = stored.size;
      delete body.fileData;
    }

    let justStyleApproved = false;
    let justStyleRejected = false;
    let justResubmittedAfterRejection = false;
    let mergedRecord: any = null;

    // Upsert: if this id isn't in the server's collection yet (e.g. client-bundled
    // sample/seed data never POSTed), create it instead of silently dropping the
    // edit — same fix already applied to every other collection's [id] route.
    const updated = await mutateCollection('designs', (current) => {
      const idx = current.findIndex((d: any) => d.id === id);
      if (idx === -1) return [...current, { id, ...body }];
      const next = [...current];
      if (body.storageKey && next[idx].storageKey && next[idx].storageKey !== body.storageKey) {
        previousStorageKey = next[idx].storageKey;
      }
      const wasStyleRejected = next[idx].styleStatus === 'Style Rejected';
      const wasStyleApproved = next[idx].styleStatus === 'Style Approved';
      const merged = { ...next[idx], ...body };
      if (!wasStyleApproved && merged.styleStatus === 'Style Approved') justStyleApproved = true;
      if (!wasStyleRejected && merged.styleStatus === 'Style Rejected') justStyleRejected = true;
      // The designer replacing the file after a rejection resets the status to
      // pending and should re-notify the reviewers.
      if (wasStyleRejected && merged.styleStatus === 'Pending') justResubmittedAfterRejection = true;
      next[idx] = merged;
      mergedRecord = merged;
      return next;
    });

    // Best-effort cleanup of the file just replaced, so old assets don't
    // accumulate on disk under a different filename than the new one.
    if (previousStorageKey) {
      await deleteStoredFile(previousStorageKey);
    }

    // Resolve any still-pending fan-out rows this design raised in the
    // Approvals module: whichever reviewer decided resolves it for everyone.
    if (justStyleApproved || justStyleRejected) {
      try {
        await cascadeCloseAutoApprovals('design', id, justStyleApproved ? 'approved' : 'rejected', mergedRecord?.styleDecidedBy);
      } catch (approvalErr) {
        console.error('[designs-api] Approval cascade-close failed:', approvalErr);
      }
    }

    // Notify the designer of the decision (gated by the Design decision email
    // switch, which is off by default).
    if ((justStyleApproved || justStyleRejected) && mergedRecord?.designerEmail) {
      try {
        const { dispatchEmail, generateDesignDecisionEmailTemplate } = await import('@/lib/email-service');
        const template = generateDesignDecisionEmailTemplate(
          mergedRecord.title || 'Design',
          mergedRecord.designerName || 'Designer',
          justStyleApproved,
          mergedRecord?.styleDecidedBy || 'the reviewer',
          mergedRecord?.styleFeedback
        );
        const log = await dispatchEmail({
          to: mergedRecord.designerEmail,
          subject: template.subject,
          bodyText: template.bodyText,
          bodyHtml: template.bodyHtml,
          category: 'DESIGN_APPROVAL',
        });
        const sent = log.status === 'SENT' || log.status === 'BUFFERED';
        await mutateCollection('designs', (current) => (current || []).map((d: any) =>
          d.id === id ? { ...d, designerDecisionEmailSent: sent, designerDecisionEmailError: log.errorMessage } : d
        ));
        mergedRecord = { ...mergedRecord, designerDecisionEmailSent: sent, designerDecisionEmailError: log.errorMessage };
      } catch (emailErr: any) {
        console.error('[designs-api] Designer decision email dispatch failed:', emailErr);
        const message = emailErr?.message || 'Failed to notify the designer of the review decision.';
        await mutateCollection('designs', (current) => (current || []).map((d: any) =>
          d.id === id ? { ...d, designerDecisionEmailSent: false, designerDecisionEmailError: message } : d
        ));
        mergedRecord = { ...mergedRecord, designerDecisionEmailSent: false, designerDecisionEmailError: message };
      }
    }

    // A resubmission after a rejection re-notifies the reviewers, the same way
    // a brand-new submission does.
    if (justResubmittedAfterRejection) {
      try {
        await fanOutAutoApproval({
          entityType: 'design',
          entityId: id,
          entityTitle: mergedRecord?.title || 'Design',
          eventId: mergedRecord?.eventId,
          requesterId: mergedRecord?.designerId || '',
          requesterName: mergedRecord?.designerName || 'A designer',
          requesterEmail: mergedRecord?.designerEmail,
          message: 'This design was revised and resubmitted after your feedback — please take another look.',
        });
      } catch (approvalErr) {
        console.error('[designs-api] Resubmission approval fan-out failed:', approvalErr);
      }
    }

    return NextResponse.json(mergedRecord || updated.find((d: any) => d.id === id));
  } catch (err: any) {
    return apiError(err, 'designs-id-api-patch', 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const settings = await getAccessLevelSettingsServer();
    const existingDesigns = await readCollection<any>('designs');
    const existing = existingDesigns.find((d: any) => d.id === id);
    const isOwner = !!existing && actor.id === existing.designerId;
    if (!isOwner && !canViewAllDesigns(actor, settings) && actor.tier !== 1 && !hasCap(actor, 'DESIGN_DELETE')) {
      throw new ForbiddenError();
    }
    const updated = await mutateCollection('designs', (current) =>
      current.filter((d: any) => d.id !== id)
    );
    await deleteStoredFilesForRecord('designs', id);
    await deleteLinkedApprovalRequests('design', id);
    return NextResponse.json({ success: true, count: updated.length });
  } catch (err: any) {
    return apiError(err, 'designs-id-api-delete', 500);
  }
}
