import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { isSuperUser, canAccessGroupPoliciesServer, getAccessLevelSettingsServer } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    requirePermission(canAccessGroupPoliciesServer(actor, settings), 'Only Centre Head, Events Head (GG Campus), or Super User can update Group Policies.');

    const { id } = await params;
    const updates = await request.json();
    const updated = await mutateCollection('groupPolicies', (current) => {
      const idx = current.findIndex((item: any) => item.id === id);
      if (idx === -1) return [...current, { id, ...updates }];
      const next = [...current];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });
    const saved = updated.find((p: any) => p.id === id);

    // If enabled and targeting changed or updated, notify recipients (queued via 10-minute buffer)
    if (saved && saved.enabled !== false) {
      try {
        const { resolvePolicyRecipients, generateGroupPolicyGrantEmailTemplate, dispatchEmail } = await import('@/lib/email-service');
        const members = await readCollection('members');
        const recipients = resolvePolicyRecipients(saved, members);
        for (const r of recipients) {
          const template = generateGroupPolicyGrantEmailTemplate(r.name, saved, actor.name || 'Centre Administration');
          await dispatchEmail({
            to: r.email,
            subject: template.subject,
            bodyText: template.bodyText,
            bodyHtml: template.bodyHtml,
            category: 'GROUP_POLICY_GRANT',
            badgeText: 'Special Access Granted',
            badgeColor: saved.expiresAt ? '#d97706' : '#6366f1',
          });
        }
      } catch (emailErr) {
        console.error('[group-policies-id-api-patch] Failed to queue policy grant email:', emailErr);
      }
    }

    return NextResponse.json(saved);
  } catch (err: any) {
    return apiError(err, 'group-policies-id-api-patch', 400);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    requirePermission(canAccessGroupPoliciesServer(actor, settings), 'Only Centre Head, Events Head (GG Campus), or Super User can delete Group Policies.');

    const { id } = await params;
    let found = false;
    await mutateCollection('groupPolicies', (current) => {
      const filtered = current.filter((p: any) => p.id !== id);
      found = filtered.length < current.length;
      return filtered;
    });
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'group-policies-id-api-delete', 500);
  }
}
