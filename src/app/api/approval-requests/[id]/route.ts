import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { getAccessLevelSettingsServer, isCentreHead } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { getAppBaseUrl } from '@/lib/app-url';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const updates = await request.json();

    // The route previously trusted whatever the client sent with no check at
    // all that the caller was the intended approver — decideApprovalRequest()
    // in local-data.ts never even sends a "who decided this" identity field
    // in the body (there's no decidedBy on ApprovalRequest); the record's own
    // targetMemberId/targetMemberEmail is the only source of truth for who is
    // allowed to decide it, so that's what's checked here, against the
    // resolved session actor rather than anything client-supplied.
    const isDecideAction = updates.status === 'approved' || updates.status === 'rejected';
    let existing: any = null;
    if (isDecideAction) {
      existing = (await readCollection<any>('approvalRequests')).find((r: any) => r.id === id);
      const settings = await getAccessLevelSettingsServer();
      const isTargetMember = !!(
        existing &&
        ((actor.id && existing.targetMemberId && actor.id === existing.targetMemberId) ||
          (actor.email &&
            existing.targetMemberEmail &&
            String(actor.email).toLowerCase() === String(existing.targetMemberEmail).toLowerCase()))
      );
      requirePermission(
        isTargetMember || isCentreHead(actor, settings) || actor.tier === 1,
        'Only the member this request was sent to can approve or reject it.'
      );
    }

    const updated = await mutateCollection('approvalRequests', (current) => {
      const idx = current.findIndex((item: any) => item.id === id);
      if (idx === -1) return [...current, { id, ...updates }];
      const next = [...current];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });

    const updatedRecord = updated.find((r: any) => r.id === id);

    if (isDecideAction && existing) {
      try {
        let requesterEmail = existing.requesterEmail || updatedRecord?.requesterEmail;
        let requesterName = existing.requesterName || updatedRecord?.requesterName || 'Member';
        if (!requesterEmail && existing.requesterId) {
          const members = await readCollection<any>('members');
          const mem = members.find((m: any) => m.id === existing.requesterId);
          if (mem) {
            requesterEmail = mem.email;
            requesterName = mem.name || requesterName;
          }
        }

        if (requesterEmail) {
          const { dispatchEmail, generateApprovalDecisionEmailTemplate } = await import('@/lib/email-service');
          const decidedByName = updates.decidedBy || actor.name || 'Reviewer';
          const comments = updates.decisionNote || updates.decisionReason || updatedRecord?.decisionNote;
          const template = generateApprovalDecisionEmailTemplate(
            requesterName,
            existing.entityTitle || 'Request',
            existing.entityType || 'request',
            updates.status === 'approved',
            decidedByName,
            comments
          );
          await dispatchEmail({
            to: requesterEmail,
            subject: template.subject,
            bodyText: template.bodyText,
            bodyHtml: template.bodyHtml,
            category: 'APPROVAL_REQUEST',
          });
        }
      } catch (emailErr) {
        console.error('[approval-requests-api] Decision email notification failed:', emailErr);
      }
    }

    return NextResponse.json(updatedRecord);
  } catch (err: any) {
    return apiError(err, 'approval-requests-id-api-patch', 400);
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
    const existing = (await readCollection<any>('approvalRequests')).find((r: any) => r.id === id);
    const isRequester = !!(
      existing &&
      ((actor.id && existing.requesterId && actor.id === existing.requesterId) ||
        (actor.email &&
          existing.requesterEmail &&
          String(actor.email).toLowerCase() === String(existing.requesterEmail).toLowerCase()))
    );
    requirePermission(
      isRequester || isCentreHead(actor, settings) || actor.tier === 1,
      'You do not have permission to withdraw this approval request.'
    );

    let found = false;
    await mutateCollection('approvalRequests', (current) => {
      const filtered = current.filter((r: any) => r.id !== id);
      found = filtered.length < current.length;
      return filtered;
    });
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'approval-requests-id-api-delete', 500);
  }
}
