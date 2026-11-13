import { NextResponse } from 'next/server';
import { testEmailConnection } from '@/lib/email-service';
import { requireSession, sessionErrorStatus } from '@/lib/session';
import { getAccessLevelSettingsServer, canManageEmailSettings } from '@/lib/permissions-server';

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canManageEmailSettings(actor, settings)) {
      return NextResponse.json({ success: false, message: 'You do not have permission to send test emails.' }, { status: 403 });
    }
    const body = await request.json();
    const { testRecipient, settings: smtpSettings } = body;

    if (!testRecipient) {
      return NextResponse.json({ error: 'Test recipient email is required' }, { status: 400 });
    }

    const result = await testEmailConnection(testRecipient, smtpSettings);
    return NextResponse.json(result);
  } catch (err: any) {
    const status = sessionErrorStatus(err);
    if (status) return NextResponse.json({ success: false, message: err.message }, { status });
    return NextResponse.json({ success: false, message: err?.message || 'SMTP Test failed' }, { status: 500 });
  }
}
