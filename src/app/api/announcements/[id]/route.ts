import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { dispatchAnnouncementEmails } from '@/lib/announcement-email';
import { cascadeCloseAutoApprovals, deleteLinkedApprovalRequests } from '@/lib/approval-sync';
import { requireSession, ForbiddenError } from '@/lib/session';
import { getAccessLevelSettingsServer, canCreateAnnouncement, canApproveAnnouncement, isCentreHead, hasCapabilityServer } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const updates = await request.json();
    const settings = await getAccessLevelSettingsServer();

    // The approve/reject decision (status flipping to Approved/Rejected) is
    // gated separately from a plain pre-approval edit by the author.
    const isApprovalAction = updates.status === 'Approved' || updates.status === 'Rejected';
    if (isApprovalAction) {
      if (!canApproveAnnouncement(actor, settings)) throw new ForbiddenError();
    } else {
      const existingAnnouncements = await readCollection<any>('announcements');
      const existing = existingAnnouncements.find((a: any) => a.id === id);
      const isAuthor = !!existing && actor.id === existing.authorId;
      if (!isAuthor && !canCreateAnnouncement(actor, settings)) throw new ForbiddenError();
    }

    let isNewlyApproved = false;
    let isNewlyRejected = false;

    const updated = await mutateCollection('announcements', (current) => {
      const idx = current.findIndex((item: any) => item.id === id);
      if (idx === -1) return [...current, { id, ...updates }];

      const existing = current[idx];
      if (updates.status === 'Approved' && existing.status !== 'Approved' && !existing.emailSent) {
        isNewlyApproved = true;
      }
      if (updates.status === 'Rejected' && existing.status !== 'Rejected') {
        isNewlyRejected = true;
      }

      const next = [...current];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });

    const targetAnnouncement = updated.find((a: any) => a.id === id);

    // If Centre Head just approved the announcement, send automatic emails NOW!
    if (targetAnnouncement && (isNewlyApproved || (targetAnnouncement.status === 'Approved' && !targetAnnouncement.emailSent))) {
      await dispatchAnnouncementEmails(targetAnnouncement);
    }

    if (targetAnnouncement && (isNewlyApproved || isNewlyRejected)) {
      try {
        await cascadeCloseAutoApprovals('announcement', id, isNewlyApproved ? 'approved' : 'rejected', targetAnnouncement.approvedBy || targetAnnouncement.rejectedBy);
      } catch (approvalErr) {
        console.error('[announcements-api] Approval cascade-close failed:', approvalErr);
      }
    }

    return NextResponse.json(targetAnnouncement);
  } catch (err: any) {
    return apiError(err, 'announcements-id-api-patch', 400);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!isCentreHead(actor, settings) && actor.tier !== 1 && !(await hasCapabilityServer(actor, 'DELETE_ANNOUNCEMENT'))) {
      throw new ForbiddenError();
    }
    const { id } = await params;
    let found = false;
    await mutateCollection('announcements', (current) => {
      const filtered = current.filter((a: any) => a.id !== id);
      found = filtered.length < current.length;
      return filtered;
    });
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await deleteLinkedApprovalRequests('announcement', id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'announcements-id-api-delete', 500);
  }
}
