import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { dispatchEmail } from '@/lib/email-service';
import { requireSession } from '@/lib/session';
import { getAccessLevelSettingsServer, canManageEmailSettings } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canManageEmailSettings(actor, settings)) {
      return NextResponse.json({ error: 'You do not have permission to view email logs.' }, { status: 403 });
    }
    const emails = await readCollection('emails');
    return NextResponse.json(emails);
  } catch (err: any) {
    return apiError(err, 'email-api-get');
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canManageEmailSettings(actor, settings)) {
      return NextResponse.json({ error: 'You do not have permission to send this email.' }, { status: 403 });
    }
    const body = await request.json();
    if (!body.to || !body.subject || !body.bodyText) {
      return NextResponse.json({ error: 'to, subject, and bodyText are required.' }, { status: 400 });
    }

    const emailLog = await dispatchEmail({
      to: body.to,
      subject: body.subject,
      bodyText: body.bodyText,
      bodyHtml: body.bodyHtml,
      category: body.category || 'SYSTEM',
    });

    return NextResponse.json(emailLog, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'email-api-post');
  }
}
