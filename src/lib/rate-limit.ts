/**
 * rate-limit.ts — in-memory rate limiting shared by src/proxy.ts (per-IP
 * windowing, runs before every /api/* request) and the auth route handlers
 * (per-account exponential backoff, since only the handler itself knows
 * whether a credential attempt actually failed).
 *
 * In-memory by design: this app is a single Node process under PM2 (see
 * CLAUDE.md's deploy workflow — `pm2 restart`, not a cluster of workers),
 * so a module-level Map is a real shared store for the process's lifetime.
 * It resets on restart/deploy and would NOT be shared across multiple PM2
 * cluster instances if this ever moves to `pm2 start -i max` — a genuine
 * limitation, documented rather than silently assumed away. A durable store
 * (e.g. a rateLimits collection via server-db.ts, or Redis) would be needed
 * for that; not worth the complexity at this app's actual scale.
 *
 * All thresholds are read from environment variables with sane defaults —
 * see the *_ENV constants below — so an operator can retune them without a
 * code change.
 */

type Category = 'auth' | 'public' | 'authenticated';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// --- Per-IP sliding-window limits, by route category ---
// Auth routes (login, password reset, OTP verification, ...): stricter —
// these are the credential-guessing surface.
const AUTH_MAX = () => envInt('RATE_LIMIT_AUTH_MAX', 20);
const AUTH_WINDOW_MS = () => envInt('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60 * 1000);
// Public, unauthenticated routes (public form submission, setup, activation
// link consumption): moderate.
const PUBLIC_MAX = () => envInt('RATE_LIMIT_PUBLIC_MAX', 60);
const PUBLIC_WINDOW_MS = () => envInt('RATE_LIMIT_PUBLIC_WINDOW_MS', 60 * 1000);
// Everything else under /api/* — ordinary signed-in member actions: looser,
// since a real user's own polling/typical usage should never come close.
const AUTHENTICATED_MAX = () => envInt('RATE_LIMIT_AUTHENTICATED_MAX', 300);
const AUTHENTICATED_WINDOW_MS = () => envInt('RATE_LIMIT_AUTHENTICATED_WINDOW_MS', 60 * 1000);

// --- Per-account exponential backoff, auth routes only ---
// After each consecutive failure (wrong password, wrong OTP) on a given
// account, the next attempt from ANY IP is blocked for
// min(BASE_MS * 2^(failures-1), MAX_MS) — an escalating cooldown rather
// than a hard lockout that would let one malicious actor permanently deny
// service to the real account holder.
const BACKOFF_BASE_MS = () => envInt('RATE_LIMIT_AUTH_BACKOFF_BASE_MS', 2 * 1000);
const BACKOFF_MAX_MS = () => envInt('RATE_LIMIT_AUTH_BACKOFF_MAX_MS', 15 * 60 * 1000);
// A failure streak older than this is treated as stale and forgotten, so a
// long-inactive account isn't stuck behind a backoff from weeks ago.
const BACKOFF_RESET_AFTER_MS = () => envInt('RATE_LIMIT_AUTH_BACKOFF_RESET_MS', 60 * 60 * 1000);

interface WindowEntry {
  count: number;
  resetAt: number;
}
const ipWindows = new Map<string, WindowEntry>();

interface BackoffEntry {
  failures: number;
  blockedUntil: number;
  lastFailureAt: number;
}
const accountBackoff = new Map<string, BackoffEntry>();

// Periodic sweep so these Maps don't grow unbounded over a long-running
// process — cheap, and only ever removes clearly-expired entries.
let lastSweep = Date.now();
function sweepIfDue() {
  const now = Date.now();
  if (now - lastSweep < 5 * 60 * 1000) return;
  lastSweep = now;
  for (const [key, entry] of ipWindows) {
    if (entry.resetAt < now) ipWindows.delete(key);
  }
  for (const [key, entry] of accountBackoff) {
    if (entry.lastFailureAt + BACKOFF_RESET_AFTER_MS() < now) accountBackoff.delete(key);
  }
}

function limitsForCategory(category: Category): { max: number; windowMs: number } {
  if (category === 'auth') return { max: AUTH_MAX(), windowMs: AUTH_WINDOW_MS() };
  if (category === 'public') return { max: PUBLIC_MAX(), windowMs: PUBLIC_WINDOW_MS() };
  return { max: AUTHENTICATED_MAX(), windowMs: AUTHENTICATED_WINDOW_MS() };
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/** Fixed-window per-IP check for one route category. Always allowed for an empty/unknown ip key rather than failing open silently — callers still get a real key from proxy.ts's IP extraction. */
export function checkIpRateLimit(category: Category, ipKey: string): RateLimitResult {
  sweepIfDue();
  const { max, windowMs } = limitsForCategory(category);
  const key = `${category}:${ipKey}`;
  const now = Date.now();
  const entry = ipWindows.get(key);

  if (!entry || entry.resetAt < now) {
    ipWindows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (entry.count >= max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { allowed: true };
}

/** Read-only check of an account's current backoff state — call before letting an auth request reach its handler. */
export function checkAccountBackoff(accountKey: string): RateLimitResult {
  sweepIfDue();
  const entry = accountBackoff.get(accountKey.toLowerCase());
  if (!entry) return { allowed: true };
  const now = Date.now();
  if (entry.blockedUntil <= now) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000) };
}

/** Call from inside an auth route handler when a credential/OTP attempt was wrong — escalates that account's backoff. */
export function recordAuthFailure(accountKey: string): void {
  const key = accountKey.toLowerCase();
  const now = Date.now();
  const existing = accountBackoff.get(key);
  const failures = (existing && existing.lastFailureAt + BACKOFF_RESET_AFTER_MS() > now ? existing.failures : 0) + 1;
  const delayMs = Math.min(BACKOFF_BASE_MS() * Math.pow(2, failures - 1), BACKOFF_MAX_MS());
  accountBackoff.set(key, { failures, blockedUntil: now + delayMs, lastFailureAt: now });
}

/** Call from inside an auth route handler on a successful login/verification — clears that account's backoff. */
export function recordAuthSuccess(accountKey: string): void {
  accountBackoff.delete(accountKey.toLowerCase());
}

/** Extract the caller's IP from standard proxy headers (this app runs behind nginx per its deploy workflow), falling back to a constant rather than throwing when none is present (e.g. direct dev-server access). */
export function extractIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}
