import { z } from 'zod';
import { readCollection } from '@/lib/server-db';
import { verifyPassword } from '@/lib/password';
import { createSession } from '@/lib/session';
import { recordAuthFailure, recordAuthSuccess, checkAccountBackoff } from '@/lib/rate-limit';
import { resolveDevice, deviceJson, checkDeviceGuard, recordDeviceFailure, recordDeviceSuccess, lockMessage } from '@/lib/device-security';
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

    // Device lockout (see lib/device-security.ts): checked BEFORE touching the member list so a locked device
    // learns nothing about whether the account exists.
    const device = resolveDevice(request);
    const reply = (body: unknown, status = 200, headers?: Record<string, string>) => deviceJson(device, request, body, { status, headers });
    const guard = await checkDeviceGuard(device, trimmedEmail);
    if (!guard.allowed) {
      const wait = guard.retryAfterSeconds ?? 60;
      return reply({ error: lockMessage(wait), locked: true, retryAfterSeconds: wait }, 429, { 'Retry-After': String(wait) });
    }
    // The account-wide backoff (rate-limit.ts) protects accounts from guessing, but it must not let an attacker
    // lock the owner out of a device they already use — known devices skip it.
    let accountInBackoff = false;
    if (guard.trusted) {
      accountInBackoff = !checkAccountBackoff(trimmedEmail).allowed;
    } else {
      const backoff = checkAccountBackoff(trimmedEmail);
      if (!backoff.allowed) {
        const wait = backoff.retryAfterSeconds ?? 60;
        return reply({ error: 'Too many attempts on this account. Please wait before trying again.', retryAfterSeconds: wait }, 429, { 'Retry-After': String(wait) });
      }
    }
    const failedAttempt = async () => {
      recordAuthFailure(trimmedEmail);
      const f = await recordDeviceFailure(device, trimmedEmail);
      if (f.locked) {
        const wait = f.retryAfterSeconds ?? 900;
        return reply({ error: lockMessage(wait), locked: true, retryAfterSeconds: wait }, 429, { 'Retry-After': String(wait) });
      }
      return reply({ error: INVALID_CREDENTIALS_MESSAGE }, 401);
    };

    const members = await readCollection<any>('members');
    const matchedUser = members.find(m => m.email.toLowerCase() === trimmedEmail);

    if (!matchedUser) return failedAttempt();

    if (matchedUser.status === 'Terminated') {
      const terminatedDate = matchedUser.terminatedAt
        ? new Date(matchedUser.terminatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;
      return reply(
        {
          error: terminatedDate
            ? `You have been terminated from RTBI Portal effective ${terminatedDate}. You have lost access to the portal. Contact your Administrator if you believe this is a mistake.`
            : 'You have been terminated from RTBI Portal and have lost access to the portal. Contact your Administrator if you believe this is a mistake.',
        },
        403
      );
    }

    if (matchedUser.mustSetupPassword) {
      return reply({
        requiresPasswordReset: true,
        email: matchedUser.email,
        name: matchedUser.name,
        message: 'Super User has requested you to set up a new password for your account. Please enter your new password below.',
      });
    }

    if (!matchedUser.passwordHash) {
      return reply(
        { error: "This account hasn't been activated yet. Check your email for the \"Set Up My Account\" link, or ask an admin to resend it." },
        403
      );
    }

    if (!verifyPassword(password, matchedUser.passwordHash)) return failedAttempt();

    // A trusted device skips the backoff, so its success must not also CLEAR a backoff someone else triggered
    // (otherwise the owner logging in would reset an attacker's escalating delay).
    if (!accountInBackoff) recordAuthSuccess(trimmedEmail);
    await recordDeviceSuccess(device, trimmedEmail, { trust: true });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stripped from the response on purpose
    const { passwordHash, ...safeUser } = matchedUser;
    const token = await createSession(matchedUser.id);
    return reply({ user: safeUser, token });
  } catch (err: any) {
    return apiError(err, 'login-api');
  }
}
