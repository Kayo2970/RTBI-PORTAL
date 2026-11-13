import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AUTO_EMAIL_TYPES, getEmailPolicy, updateEmailPolicy } from '@/lib/email-service';
import { requireSession } from '@/lib/session';
import { getAccessLevelSettingsServer, canManageEmailSettings } from '@/lib/permissions-server';
import { parseJsonBody } from '@/lib/validation';
import { apiError } from '@/lib/api-error';

/** Super-User switches for the portal's automatic emails: pause everything, or turn individual types on/off. */
async function view() {
  const policy = await getEmailPolicy();
  return {
    paused: policy.paused,
    updatedAt: policy.updatedAt,
    updatedBy: policy.updatedBy,
    types: AUTO_EMAIL_TYPES.map((t) => ({
      key: t.key,
      label: t.label,
      description: t.description,
      defaultEnabled: t.defaultEnabled,
      enabled: policy.overrides[t.key] ?? t.defaultEnabled,
    })),
  };
}

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canManageEmailSettings(actor, settings)) {
      return NextResponse.json({ error: 'You do not have permission to view email settings.' }, { status: 403 });
    }
    return NextResponse.json(await view());
  } catch (err: any) {
    return apiError(err, 'email-automatic-get', 500);
  }
}

const PolicySchema = z.object({
  paused: z.boolean().optional(),
  overrides: z.record(z.string(), z.boolean()).optional(),
}).strict();

export async function PUT(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canManageEmailSettings(actor, settings)) {
      return NextResponse.json({ error: 'You do not have permission to change email settings.' }, { status: 403 });
    }
    const body = await parseJsonBody(request, PolicySchema);
    await updateEmailPolicy(body, actor.name || 'Super User');
    return NextResponse.json(await view());
  } catch (err: any) {
    return apiError(err, 'email-automatic-put', 500);
  }
}
