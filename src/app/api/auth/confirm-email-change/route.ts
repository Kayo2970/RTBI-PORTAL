import { NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { dispatchEmail, generateNewEmailConfirmationOtpTemplate } from '@/lib/email-service';
import { requireSession } from '@/lib/session';
import { recordAuthFailure, recordAuthSuccess } from '@/lib/rate-limit';
import { parseJsonBody } from '@/lib/validation';
import { apiError } from '@/lib/api-error';

const ConfirmEmailChangeSchema = z.object({
  memberId: z.string().trim().min(1).max(128),
  otp: z.string().trim().min(4).max(12),
}).strict();

/**
 * Self-service email change, step 2 of 3. Verifies the OTP that was sent to
 * the OLD email address. This does NOT apply the new email yet — it proves
 * the member controls the account they're changing, then sends a SECOND OTP
 * to the NEW address so step 3 (see confirm-new-email) can prove they also
 * control the inbox they're moving to before anything actually changes.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const { memberId, otp } = await parseJsonBody(request, ConfirmEmailChangeSchema);
    if (actor.id !== memberId) {
      return NextResponse.json({ error: 'You can only confirm an email change for your own account.' }, { status: 403 });
    }

    const changes = await readCollection<any>('emailChanges');
    const matchedChange = changes.find((r: any) => r.memberId === memberId && !r.oldVerified && r.otp === String(otp).trim());
    if (!matchedChange) {
      recordAuthFailure(memberId);
      return NextResponse.json({ error: 'Invalid verification code. Please check your email and try again.' }, { status: 400 });
    }
    recordAuthSuccess(memberId);
    if (Date.now() > matchedChange.expiresAt) {
      return NextResponse.json({ error: 'The 5-minute verification code has expired. Please request a new one.' }, { status: 400 });
    }

    const members = await readCollection<any>('members');
    const member = members.find((m: any) => m.id === memberId);
    if (!member) {
      return NextResponse.json({ error: 'Account not found in registered members database.' }, { status: 404 });
    }
    if (members.some((m: any) => m.id !== memberId && m.email.toLowerCase() === matchedChange.newEmail)) {
      return NextResponse.json({ error: 'That email address was claimed by another account in the meantime.' }, { status: 409 });
    }

    const newOtp = randomInt(100000, 1000000).toString();
    const newExpiresAt = Date.now() + 5 * 60 * 1000;

    await mutateCollection('emailChanges', (current) =>
      (current || []).map((r: any) =>
        r.id === matchedChange.id
          ? { ...r, otp: newOtp, expiresAt: newExpiresAt, oldVerified: true }
          : r
      )
    );

    const template = generateNewEmailConfirmationOtpTemplate(member.name, newOtp, matchedChange.oldEmail);
    await dispatchEmail({
      to: matchedChange.newEmail,
      subject: template.subject,
      bodyText: template.bodyText,
      bodyHtml: template.bodyHtml,
      category: 'AUTH_OTP',
    });

    return NextResponse.json({
      success: true,
      stage: 'NEW_EMAIL_SENT',
      message: `Current email verified. A second code was sent to your new email (${matchedChange.newEmail}). Valid for 5 minutes.`,
      newEmail: matchedChange.newEmail,
      expiresAt: newExpiresAt,
    });
  } catch (err: any) {
    return apiError(err, 'confirm-email-change-api');
  }
}
