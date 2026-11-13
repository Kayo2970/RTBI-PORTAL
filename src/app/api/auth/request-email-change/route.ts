import { NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { dispatchEmail, generateEmailChangeOtpTemplate } from '@/lib/email-service';
import { requireSession } from '@/lib/session';
import { parseJsonBody } from '@/lib/validation';
import { apiError } from '@/lib/api-error';

const RequestEmailChangeSchema = z.object({
  memberId: z.string().trim().min(1).max(128),
  currentEmail: z.string().trim().min(1).max(254).email(),
  newEmail: z.string().trim().min(1).max(254).email(),
}).strict();

/**
 * Self-service email change, step 1 of 3. Anyone who knows the account's
 * current email can request a change to any new email — there is no extra
 * check here — but the OTP that actually advances the flow is sent to the
 * OLD address, so continuing still requires access to the inbox being
 * replaced. Step 2 (see confirm-email-change) verifies that OTP and then
 * sends a second OTP to the NEW address; step 3 (see confirm-new-email)
 * verifies that one and only then applies the change — so the member has
 * to prove they control BOTH inboxes before anything actually changes.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const { memberId, currentEmail, newEmail } = await parseJsonBody(request, RequestEmailChangeSchema);
    if (actor.id !== memberId) {
      return NextResponse.json({ error: 'You can only request an email change for your own account.' }, { status: 403 });
    }

    const trimmedCurrent = currentEmail.trim().toLowerCase();
    const trimmedNew = newEmail.trim().toLowerCase();

    if (trimmedNew === trimmedCurrent) {
      return NextResponse.json({ error: 'New email must be different from your current email.' }, { status: 400 });
    }

    const members = await readCollection<any>('members');
    const member = members.find(m => m.id === memberId && m.email.toLowerCase() === trimmedCurrent);
    if (!member) {
      return NextResponse.json({ error: 'Could not find your member record.' }, { status: 404 });
    }
    if (members.some(m => m.id !== memberId && m.email.toLowerCase() === trimmedNew)) {
      return NextResponse.json({ error: 'That email address is already in use by another account.' }, { status: 409 });
    }

    const otp = randomInt(100000, 1000000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    const changeToken = {
      id: `emailchange-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      memberId,
      oldEmail: member.email,
      newEmail: trimmedNew,
      otp,
      expiresAt,
      oldVerified: false,
      createdAt: new Date().toISOString(),
    };

    // One active request per member — a fresh request purges any prior pending one.
    await mutateCollection('emailChanges', (current) => {
      const filtered = (current || []).filter((r: any) => r.memberId !== memberId);
      return [changeToken, ...filtered];
    });

    const template = generateEmailChangeOtpTemplate(member.name, otp, trimmedNew);
    await dispatchEmail({
      to: member.email,
      subject: template.subject,
      bodyText: template.bodyText,
      bodyHtml: template.bodyHtml,
      category: 'AUTH_OTP',
    });

    return NextResponse.json({
      success: true,
      message: `Verification code sent to your current email (${member.email}). Valid for 5 minutes.`,
      expiresAt,
    });
  } catch (err: any) {
    return apiError(err, 'request-email-change-api');
  }
}
