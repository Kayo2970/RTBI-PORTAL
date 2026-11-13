import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { recordAuthFailure, recordAuthSuccess } from '@/lib/rate-limit';
import { parseJsonBody } from '@/lib/validation';
import { apiError } from '@/lib/api-error';

const ConfirmNewEmailSchema = z.object({
  memberId: z.string().trim().min(1).max(128),
  otp: z.string().trim().min(4).max(12),
}).strict();

/**
 * Self-service email change, step 3 of 3 — the final step. Verifies the OTP
 * that was sent to the NEW email address (only issued after step 2 already
 * verified the OLD address), then applies the new email directly against
 * the members collection server-side — never through the generic member
 * PATCH route, so the email field can never be set to an unverified value.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const { memberId, otp } = await parseJsonBody(request, ConfirmNewEmailSchema);
    if (actor.id !== memberId) {
      return NextResponse.json({ error: 'You can only confirm an email change for your own account.' }, { status: 403 });
    }

    const changes = await readCollection<any>('emailChanges');
    const matchedChange = changes.find((r: any) => r.memberId === memberId && r.oldVerified && r.otp === String(otp).trim());
    if (!matchedChange) {
      recordAuthFailure(memberId);
      return NextResponse.json({ error: 'Invalid verification code. Please check your new email and try again.' }, { status: 400 });
    }
    recordAuthSuccess(memberId);
    if (Date.now() > matchedChange.expiresAt) {
      return NextResponse.json({ error: 'The 5-minute verification code has expired. Please start over.' }, { status: 400 });
    }

    const members = await readCollection<any>('members');
    if (members.some((m: any) => m.id !== memberId && m.email.toLowerCase() === matchedChange.newEmail)) {
      return NextResponse.json({ error: 'That email address was claimed by another account in the meantime.' }, { status: 409 });
    }

    let memberUpdated = false;
    let memberName = 'User';
    await mutateCollection('members', (current) =>
      (current || []).map((m: any) => {
        if (m.id === memberId) {
          memberUpdated = true;
          memberName = m.name;
          return { ...m, email: matchedChange.newEmail };
        }
        return m;
      })
    );

    if (!memberUpdated) {
      return NextResponse.json({ error: 'Account not found in registered members database.' }, { status: 404 });
    }

    await mutateCollection('emailChanges', (current) => (current || []).filter((r: any) => r.id !== matchedChange.id));

    const auditLog = {
      id: `audit-${Date.now()}`,
      action: 'EMAIL_CHANGED',
      user: memberName,
      details: `Login email changed from ${matchedChange.oldEmail} to ${matchedChange.newEmail} after verifying OTPs sent to both the old and new address`,
      timestamp: new Date().toISOString(),
    };
    await mutateCollection('auditLogs', (current) => [auditLog, ...(current || [])]);

    return NextResponse.json({
      success: true,
      message: 'Email address updated successfully! Use your new email to log in from now on.',
      newEmail: matchedChange.newEmail,
    });
  } catch (err: any) {
    return apiError(err, 'confirm-new-email-api');
  }
}
