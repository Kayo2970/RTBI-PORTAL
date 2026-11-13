import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { isSuperUser, canAccessGroupPoliciesServer, getAccessLevelSettingsServer } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    requirePermission(canAccessGroupPoliciesServer(actor, settings), 'Only Centre Head, Events Head (GG Campus), or Super User can view Group Policies.');
    const items = await readCollection('groupPolicies');
    return NextResponse.json(items);
  } catch (err: any) {
    return apiError(err, 'group-policies-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    requirePermission(canAccessGroupPoliciesServer(actor, settings), 'Only Centre Head, Events Head (GG Campus), or Super User can create Group Policies.');

    const item = await request.json();
    const updated = await mutateCollection('groupPolicies', (current) => {
      const idx = current.findIndex((p: any) => p.id === item.id);
      if (idx >= 0) {
        const copy = [...current];
        copy[idx] = item;
        return copy;
      }
      return [item, ...current];
    });
    const created = updated.find((p: any) => p.id === item.id) || item;

    // Dispatches group policy grant notification emails to targeted members (queued via 10-minute buffer)
    if (created && created.enabled !== false) {
      try {
        const { resolvePolicyRecipients, generateGroupPolicyGrantEmailTemplate, dispatchEmail } = await import('@/lib/email-service');
        const members = await readCollection('members');
        const recipients = resolvePolicyRecipients(created, members);
        for (const r of recipients) {
          const template = generateGroupPolicyGrantEmailTemplate(r.name, created, actor.name || 'Centre Administration');
          await dispatchEmail({
            to: r.email,
            subject: template.subject,
            bodyText: template.bodyText,
            bodyHtml: template.bodyHtml,
            category: 'GROUP_POLICY_GRANT',
            badgeText: 'Special Access Granted',
            badgeColor: created.expiresAt ? '#d97706' : '#6366f1',
          });
        }
      } catch (emailErr) {
        console.error('[group-policies-api-post] Failed to queue policy grant email:', emailErr);
      }
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'group-policies-api-post', 400);
  }
}
