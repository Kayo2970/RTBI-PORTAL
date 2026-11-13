import { NextResponse } from 'next/server';
import { mutateCollection } from '@/lib/server-db';
import { hashPassword } from '@/lib/password';
import { requireSession, invalidateAllSessionsForMember } from '@/lib/session';
import { canSetMemberPassword } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

/**
 * Super User Admin Override: directly set a member's password. Unlike
 * require-password-reset (which just flags the account so the member sets their
 * own password on next login), this takes effect immediately — the member can log
 * in with the new password right away, and mustSetupPassword is cleared since a
 * real password is already in place.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    if (!canSetMemberPassword(actor)) {
      return NextResponse.json({ error: 'You do not have permission to set this member\'s password directly.' }, { status: 403 });
    }
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const actorName = typeof body.actorName === 'string' && body.actorName.trim() ? body.actorName.trim() : 'Super User';

    if (newPassword.length < 4) {
      return NextResponse.json({ error: 'New password must be at least 4 characters long.' }, { status: 400 });
    }

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
            passwordHash: hashPassword(newPassword),
            mustSetupPassword: false,
          };
        }
        return m;
      })
    );

    if (!memberFound) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    }

    // Clean up any stale OTP-based reset tokens for this member — the password is
    // now set directly, so an old token should not be usable to reset it again.
    await mutateCollection('passwordResets', (current) =>
      (current || []).filter((r: any) => r.email?.toLowerCase() !== memberEmail.toLowerCase())
    );

    await mutateCollection('auditLogs', (current) => [
      {
        id: `audit-${Date.now()}`,
        action: 'ADMIN_SET_PASSWORD_OVERRIDE',
        user: actorName,
        details: `${actorName} directly set a new password for ${memberName} (${memberEmail}) via Super User override.`,
        timestamp: new Date().toISOString(),
      },
      ...(current || []),
    ]);

    // Kill any existing session for this account — they'll need to sign in
    // again with the new password.
    await invalidateAllSessionsForMember(id);

    return NextResponse.json({
      success: true,
      message: `Password updated for ${memberName}. They can log in immediately with the new password.`,
    });
  } catch (err: any) {
    return apiError(err, 'members-id-set-password-api-post', 500);
  }
}
