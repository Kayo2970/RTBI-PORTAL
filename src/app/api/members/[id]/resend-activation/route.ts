import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { createActivationTokenAndSendEmail } from '@/lib/account-activation';
import { requireSession } from '@/lib/session';
import { getAccessLevelSettingsServer, isCentreHead } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

/** Re-sends the "set up your account" welcome email for a member who hasn't activated yet. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!(isCentreHead(actor, settings) || actor.tier === 1)) {
      return NextResponse.json({ error: 'You do not have permission to resend the activation email.' }, { status: 403 });
    }
    const { id } = await params;
    const members = await readCollection('members');
    const member = members.find((m: any) => m.id === id);

    if (!member) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    }
    if (member.passwordHash) {
      return NextResponse.json({ error: 'This member already has an account — use Forgot Password from the login screen instead.' }, { status: 400 });
    }

    const host = request.headers.get('host');
    const proto = request.headers.get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https');
    const origin = request.headers.get('origin') || (host ? `${proto}://${host}` : undefined);

    const { activationLink, emailSent, emailError } = await createActivationTokenAndSendEmail({ id: member.id, name: member.name, email: member.email }, 'Super User', origin, request);
    return NextResponse.json({
      success: true,
      activationLink,
      emailSent,
      emailError,
      message: emailSent
        ? `Welcome email sent to ${member.email} with password setup link.`
        : `Could not deliver the welcome email to ${member.email} — the activation link below still works, so copy and send it to them directly.`,
    });
  } catch (err: any) {
    return apiError(err, 'members-id-resend-activation-api-post', 500);
  }
}
