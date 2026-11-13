import { NextResponse } from 'next/server';
import { getEmailSettings, updateEmailSettings } from '@/lib/email-service';
import { requireSession } from '@/lib/session';
import { getAccessLevelSettingsServer, canManageEmailSettings } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { clampBlur, isEmailBackgroundKey } from '@/lib/email-background';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canManageEmailSettings(actor, settings)) {
      return NextResponse.json({ error: 'You do not have permission to view email settings.' }, { status: 403 });
    }
    const emailSettings = await getEmailSettings();
    return NextResponse.json(emailSettings);
  } catch (err: any) {
    return apiError(err, 'email-settings-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canManageEmailSettings(actor, settings)) {
      return NextResponse.json({ error: 'You do not have permission to update email settings.' }, { status: 403 });
    }
    const body = await request.json();
    const { settings: newSettings, actorName } = body;

    if (!newSettings) {
      return NextResponse.json({ error: 'Settings payload is required' }, { status: 400 });
    }

    // The mail background is only ever a picture uploaded through /api/email/background, with a bounded blur.
    if ('background' in newSettings) {
      const bg = newSettings.background;
      newSettings.background = bg && isEmailBackgroundKey(bg.storageKey)
        ? { enabled: bg.enabled !== false, storageKey: bg.storageKey, blur: clampBlur(bg.blur) }
        : undefined;
    }
    const updated = await updateEmailSettings(newSettings, actorName || 'Super User');
    return NextResponse.json(updated);
  } catch (err: any) {
    return apiError(err, 'email-settings-api-post', 500);
  }
}
