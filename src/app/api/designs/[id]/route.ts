import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { deleteStoredFile, deleteStoredFilesForRecord, saveBase64File, readStoredFile } from '@/lib/file-storage';
import { cascadeCloseAutoApprovals, deleteLinkedApprovalRequests, fanOutAutoApproval } from '@/lib/approval-sync';
import { requireSession, ForbiddenError } from '@/lib/session';
import { getAccessLevelSettingsServer, canReviewDesignProofread, canViewAllDesigns, hasCap } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

/**
 * Builds a human-readable attachment filename ("<Design Title> - <Category>.<ext>")
 * for the design asset emailed to the Centre Head, instead of whatever raw
 * filename the designer's browser happened to upload it with (e.g. "IMG_20260921.jpg").
 * The original file extension is preserved so the attachment still opens correctly.
 */
function buildDesignAttachmentFileName(title: string, category: string, originalFileName?: string): string {
  const ext = originalFileName?.includes('.') ? originalFileName.slice(originalFileName.lastIndexOf('.')) : '';
  const safe = (s?: string) => (s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  const base = [safe(title) || 'Design', safe(category)].filter(Boolean).join(' - ');
  return `${base}${ext}` || (originalFileName || 'design-asset');
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const body = await request.json();

    // Two branches share this one merge-patch handler: a style-approve/reject
    // or proofread-review decision, vs a plain edit by the design's own
    // submitter. Gate each separately rather than one blanket check. Only an
    // actual decision value (Approved/Rejected/Changes Requested) counts as
    // a review action — a resubmission (replacing the file after "Changes
    // Requested"/"Style Rejected") resets styleStatus/review back to
    // pending as a side effect of updateDesignFile(), and that reset is the
    // owner editing their own submission, not a review decision, so it must
    // stay owner-editable rather than requiring reviewer permissions.
    const settings = await getAccessLevelSettingsServer();
    const existingDesigns = await readCollection<any>('designs');
    const existing = existingDesigns.find((d: any) => d.id === id);
    const isOwner = !!existing && actor.id === existing.designerId;
    const incomingStyleStatus = body.styleStatus;
    const incomingReviewStatus = body.review?.status;
    const isReviewAction = incomingStyleStatus === 'Style Approved' || incomingStyleStatus === 'Style Rejected'
      || incomingReviewStatus === 'Proofread Approved' || incomingReviewStatus === 'Changes Requested';
    if (isReviewAction) {
      const isStyleAction = incomingStyleStatus === 'Style Approved' || incomingStyleStatus === 'Style Rejected';
      // A Group Policy DESIGN_STYLE_APPROVE grant lets someone approve/reject on the Style Review step
      if (!canReviewDesignProofread(actor, settings, existing) && !(isStyleAction && hasCap(actor, 'DESIGN_STYLE_APPROVE'))) throw new ForbiddenError();
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
    let justProofreadApproved = false;
    let justProofreadRejected = false;
    let justCaptionApproved = false;
    let justResubmittedAfterStyleRejection = false;
    let justResubmittedAfterProofreadRejection = false;
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
      const previousStyleStatus = next[idx].styleStatus;
      const wasStyleApproved = previousStyleStatus === 'Style Approved';
      const wasStyleRejected = previousStyleStatus === 'Style Rejected';
      const previousReviewStatus = next[idx].review?.status;
      const wasProofreadApproved = previousReviewStatus === 'Proofread Approved';
      const wasProofreadRejected = previousReviewStatus === 'Changes Requested';
      const wasCaptionApproved = next[idx].captionStatus === 'approved';
      const merged = { ...next[idx], ...body };
      if (!wasStyleApproved && merged.styleStatus === 'Style Approved') {
        justStyleApproved = true;
      }
      if (!wasStyleRejected && merged.styleStatus === 'Style Rejected') {
        justStyleRejected = true;
      }
      if (!wasProofreadApproved && merged.review?.status === 'Proofread Approved') {
        justProofreadApproved = true;
      }
      if (!wasProofreadRejected && merged.review?.status === 'Changes Requested') {
        justProofreadRejected = true;
      }
      if (!wasCaptionApproved && merged.captionStatus === 'approved') {
        justCaptionApproved = true;
      }
      // The designer resubmitting (updateDesignFile() resets styleStatus/
      // review back to pending when replacing the file) after an earlier
      // rejection — this is what should notify the same reviewers who
      // rejected it, same as a brand-new submission notifies them.
      if (wasStyleRejected && merged.styleStatus === 'Pending') {
        justResubmittedAfterStyleRejection = true;
      }
      if (wasProofreadRejected && merged.review?.status === 'Pending Proofread') {
        justResubmittedAfterProofreadRejection = true;
      }
      next[idx] = merged;
      mergedRecord = merged;
      return next;
    });

    // Best-effort cleanup of the file just replaced, so old assets don't
    // accumulate on disk under a different filename than the new one.
    if (previousStorageKey) {
      await deleteStoredFile(previousStorageKey);
    }

    // Resolve any still-pending fan-out rows this design's submission raised
    // in the Approvals module — whichever of the Centre Head/Advisor/GG
    // Campus Events Head made this style decision resolves it everywhere.
    if (justStyleApproved || justStyleRejected) {
      try {
        await cascadeCloseAutoApprovals('design', id, justStyleApproved ? 'approved' : 'rejected', mergedRecord?.styleDecidedBy);
      } catch (approvalErr) {
        console.error('[designs-api] Approval cascade-close failed:', approvalErr);
      }
    }

    // Same cascade-close for the proofread decision — whichever of the Centre
    // Head/Advisor/GG Campus Events Head approved or requested changes resolves
    // the pending fan-out for the other two panel members as well.
    if (justProofreadApproved || justProofreadRejected) {
      try {
        await cascadeCloseAutoApprovals('design', id, justProofreadApproved ? 'approved' : 'rejected', mergedRecord?.review?.proofreaderName);
      } catch (approvalErr) {
        console.error('[designs-api] Proofread approval cascade-close failed:', approvalErr);
      }
    }

    // Notify the designer who submitted the file directly, every time a
    // proofread or style decision is recorded against their own submission —
    // approve or reject alike — so they always know what happened to their
    // work without having to check the dashboard. This fires independently
    // of (and in addition to) the approver-facing emails below.
    if ((justProofreadApproved || justProofreadRejected || justStyleApproved || justStyleRejected) && mergedRecord?.designerEmail) {
      try {
        const { dispatchEmail, generateDesignDecisionEmailTemplate } = await import('@/lib/email-service');
        const stage: 'Proofreading' | 'Style Approval' = (justProofreadApproved || justProofreadRejected) ? 'Proofreading' : 'Style Approval';
        const approved = justProofreadApproved || justStyleApproved;
        const decidedByName = stage === 'Proofreading'
          ? (mergedRecord?.review?.proofreaderName || 'the Proofreading Desk')
          : (mergedRecord?.styleDecidedBy || 'the Design Head');
        const comments = stage === 'Proofreading' ? mergedRecord?.review?.comments : mergedRecord?.styleFeedback;

        const template = generateDesignDecisionEmailTemplate(
          mergedRecord.title || 'Design',
          mergedRecord.designerName || 'Designer',
          stage,
          approved,
          decidedByName,
          comments
        );

        const log = await dispatchEmail({
          to: mergedRecord.designerEmail,
          subject: template.subject,
          bodyText: template.bodyText,
          bodyHtml: template.bodyHtml,
          category: 'DESIGN_APPROVAL',
        });

        await mutateCollection('designs', (current) => (current || []).map((d: any) =>
          d.id === id ? { ...d, designerDecisionEmailSent: log.status === 'SENT' || log.status === 'BUFFERED', designerDecisionEmailError: log.errorMessage } : d
        ));
        mergedRecord = { ...mergedRecord, designerDecisionEmailSent: log.status === 'SENT' || log.status === 'BUFFERED', designerDecisionEmailError: log.errorMessage };
      } catch (emailErr: any) {
        console.error('[designs-api] Designer decision email dispatch failed:', emailErr);
        const message = emailErr?.message || 'Failed to notify the designer of the review decision.';
        await mutateCollection('designs', (current) => (current || []).map((d: any) =>
          d.id === id ? { ...d, designerDecisionEmailSent: false, designerDecisionEmailError: message } : d
        ));
        mergedRecord = { ...mergedRecord, designerDecisionEmailSent: false, designerDecisionEmailError: message };
      }
    }

    // Once Style Approved — by the Centre Head, Advisor, or GG Campus Head of
    // Events (see the isCentreHead(user)/isDesignHead(user) gate in
    // dashboard/designs/page.tsx, which already treats Advisor as Centre
    // Head) — email the design asset as an attachment to all three, using
    // each member's own registered email address (Member.email, collected at
    // account activation/registration — see findApprovalRecipients).
    if (justStyleApproved && mergedRecord?.storageKey) {
      try {
        const [members, { dispatchEmail, generateDesignApprovedEmailTemplate, findApprovalRecipients }] = await Promise.all([
          readCollection('members'),
          import('@/lib/email-service'),
        ]);
        const recipients = findApprovalRecipients(members as any[]);
        const to = [recipients.centreHead?.email, recipients.advisor?.email, recipients.eventsHeadGg?.email].filter(Boolean) as string[];

        if (to.length > 0) {
          const fileBuffer = await readStoredFile(mergedRecord.storageKey);
          const template = generateDesignApprovedEmailTemplate(
            mergedRecord.title || 'Design',
            mergedRecord.designerName || 'Designer',
            mergedRecord.submittedAt,
            mergedRecord.styleDecidedBy || 'the Design Head'
          );

          const log = await dispatchEmail({
            to: to.join(','),
            subject: template.subject,
            bodyText: template.bodyText,
            bodyHtml: template.bodyHtml,
            category: 'DESIGN_APPROVAL',
            attachments: [{
              filename: buildDesignAttachmentFileName(mergedRecord.title, mergedRecord.category, mergedRecord.fileName),
              content: fileBuffer,
            }],
          });

          await mutateCollection('designs', (current) => (current || []).map((d: any) =>
            d.id === id ? { ...d, styleApprovalEmailSent: log.status === 'SENT' || log.status === 'BUFFERED', styleApprovalEmailError: log.errorMessage } : d
          ));
          mergedRecord = { ...mergedRecord, styleApprovalEmailSent: log.status === 'SENT' || log.status === 'BUFFERED', styleApprovalEmailError: log.errorMessage };
        } else {
          const noRecipientsMsg = 'No Centre Head, Advisor, or GG Campus Head of Events found in the Directory to send the approved design to.';
          await mutateCollection('designs', (current) => (current || []).map((d: any) =>
            d.id === id ? { ...d, styleApprovalEmailSent: false, styleApprovalEmailError: noRecipientsMsg } : d
          ));
          mergedRecord = { ...mergedRecord, styleApprovalEmailSent: false, styleApprovalEmailError: noRecipientsMsg };
        }
      } catch (emailErr: any) {
        console.error('[designs-api] Style-approval email dispatch failed:', emailErr);
        const message = emailErr?.message || 'Failed to send the approved design email.';
        await mutateCollection('designs', (current) => (current || []).map((d: any) =>
          d.id === id ? { ...d, styleApprovalEmailSent: false, styleApprovalEmailError: message } : d
        ));
        mergedRecord = { ...mergedRecord, styleApprovalEmailSent: false, styleApprovalEmailError: message };
      }
    }

    // Once captions are approved — by the Centre Head, Advisor, or GG Campus
    // Head of Events (see reviewDesignCaptions in local-data.ts) — email the
    // design asset plus the approved caption text to all three, same
    // recipient resolution as the style-approval email above.
    if (justCaptionApproved) {
      try {
        const [members, { dispatchEmail, generateCaptionsApprovedEmailTemplate, findApprovalRecipients }] = await Promise.all([
          readCollection('members'),
          import('@/lib/email-service'),
        ]);
        const recipients = findApprovalRecipients(members as any[]);
        const to = [recipients.centreHead?.email, recipients.advisor?.email, recipients.eventsHeadGg?.email].filter(Boolean) as string[];

        if (to.length > 0) {
          const template = generateCaptionsApprovedEmailTemplate(
            mergedRecord.title || 'Design',
            mergedRecord.designerName || 'Designer',
            mergedRecord.approvedInstagramCaption,
            mergedRecord.approvedLinkedinCaption
          );
          const attachments = mergedRecord.storageKey
            ? [{ filename: mergedRecord.fileName || 'design-asset', content: await readStoredFile(mergedRecord.storageKey) }]
            : undefined;

          const log = await dispatchEmail({
            to: to.join(','),
            subject: template.subject,
            bodyText: template.bodyText,
            bodyHtml: template.bodyHtml,
            category: 'DESIGN_APPROVAL',
            attachments,
          });

          await mutateCollection('designs', (current) => (current || []).map((d: any) =>
            d.id === id ? { ...d, captionApprovalEmailSent: log.status === 'SENT' || log.status === 'BUFFERED', captionApprovalEmailError: log.errorMessage } : d
          ));
          mergedRecord = { ...mergedRecord, captionApprovalEmailSent: log.status === 'SENT' || log.status === 'BUFFERED', captionApprovalEmailError: log.errorMessage };
        } else {
          const noRecipientsMsg = 'No Centre Head, Advisor, or GG Campus Head of Events found in the Directory to send the approved captions to.';
          await mutateCollection('designs', (current) => (current || []).map((d: any) =>
            d.id === id ? { ...d, captionApprovalEmailSent: false, captionApprovalEmailError: noRecipientsMsg } : d
          ));
          mergedRecord = { ...mergedRecord, captionApprovalEmailSent: false, captionApprovalEmailError: noRecipientsMsg };
        }
      } catch (emailErr: any) {
        console.error('[designs-api] Caption-approval email dispatch failed:', emailErr);
        const message = emailErr?.message || 'Failed to send the approved captions email.';
        await mutateCollection('designs', (current) => (current || []).map((d: any) =>
          d.id === id ? { ...d, captionApprovalEmailSent: false, captionApprovalEmailError: message } : d
        ));
        mergedRecord = { ...mergedRecord, captionApprovalEmailSent: false, captionApprovalEmailError: message };
      }
    }

    // A resubmission after "Changes Requested" or "Style Rejected" — the
    // designer replacing the file per updateDesignFile()'s pending-reset
    // above — re-notifies the same reviewers who rejected it the first
    // time, the same way POST notifies them on a brand-new submission:
    // faculty proofreaders for a proofread resubmission, and the Centre
    // Head/Advisor/GG Campus Head of Events panel for a style resubmission.
    // Re-fanning the approval out is idempotent and safe even though
    // cascadeCloseAutoApprovals already closed the earlier rejected rows.
    if (justResubmittedAfterProofreadRejection || justResubmittedAfterStyleRejection) {
      try {
        const [{ dispatchEmail, generateDesignResubmittedEmailTemplate, findApprovalRecipients }, { getAppBaseUrl }] = await Promise.all([
          import('@/lib/email-service'),
          import('@/lib/app-url'),
        ]);
        const baseUrl = getAppBaseUrl(request);
        const designLink = `${baseUrl}/dashboard/designs?highlight=${id}`;
        const designTitle = mergedRecord?.title || 'Design';
        const designerName = mergedRecord?.designerName || 'A designer';

        if (justResubmittedAfterProofreadRejection) {
          let proofreaders: { id: string; name: string; email: string; role?: string }[] = [];
          if (Array.isArray(mergedRecord?.assignedProofreaders) && mergedRecord.assignedProofreaders.length > 0) {
            proofreaders = mergedRecord.assignedProofreaders;
          } else if (Array.isArray(mergedRecord?.assignedProofreaderIds) && mergedRecord.assignedProofreaderIds.length > 0) {
            const allMembers = await readCollection<any>('members');
            proofreaders = mergedRecord.assignedProofreaderIds
              .map((pid: string) => allMembers.find((m: any) => m.id === pid))
              .filter((m: any): m is any => Boolean(m && m.email))
              .map((m: any) => ({ id: m.id, name: m.name, email: m.email, role: m.role }));
          } else if (mergedRecord?.assignedProofreaderEmail) {
            proofreaders = [{
              id: mergedRecord.assignedProofreaderId || mergedRecord.assignedProofreaderEmail,
              name: mergedRecord.assignedProofreaderName || 'Faculty Proofreader',
              email: mergedRecord.assignedProofreaderEmail,
            }];
          }

          if (proofreaders.length > 0) {
            await fanOutAutoApproval({
              entityType: 'design',
              entityId: id,
              entityTitle: designTitle,
              eventId: mergedRecord?.eventId,
              requesterId: mergedRecord?.designerId || '',
              requesterName: designerName,
              requesterEmail: mergedRecord?.designerEmail,
              message: 'This design was revised and resubmitted after your proofread feedback — please take another look.',
              customPanel: proofreaders.map((f) => ({ id: f.id, name: f.name, email: f.email, label: f.role || 'Faculty Proofreader' })),
            });

            const template = generateDesignResubmittedEmailTemplate(designTitle, designerName, 'Proofreading', designLink);
            for (const f of proofreaders) {
              if (!f.email) continue;
              await dispatchEmail({ to: f.email, subject: template.subject, bodyText: template.bodyText, bodyHtml: template.bodyHtml, category: 'SYSTEM' });
            }
          }
        }

        if (justResubmittedAfterStyleRejection) {
          const members = await readCollection('members');
          const recipients = findApprovalRecipients(members as any[]);
          const panel = [recipients.centreHead, recipients.advisor, recipients.eventsHeadGg].filter((m): m is { name: string; email: string } => Boolean(m?.email));

          if (panel.length > 0) {
            await fanOutAutoApproval({
              entityType: 'design',
              entityId: id,
              entityTitle: designTitle,
              eventId: mergedRecord?.eventId,
              requesterId: mergedRecord?.designerId || '',
              requesterName: designerName,
              requesterEmail: mergedRecord?.designerEmail,
              message: 'This design was revised and resubmitted after style feedback — please take another look.',
            });

            const template = generateDesignResubmittedEmailTemplate(designTitle, designerName, 'Style Approval', designLink);
            await dispatchEmail({
              to: panel.map((m) => m.email).join(','),
              subject: template.subject,
              bodyText: template.bodyText,
              bodyHtml: template.bodyHtml,
              category: 'SYSTEM',
            });
          }
        }
      } catch (emailErr) {
        console.error('[designs-api] Resubmission notification failed:', emailErr);
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
