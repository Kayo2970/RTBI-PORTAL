import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { dispatchEmail, wrapInMasterEmailTemplate } from '@/lib/email-service';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { getAccessLevelSettingsServer } from '@/lib/permissions-server';
import { visibleApprovalRequestsFor } from '@/lib/forms-visibility';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    const items = await readCollection<any>('approvalRequests');
    return NextResponse.json(visibleApprovalRequestsFor(items, await readCollection<any>('forms'), actor, settings));
  } catch (err: any) {
    return apiError(err, 'approval-requests-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    // Any signed-in member may ask another member to approve something they
    // own/created; the target member's own consent is enforced at decide time.
    await requireSession(request);
    const item = await request.json();
    const updated = await mutateCollection('approvalRequests', (current) => {
      const idx = current.findIndex((r: any) => r.id === item.id);
      if (idx >= 0) {
        const copy = [...current];
        copy[idx] = item;
        return copy;
      }
      return [item, ...current];
    });
    const created = updated.find((r: any) => r.id === item.id);

    if (created?.targetMemberEmail) {
      try {
        const entityLabelMap: Record<string, string> = {
          task: 'Task',
          committee: 'Committee',
          event: 'Event',
          member: 'Member',
          design: 'Design',
          'event-report': 'Event Report',
          announcement: 'Announcement',
        };
        const entityLabel = entityLabelMap[created.entityType] || 'Event';
        const { getAppBaseUrl } = await import('@/lib/app-url');
        const baseUrl = getAppBaseUrl(request);

        let targetLink = `${baseUrl}/dashboard/approvals?id=${created.id}&entityId=${created.entityId || ''}`;
        if (created.entityType === 'event' && created.entityId) {
          targetLink = `${baseUrl}/dashboard/events/${created.entityId}`;
        } else if (created.entityType === 'task' && created.entityId) {
          targetLink = `${baseUrl}/dashboard/tasks?highlight=${created.entityId}`;
        } else if (created.entityType === 'design' && created.entityId) {
          targetLink = `${baseUrl}/dashboard/designs?highlight=${created.entityId}`;
        } else if (created.entityType === 'event-report' && created.entityId) {
          targetLink = `${baseUrl}/dashboard/event-reports?highlight=${created.entityId}`;
        }

        const bodyHtml = `
          <p style="margin-top: 0; color: #0f172a; font-size: 14px;">Hello <strong>${created.targetMemberName || 'there'}</strong>,</p>
          <p style="color: #334155; font-size: 14px; line-height: 1.6;"><strong>${created.requesterName}</strong> is asking you to approve the following <strong>${entityLabel.toLowerCase()}</strong>:</p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #d97706; padding: 14px 18px; border-radius: 8px; margin: 18px 0;">
            <p style="margin: 0; font-weight: 700; font-size: 15px; color: #0f172a;">${created.entityTitle}</p>
            ${created.message ? `<p style="margin: 8px 0 0 0; color: #475569; font-size: 13px;">"${created.message}"</p>` : ''}
          </div>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${targetLink}" target="_blank" style="display: inline-block; background: #0284c7; color: #ffffff; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 10px; text-decoration: none;">
              Open & Review ${entityLabel} &rarr;
            </a>
          </div>
          <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin-bottom: 0;">If the button does not open, copy and paste this link into your browser:<br /><span style="word-break: break-all; color: #0284c7;">${targetLink}</span></p>
        `;
        await dispatchEmail({
          to: created.targetMemberEmail,
          subject: `Approval requested: ${created.entityTitle}`,
          bodyText: `${created.requesterName} is asking you to approve the ${entityLabel.toLowerCase()} "${created.entityTitle}". Review here: ${targetLink}`,
          bodyHtml: wrapInMasterEmailTemplate({
            pageTitle: `Approval requested: ${created.entityTitle}`,
            headerTitle: 'Approval Requested',
            headerSubtitle: `${entityLabel} sign-off needed`,
            badgeText: 'ACTION NEEDED',
            badgeColor: '#d97706',
            bodyContentHtml: bodyHtml,
          }),
          badgeText: 'ACTION NEEDED',
          badgeColor: '#d97706',
          category: 'APPROVAL_REQUEST',
        });
      } catch (emailErr) {
        console.error('[approval-requests-api] Failed to send notification email:', emailErr);
      }
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'approval-requests-api-post', 400);
  }
}
