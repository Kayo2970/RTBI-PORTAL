import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { hashPassword, verifyPassword } from '@/lib/password';
import { requireSession, invalidateAllSessionsForMember, createSession } from '@/lib/session';
import { parseJsonBody } from '@/lib/validation';
import { apiError } from '@/lib/api-error';

const ChangePasswordSchema = z.object({
  email: z.string().trim().min(1).max(254).email(),
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(4).max(256),
}).strict();

/**
 * Self-service password change from Settings. Verifying currentPassword
 * (previously collected in the UI but silently ignored) and hashing
 * newPassword both require Node's crypto, so — like login — this can't run
 * as a client-side check; it has to be a real server round-trip.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const { email, currentPassword, newPassword } = await parseJsonBody(request, ChangePasswordSchema);
    const trimmedEmail = email.trim().toLowerCase();
    // Only ever act on the signed-in caller's own record — a request body
    // naming a different email must never be able to change someone else's
    // password, even if (implausibly) it also somehow knew their current one.
    if (trimmedEmail !== (actor.email || '').toLowerCase()) {
      return NextResponse.json({ error: 'You can only change your own password.' }, { status: 403 });
    }
    const members = await readCollection<any>('members');
    const matchedUser = members.find(m => m.email.toLowerCase() === trimmedEmail);

    if (!matchedUser) {
      return NextResponse.json({ error: 'Could not find your member record.' }, { status: 404 });
    }
    if (!verifyPassword(currentPassword, matchedUser.passwordHash)) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
    }

    await mutateCollection('members', (current) =>
      (current || []).map((m: any) =>
        m.email.toLowerCase() === trimmedEmail
          ? { ...m, passwordHash: hashPassword(newPassword) }
          : m
      )
    );

    // Rotate out every other live session for this account and issue this
    // caller a fresh one, so a password change also kicks out anyone else
    // who was using a stolen session token under the old password.
    await invalidateAllSessionsForMember(matchedUser.id);
    const token = await createSession(matchedUser.id);

    return NextResponse.json({ success: true, token });
  } catch (err: any) {
    return apiError(err, 'change-password-api');
  }
}
