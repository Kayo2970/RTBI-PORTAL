/**
 * device-security.ts — server-only. Per-device login lockout.
 *
 * Why: locking by IP alone punishes everyone on a shared campus/office Wi-Fi, and locking by account
 * alone lets anyone lock the real owner out on purpose. So we key lockouts on the *device*: every
 * browser gets a random, HMAC-signed, HttpOnly cookie (`rtbi_did`), and failures are counted per
 * (device, account) and per device overall.
 *
 *  - Pair lock   : N wrong attempts for one account from one device -> that device is locked out of
 *                  that account for an escalating time (default 15 min -> 1 h -> 24 h).
 *  - Device lock : many wrong attempts across ANY accounts from one device in a window (credential
 *                  stuffing) -> the whole device is locked for the same ladder.
 *  - Known device: a device that has logged in successfully for an account is "trusted" for it, and
 *                  skips the account-wide backoff in rate-limit.ts, so an attacker hammering the
 *                  account from elsewhere can't lock the real owner out of their own laptop.
 *
 * An attacker can clear cookies to look like a new device, but a new device is never trusted, so it
 * stays subject to the per-account backoff and per-IP limits in rate-limit.ts. This layer adds the
 * persistent, per-device part on top; it is not a replacement.
 *
 * State lives in the `deviceSecurity` collection (encrypted JSON via server-db.ts) so lockouts survive
 * restarts/deploys. Only a SHA-256 hash of the device id is stored, never the cookie value. Records
 * are pruned automatically (see prune()).
 *
 * Tunables (env): DEVICE_LOCK_MAX_FAILURES (5), DEVICE_LOCK_DEVICEWIDE_MAX_FAILURES (10),
 * DEVICE_LOCK_WINDOW_MS (15 min), DEVICE_LOCK_LADDER_MINUTES ("15,60,1440").
 */
import crypto from 'crypto';
import { mutateCollection, readCollection } from './server-db';
import { getMasterKey } from './encryption';
import { extractIp } from './rate-limit';

export const DEVICE_COOKIE = 'rtbi_did';
const COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const TRUSTED_RETENTION_MS = 90 * DAY;
const MAX_RECORDS = 5000;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const PAIR_MAX_FAILURES = () => envInt('DEVICE_LOCK_MAX_FAILURES', 5);
const DEVICE_MAX_FAILURES = () => envInt('DEVICE_LOCK_DEVICEWIDE_MAX_FAILURES', 10);
const DEVICE_WINDOW_MS = () => envInt('DEVICE_LOCK_WINDOW_MS', 15 * 60 * 1000);
function ladderMs(): number[] {
  const raw = (process.env.DEVICE_LOCK_LADDER_MINUTES || '15,60,1440')
    .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  return (raw.length ? raw : [15, 60, 1440]).map((m) => m * 60 * 1000);
}
/** A failure streak older than this is forgotten (the lock level itself decays after LEVEL_DECAY_MS). */
const STREAK_RESET_MS = HOUR;
const LEVEL_DECAY_MS = DAY;

interface BaseRecord {
  id: string;
  deviceHash: string;
  failures: number;
  level: number;
  lockedUntil: number;
  lastFailureAt: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastIp?: string;
  userAgent?: string;
}
export interface PairRecord extends BaseRecord { type: 'pair'; account: string; trustedAt?: number }
export interface DeviceRecord extends BaseRecord { type: 'device'; windowStart: number; accountCount: number }
type Row = PairRecord | DeviceRecord;

export interface DeviceContext {
  deviceId: string;
  deviceHash: string;
  isNew: boolean;
  ip: string;
  userAgent: string;
}

// ---------- cookie ----------

function signingKey(): Buffer {
  return crypto.createHmac('sha256', getMasterKey()).update('rtbi-device-cookie-v1').digest();
}
function sign(id: string): string {
  return crypto.createHmac('sha256', signingKey()).update(id).digest('base64url').slice(0, 22);
}
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

/** Read this browser's device cookie (verifying its signature) or mint a fresh one. Never trusts an unsigned/forged value. */
export function resolveDevice(request: Request): DeviceContext {
  const ip = extractIp(request);
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 200);
  const raw = readCookie(request, DEVICE_COOKIE);
  if (raw) {
    const [id, sig] = raw.split('.');
    if (id && sig && id.length >= 16 && id.length <= 64) {
      const expected = Buffer.from(sign(id));
      const got = Buffer.from(sig);
      if (expected.length === got.length && crypto.timingSafeEqual(expected, got)) {
        return { deviceId: id, deviceHash: sha(id), isNew: false, ip, userAgent };
      }
    }
  }
  const id = crypto.randomBytes(16).toString('base64url');
  return { deviceId: id, deviceHash: sha(id), isNew: true, ip, userAgent };
}

function isHttps(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  try { return new URL(request.url).protocol === 'https:'; } catch { return false; }
}

/** Set-Cookie value for this device (re-issued on every auth response so the 1-year lifetime slides). */
export function deviceCookieHeader(ctx: DeviceContext, request: Request): string {
  const value = `${ctx.deviceId}.${sign(ctx.deviceId)}`;
  return `${DEVICE_COOKIE}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${isHttps(request) ? '; Secure' : ''}`;
}

/** JSON response that also carries the device cookie (use for every response from a guarded auth route). */
export function deviceJson(ctx: DeviceContext, request: Request, body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.append('Set-Cookie', deviceCookieHeader(ctx, request));
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

// ---------- guard / record ----------

export interface GuardResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: 'device' | 'account-on-device';
  /** This device has previously logged in successfully for this account. */
  trusted: boolean;
}

const pairId = (deviceHash: string, account: string) => `p:${deviceHash}:${sha(account.toLowerCase())}`;
const deviceId_ = (deviceHash: string) => `d:${deviceHash}`;

/** Read-only: is this device (or this device+account) currently locked? */
export async function checkDeviceGuard(ctx: DeviceContext, account: string): Promise<GuardResult> {
  const rows = (await readCollection<Row>('deviceSecurity')) || [];
  const now = Date.now();
  const dev = rows.find((r) => r.id === deviceId_(ctx.deviceHash)) as DeviceRecord | undefined;
  const pair = rows.find((r) => r.id === pairId(ctx.deviceHash, account)) as PairRecord | undefined;
  const trusted = !!pair?.trustedAt;
  const devLocked = dev && dev.lockedUntil > now ? dev.lockedUntil : 0;
  const pairLocked = pair && pair.lockedUntil > now ? pair.lockedUntil : 0;
  if (devLocked || pairLocked) {
    const until = Math.max(devLocked, pairLocked);
    return { allowed: false, retryAfterSeconds: Math.ceil((until - now) / 1000), reason: devLocked >= pairLocked ? 'device' : 'account-on-device', trusted };
  }
  return { allowed: true, trusted };
}

export function lockMessage(retryAfterSeconds: number): string {
  const mins = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  const wait = mins >= 120 ? `${Math.ceil(mins / 60)} hours` : mins >= 60 ? 'about an hour' : `${mins} minute${mins === 1 ? '' : 's'}`;
  return `Too many incorrect attempts from this device. Please try again in ${wait}, or ask an administrator to unlock it.`;
}

function prune(rows: Row[], now: number): Row[] {
  let out = rows.filter((r) => {
    if (r.lockedUntil > now) return true;
    if (r.type === 'pair' && r.trustedAt) return now - r.lastSeenAt < TRUSTED_RETENTION_MS;
    return now - r.lastSeenAt < DAY; // untrusted & not locked: forget after a day
  });
  if (out.length > MAX_RECORDS) {
    // Keep locked + trusted records, drop the oldest of the rest.
    const keep = out.filter((r) => r.lockedUntil > now || (r.type === 'pair' && r.trustedAt));
    const rest = out.filter((r) => !keep.includes(r)).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    out = [...keep, ...rest.slice(0, Math.max(0, MAX_RECORDS - keep.length))];
  }
  return out;
}

function touch(r: BaseRecord, ctx: DeviceContext, now: number) {
  r.lastSeenAt = now;
  r.lastIp = ctx.ip;
  r.userAgent = ctx.userAgent;
}

export interface FailureResult { locked: boolean; retryAfterSeconds?: number; reason?: 'device' | 'account-on-device' }

/** Call after a wrong password / wrong OTP. Escalates the per-(device, account) and per-device counters and locks when a threshold is hit. */
export async function recordDeviceFailure(ctx: DeviceContext, rawAccount: string): Promise<FailureResult> {
  const account = rawAccount.trim().toLowerCase().slice(0, 254);
  const now = Date.now();
  const ladder = ladderMs();
  let result: FailureResult = { locked: false };

  await mutateCollection<Row>('deviceSecurity', (current) => {
    const rows = prune([...(current || [])], now);

    // --- per (device, account)
    const pid = pairId(ctx.deviceHash, account);
    let pair = rows.find((r) => r.id === pid) as PairRecord | undefined;
    if (!pair) {
      pair = { id: pid, type: 'pair', deviceHash: ctx.deviceHash, account, failures: 0, level: 0, lockedUntil: 0, lastFailureAt: 0, firstSeenAt: now, lastSeenAt: now };
      rows.push(pair);
    }
    if (pair.lastFailureAt && now - pair.lastFailureAt > LEVEL_DECAY_MS) { pair.level = 0; pair.failures = 0; }
    else if (pair.lastFailureAt && now - pair.lastFailureAt > STREAK_RESET_MS) pair.failures = 0;
    pair.failures += 1;
    pair.lastFailureAt = now;
    touch(pair, ctx, now);
    if (pair.failures >= PAIR_MAX_FAILURES()) {
      const ms = ladder[Math.min(pair.level, ladder.length - 1)];
      pair.lockedUntil = now + ms;
      pair.level += 1;
      pair.failures = 0;
      result = { locked: true, retryAfterSeconds: Math.ceil(ms / 1000), reason: 'account-on-device' };
    }

    // --- per device (all accounts)
    const did = deviceId_(ctx.deviceHash);
    let dev = rows.find((r) => r.id === did) as DeviceRecord | undefined;
    if (!dev) {
      dev = { id: did, type: 'device', deviceHash: ctx.deviceHash, failures: 0, level: 0, lockedUntil: 0, lastFailureAt: 0, firstSeenAt: now, lastSeenAt: now, windowStart: now, accountCount: 0 };
      rows.push(dev);
    }
    if (now - dev.windowStart > DEVICE_WINDOW_MS()) { dev.windowStart = now; dev.failures = 0; dev.accountCount = 0; }
    if (dev.lastFailureAt && now - dev.lastFailureAt > LEVEL_DECAY_MS) dev.level = 0;
    dev.failures += 1;
    dev.lastFailureAt = now;
    touch(dev, ctx, now);
    if (dev.failures >= DEVICE_MAX_FAILURES()) {
      const ms = ladder[Math.min(dev.level, ladder.length - 1)];
      dev.lockedUntil = now + ms;
      dev.level += 1;
      dev.failures = 0;
      dev.windowStart = now;
      if (!result.locked || (result.retryAfterSeconds ?? 0) < Math.ceil(ms / 1000)) {
        result = { locked: true, retryAfterSeconds: Math.ceil(ms / 1000), reason: 'device' };
      }
    }
    return rows;
  });

  if (result.locked) {
    try {
      await mutateCollection('auditLogs', (cur: any[]) => [{
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        action: 'DEVICE_LOCKED',
        user: account,
        actorName: 'System',
        details: `${result.reason === 'device' ? 'Device' : `Device (for ${account})`} locked for ${Math.round((result.retryAfterSeconds ?? 0) / 60)} min after repeated failed sign-in attempts (IP ${maskIp(ctx.ip)}).`,
        timestamp: new Date().toISOString(),
      }, ...(cur || [])]);
    } catch { /* audit is best-effort */ }
  }
  return result;
}

/** Call after a correct password / OTP. Clears the pair's failure streak; `trust` marks the device as known for this account. */
export async function recordDeviceSuccess(ctx: DeviceContext, rawAccount: string, opts: { trust: boolean }): Promise<void> {
  const account = rawAccount.trim().toLowerCase().slice(0, 254);
  const now = Date.now();
  const pid = pairId(ctx.deviceHash, account);
  const rows = (await readCollection<Row>('deviceSecurity')) || [];
  const existing = rows.find((r) => r.id === pid) as PairRecord | undefined;
  const needsWrite =
    (!existing && opts.trust) ||
    (existing && (existing.failures > 0 || existing.level > 0 || existing.lockedUntil > 0 || (opts.trust && !existing.trustedAt) || now - existing.lastSeenAt > DAY));
  if (!needsWrite) return;

  await mutateCollection<Row>('deviceSecurity', (current) => {
    const next = prune([...(current || [])], now);
    let pair = next.find((r) => r.id === pid) as PairRecord | undefined;
    if (!pair) {
      pair = { id: pid, type: 'pair', deviceHash: ctx.deviceHash, account, failures: 0, level: 0, lockedUntil: 0, lastFailureAt: 0, firstSeenAt: now, lastSeenAt: now };
      next.push(pair);
    }
    pair.failures = 0; pair.level = 0; pair.lockedUntil = 0;
    if (opts.trust && !pair.trustedAt) pair.trustedAt = now;
    touch(pair, ctx, now);
    return next;
  });
}

// ---------- admin ----------

export function maskIp(ip: string): string {
  if (!ip || ip === 'unknown') return 'unknown';
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + ':…';
  const p = ip.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.x` : ip;
}

export interface LockView {
  id: string;
  scope: 'device' | 'account-on-device';
  account?: string;
  lockedUntil: number;
  level: number;
  ip: string;
  userAgent: string;
  lastFailureAt: number;
}

export async function listActiveLocks(): Promise<LockView[]> {
  const now = Date.now();
  const rows = (await readCollection<Row>('deviceSecurity')) || [];
  return rows
    .filter((r) => r.lockedUntil > now)
    .map((r) => ({
      id: r.id,
      scope: (r.type === 'device' ? 'device' : 'account-on-device') as LockView['scope'],
      account: r.type === 'pair' ? r.account : undefined,
      lockedUntil: r.lockedUntil,
      level: r.level,
      ip: maskIp(r.lastIp || ''),
      userAgent: r.userAgent || '',
      lastFailureAt: r.lastFailureAt,
    }))
    .sort((a, b) => b.lockedUntil - a.lockedUntil);
}

/** Admin unlock: clears the lock and resets the escalation level. Returns false if the record doesn't exist. */
export async function unlockRecord(id: string): Promise<{ found: boolean; account?: string; scope?: string }> {
  let info: { found: boolean; account?: string; scope?: string } = { found: false };
  await mutateCollection<Row>('deviceSecurity', (current) => (current || []).map((r) => {
    if (r.id !== id) return r;
    info = { found: true, account: r.type === 'pair' ? r.account : undefined, scope: r.type };
    return { ...r, lockedUntil: 0, level: 0, failures: 0 };
  }));
  return info;
}
