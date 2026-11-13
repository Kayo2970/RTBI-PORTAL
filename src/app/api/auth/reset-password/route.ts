import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { hashPassword } from '@/lib/password';
import { invalidateAllSessionsForMember } from '@/lib/session';
import { recordAuthFailure, recordAuthSuccess } from '@/lib/rate-limit';
import { parseJsonBody } from '@/lib/validation';
import { apiError } from '@/lib/api-error';

const ResetPasswordSchema = z.object({
  email: z.string().trim().min(1).max(254).email(),
  otp: z.string().trim().min(4).max(12),
  newPassword: z.string().min(4).max(256),
}).strict();

export async function POST(request: Request) {
  try {
    const { email, otp, newPassword } = await parseJsonBody(request, ResetPasswordSchema);
    const trimmedEmail = email.trim().toLowerCase();
    const resets = await readCollection('passwordResets');
    const matchedReset = resets.find((r: any) => r.email === trimmedEmail && r.otp === otp.trim());

    if (!matchedReset) {
      recordAuthFailure(trimmedEmail);
      return NextResponse.json({ error: 'Invalid verification code. Please check your email and try again.' }, { status: 400 });
    }
    recordAuthSuccess(trimmedEmail);

    // 5-minute validity check
    const now = Date.now();
    if (now > matchedReset.expiresAt) {
      return NextResponse.json(
        { error: 'The 5-minute verification code has expired. Please request a new password reset code.' },
        { status: 400 }
      );
    }

    // Update user password in database
    let memberUpdated = false;
    let memberName = 'User';
    let memberId = '';

    await mutateCollection('members', (current) => {
      return (current || []).map((m: any) => {
        if (m.email.toLowerCase() === trimmedEmail) {
          memberUpdated = true;
          memberName = m.name;
          memberId = m.id;
          return {
            ...m,
            passwordHash: hashPassword(newPassword),
            // Completing a self-service reset satisfies any pending admin-requested
            // reset too — otherwise mustSetupPassword stays true, the "Reset Pending"
            // badge never clears in the directory, and login keeps routing them back
            // through "set up your password" (see activate-account/route.ts for the
            // same fix on the activation-link path).
            mustSetupPassword: false,
          };
        }
        return m;
      });
    });

    if (!memberUpdated) {
      return NextResponse.json({ error: 'Account not found in registered members database.' }, { status: 404 });
    }

    // Remove used reset token
    await mutateCollection('passwordResets', (current) => {
      return (current || []).filter((r: any) => r.id !== matchedReset.id);
    });

    // Add Audit Log Entry
    const auditLog = {
      id: `audit-${Date.now()}`,
      action: 'PASSWORD_RESET',
      user: memberName,
      actorName: memberName,
      actorEmail: trimmedEmail,
      details: `Password reset successfully via 5-minute OTP for email ${trimmedEmail}`,
      timestamp: new Date().toISOString(),
    };
    await mutateCollection('auditLogs', (current) => [auditLog, ...(current || [])]);

    // A stolen/still-logged-in session shouldn't survive a password reset.
    if (memberId) await invalidateAllSessionsForMember(memberId);

    return NextResponse.json({
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.',
    });
  } catch (err: any) {
    return apiError(err, 'reset-password-api');
  }
}
