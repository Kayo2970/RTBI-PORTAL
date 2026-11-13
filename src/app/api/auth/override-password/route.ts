import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { hashPassword } from '@/lib/password';
import { createSession, invalidateAllSessionsForMember } from '@/lib/session';
import { parseJsonBody } from '@/lib/validation';
import { apiError } from '@/lib/api-error';

const OverridePasswordSchema = z.object({
  email: z.string().trim().min(1).max(254).email(),
  newPassword: z.string().min(4).max(256),
}).strict();

/**
 * Super User Admin Override: Consume admin override and set member's new password directly without OTP.
 */
export async function POST(request: Request) {
  try {
    const { email, newPassword } = await parseJsonBody(request, OverridePasswordSchema);
    const trimmedEmail = email.trim().toLowerCase();
    const members = await readCollection('members');
    const member = members.find((m: any) => m.email.toLowerCase() === trimmedEmail);

    if (!member) {
      return NextResponse.json({ error: 'Account not found in registered database.' }, { status: 404 });
    }

    if (!member.mustSetupPassword) {
      return NextResponse.json(
        { error: 'Admin override password setup is not active for this account. Use normal login or OTP reset.' },
        { status: 400 }
      );
    }

    let updatedUserRecord: any = null;

    await mutateCollection('members', (current) =>
      (current || []).map((m: any) => {
        if (m.email.toLowerCase() === trimmedEmail) {
          const updated = {
            ...m,
            passwordHash: hashPassword(newPassword),
            mustSetupPassword: false,
          };
          updatedUserRecord = updated;
          return updated;
        }
        return m;
      })
    );

    if (!updatedUserRecord) {
      return NextResponse.json({ error: 'Failed to update user password.' }, { status: 500 });
    }

    // Clean up any stale reset tokens for this user
    await mutateCollection('passwordResets', (current) =>
      (current || []).filter((r: any) => r.email !== trimmedEmail)
    );

    // Audit Log Entry
    await mutateCollection('auditLogs', (current) => [
      {
        id: `audit-${Date.now()}`,
        action: 'ADMIN_OVERRIDE_PASSWORD_RESET',
        user: updatedUserRecord.name,
        actorName: updatedUserRecord.name,
        actorEmail: trimmedEmail,
        details: `${updatedUserRecord.name} (${trimmedEmail}) successfully set a new password via Super User admin override (no OTP required).`,
        timestamp: new Date().toISOString(),
      },
      ...(current || []),
    ]);

    // Strip passwordHash before returning session user object
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...safeUser } = updatedUserRecord;
    await invalidateAllSessionsForMember(updatedUserRecord.id);
    const token = await createSession(updatedUserRecord.id);

    return NextResponse.json({
      success: true,
      user: safeUser,
      token,
      message: 'New password set successfully! Signing you in...',
    });
  } catch (err: any) {
    return apiError(err, 'override-password-api');
  }
}
