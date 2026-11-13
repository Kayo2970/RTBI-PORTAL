import { NextResponse } from 'next/server';
import { mutateCollection } from '@/lib/server-db';
import { requireSession, invalidateAllSessionsForMember } from '@/lib/session';
import { getAccessLevelSettingsServer, isCentreHead } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

/**
 * Super User Admin Override: Request or cancel password reset requirement for a member.
 * When set to true, the member will be prompted to set up a new password upon entering
 * their email on the login page, without needing an OTP code.
 *
 * This just flips the mustSetupPassword flag (asks the member to choose their
 * own new password on next login) rather than setting a password directly, so
 * it's gated as the Centre-Head-can-request-reset action, not the Super-User-
 * only canSetMemberPassword action.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!(isCentreHead(actor, settings) || actor.tier === 1)) {
      return NextResponse.json({ error: 'You do not have permission to request a password reset for this member.' }, { status: 403 });
    }
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const mustReset = body.mustReset !== undefined ? Boolean(body.mustReset) : true;

    let memberFound = false;
    let memberName = '';
    let memberEmail = '';

    await mutateCollection('members', (current) =>
      (current || []).map((m: any) => {
        if (m.id === id) {
          memberFound = true;
          memberName = m.name;
          memberEmail = m.email;
          return {
            ...m,
            mustSetupPassword: mustReset,
          };
        }
        return m;
      })
    );

    if (!memberFound) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    }

    // Anyone already signed in (e.g. a phone that stayed logged in) would never reach the login prompt, so end their
    // sessions now: their next visit lands on the login page and asks for the new password.
    if (mustReset) await invalidateAllSessionsForMember(id);

    const actionText = mustReset
      ? `Super User requested password reset for member ${memberName} (${memberEmail}). Direct password setup without OTP enabled on login.`
      : `Super User cleared password reset request for member ${memberName} (${memberEmail}).`;

    await mutateCollection('auditLogs', (current) => [
      {
        id: `audit-${Date.now()}`,
        action: 'ADMIN_REQUESTED_PASSWORD_RESET',
        user: 'Super User',
        details: actionText,
        timestamp: new Date().toISOString(),
      },
      ...(current || []),
    ]);

    return NextResponse.json({
      success: true,
      mustSetupPassword: mustReset,
      message: mustReset
        ? `Password setup request set for ${memberName}. They will be prompted to set a new password on their next login attempt without OTP.`
        : `Password setup request cleared for ${memberName}.`,
    });
  } catch (err: any) {
    return apiError(err, 'members-id-require-password-reset-api-post', 500);
  }
}
