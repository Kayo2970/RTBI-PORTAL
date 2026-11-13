import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readCollection } from '@/lib/server-db';
import { verifyPassword } from '@/lib/password';
import { createSession } from '@/lib/session';
import { recordAuthFailure, recordAuthSuccess } from '@/lib/rate-limit';
import { parseJsonBody } from '@/lib/validation';
import { apiError } from '@/lib/api-error';

// Same message for "no account" and "wrong password" — a distinct message
// for each lets anyone probe which emails have accounts on this system
// (submit a guaranteed-wrong password for any address and read the error).
const INVALID_CREDENTIALS_MESSAGE = "Incorrect email or password. If you forgot your password, click 'Forgot Password?' below.";

const LoginSchema = z.object({
  email: z.string().trim().min(1).max(254).email(),
  password: z.string().min(1).max(256),
}).strict();

/**
 * Real server-side login check. Password verification (scrypt + timing-safe
 * compare) can only run server-side — Node's crypto isn't available in the
 * browser — so this replaces what used to be a client-side-only check
 * against a plaintext field. passwordHash is never included in the response.
 */
export async function POST(request: Request) {
  try {
    const { email, password } = await parseJsonBody(request, LoginSchema);
    const trimmedEmail = email.trim().toLowerCase();
    const members = await readCollection<any>('members');
    const matchedUser = members.find(m => m.email.toLowerCase() === trimmedEmail);

    if (!matchedUser) {
      recordAuthFailure(trimmedEmail);
      return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
    }

    if (matchedUser.status === 'Terminated') {
      const terminatedDate = matchedUser.terminatedAt
        ? new Date(matchedUser.terminatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;
      return NextResponse.json(
        {
          error: terminatedDate
            ? `You have been terminated from RTBI Portal effective ${terminatedDate}. You have lost access to the portal. Contact your Administrator if you believe this is a mistake.`
            : 'You have been terminated from RTBI Portal and have lost access to the portal. Contact your Administrator if you believe this is a mistake.',
        },
        { status: 403 }
      );
    }

    if (matchedUser.mustSetupPassword) {
      return NextResponse.json({
        requiresPasswordReset: true,
        email: matchedUser.email,
        name: matchedUser.name,
        message: 'Super User has requested you to set up a new password for your account. Please enter your new password below.',
      });
    }

    if (!matchedUser.passwordHash) {
      return NextResponse.json(
        { error: "This account hasn't been activated yet. Check your email for the \"Set Up My Account\" link, or ask an admin to resend it." },
        { status: 403 }
      );
    }

    if (!verifyPassword(password, matchedUser.passwordHash)) {
      recordAuthFailure(trimmedEmail);
      return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
    }

    recordAuthSuccess(trimmedEmail);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stripped from the response on purpose
    const { passwordHash, ...safeUser } = matchedUser;
    const token = await createSession(matchedUser.id);
    return NextResponse.json({ user: safeUser, token });
  } catch (err: any) {
    return apiError(err, 'login-api');
  }
}
