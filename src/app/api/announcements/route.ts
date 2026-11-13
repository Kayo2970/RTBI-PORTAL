import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { dispatchAnnouncementEmails } from '@/lib/announcement-email';
import { fanOutAutoApproval } from '@/lib/approval-sync';
import { requireSession, ForbiddenError } from '@/lib/session';
import { getAccessLevelSettingsServer, canCreateAnnouncement } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

export async function GET(request: Request) {
  try {
    await requireSession(request);
    const items = await readCollection('announcements');
    return NextResponse.json(items);
  } catch (err: any) {
    return apiError(err, 'announcements-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canCreateAnnouncement(actor, settings)) throw new ForbiddenError();
    const item = await request.json();
    const updated = await mutateCollection('announcements', (current) => [item, ...current]);
    const created = updated.find((a: any) => a.id === item.id);

    // Dispatch emails ONLY if created directly with status 'Approved' (e.g. by Centre Head)
    if (created && created.status === 'Approved') {
      await dispatchAnnouncementEmails(created);
    }

    // An announcement created as 'Pending Approval' needs sign-off from the
    // Centre Head, Advisor, or GG Campus Events Head — fan that out to the
    // Approvals module.
    if (created && created.status === 'Pending Approval') {
      try {
        await fanOutAutoApproval({
          entityType: 'announcement',
          entityId: created.id,
          entityTitle: created.title,
          requesterId: created.authorId || '',
          requesterName: created.authorName || 'A member',
          requesterEmail: created.authorEmail,
          message: 'This announcement needs approval before it is published.',
        });
      } catch (approvalErr) {
        console.error('[announcements-api] Approval fan-out failed:', approvalErr);
      }
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'announcements-api-post', 400);
  }
}
