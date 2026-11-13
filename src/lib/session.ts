/**
 * session.ts — Server-side auth sessions.
 *
 * The app previously had no session transport at all: the client stored the
 * logged-in user in localStorage and API routes trusted whatever the request
 * body/query said, with no way to know who (if anyone) was actually calling.
 * This adds a real, server-verified session: login issues an opaque random
 * token; only its SHA-256 hash is ever persisted (data/sessions.json), so a
 * leaked/backed-up sessions file can't be replayed as a live token. Every
 * protected API route resolves the caller via requireSession()/getSessionMember()
 * instead of trusting a client-supplied id, and sign-out deletes the row
 * server-side, so a stolen token stops working the moment the user logs out —
 * not just when its own expiry eventually passes.
 */
import { randomBytes, createHash } from 'crypto';
import { readCollection, mutateCollection } from './server-db';
import { resolvePolicyGrants } from './permissions-server';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionRecord {
  id: string; // sha256(token) hex — never the raw token
  memberId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Issue a new session for memberId. Returns the raw token — hand it to the client once; it is never stored or logged in recoverable form. */
export async function createSession(memberId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const record: SessionRecord = {
    id: hashToken(token),
    memberId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    lastSeenAt: now.toISOString(),
  };
  await mutateCollection<SessionRecord>('sessions', (current) => [...current, record]);
  return token;
}

/** Delete a session server-side — this is what makes sign-out real: the token stops working immediately, everywhere, not just in the tab that clicked it. */
export async function invalidateSession(token: string | null | undefined): Promise<void> {
  if (!token) return;
  const id = hashToken(token);
  await mutateCollection<SessionRecord>('sessions', (current) => current.filter(s => s.id !== id));
}

/** Delete every session belonging to a member — used when an account is terminated or its password is reset by an admin, so any device already signed in is kicked out immediately. */
export async function invalidateAllSessionsForMember(memberId: string): Promise<void> {
  await mutateCollection<SessionRecord>('sessions', (current) => current.filter(s => s.memberId !== memberId));
}

/** Resolve a bearer token to its (still-valid, unexpired) session record, or null. */
export async function getSession(token: string | null | undefined): Promise<SessionRecord | null> {
  if (!token) return null;
  const id = hashToken(token);
  const sessions = await readCollection<SessionRecord>('sessions');
  const record = sessions.find(s => s.id === id);
  if (!record) return null;
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    // Expired — clean it up lazily rather than waiting on a sweep job.
    await mutateCollection<SessionRecord>('sessions', (current) => current.filter(s => s.id !== id));
    return null;
  }
  return record;
}

function extractToken(request: Request): string | null {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Resolve the calling member from the request's Authorization header, or
 * null if there is no valid, unexpired session — a terminated account also
 * resolves to null, so a stale token stops granting access the moment the
 * member is terminated, without needing an explicit revoke on that path.
 * Never trusts anything in the request body/query for identity.
 */
export async function getSessionMember(request: Request): Promise<any | null> {
  const token = extractToken(request);
  const session = await getSession(token);
  if (!session) return null;
  const members = await readCollection<any>('members');
  const member = members.find(m => m.id === session.memberId);
  if (!member || member.status === 'Terminated') return null;
  // Attach this member's Group Policy grants (capabilities + module edit overrides) so server-side can*() checks honor
  // them. Non-enumerable: never persisted if the member object is spread/merged into a record, never serialized.
  Object.defineProperty(member, '__policyGrants', { value: await resolvePolicyGrants(member), enumerable: false });
  return member;
}

export class UnauthorizedError extends Error {
  status: number;
  constructor(message = 'Sign in required.', status = 401) {
    super(message);
    this.status = status;
  }
}

/** Resolve the calling member or throw a 401 — the standard guard for any route that requires being signed in at all. Route handlers should catch this alongside their existing try/catch (UnauthorizedError -> its own .status). */
export async function requireSession(request: Request): Promise<any> {
  const member = await getSessionMember(request);
  if (!member) throw new UnauthorizedError();
  return member;
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = "You don't have permission to do that.") {
    super(message);
  }
}

/** Throw a 403 unless `allowed` is true — pairs with a permissions.ts can*() check at the call site. */
export function requirePermission(allowed: boolean, message?: string): void {
  if (!allowed) throw new ForbiddenError(message);
}

/** Shared error -> NextResponse mapping for route catch blocks. */
export function sessionErrorStatus(err: unknown): number | null {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) return err.status;
  return null;
}
