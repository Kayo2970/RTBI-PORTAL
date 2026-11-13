import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkIpRateLimit, checkAccountBackoff, extractIp } from '@/lib/rate-limit';

// Next.js 16 renamed `middleware.ts` to `proxy.ts` (same mechanism, new
// name/export — see node_modules/next/dist/docs/.../proxy.md). This is the
// per-IP half of rate limiting for every /api/* request; the per-account
// exponential-backoff half lives in rate-limit.ts and is written to by the
// auth route handlers themselves (only they know whether an attempt
// actually failed), then read here before the request is even let through.

const AUTH_PATH_PREFIXES = [
  '/api/auth/login',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/override-password',
  '/api/auth/change-password',
  '/api/auth/activate-account',
  '/api/auth/request-email-change',
  '/api/auth/confirm-email-change',
  '/api/auth/confirm-new-email',
];

// Explicitly public/unauthenticated surfaces — not credential-guessing
// targets, but still reachable by anyone, so they get the moderate tier
// rather than the loose "authenticated member" tier.
const PUBLIC_PATH_PREFIXES = [
  '/api/setup',
  '/api/submissions',
  '/api/forms', // public form definitions are read here too (GET), not just submitted
  '/api/centre-socials', // read-only social URLs for the thank-you page
  '/api/pass', // public pass lookup + boarding-pass image (CPU-heavy render) — rate-limited, addressed by unguessable serial
  '/api/certificate', // public certificate verification + preview — addressed by unguessable code
  '/api/files', // uploaded-file serving — see files/[...key]/route.ts's own doc comment on why it can't require a session
];

function categoryFor(pathname: string): 'auth' | 'public' | 'authenticated' {
  if (AUTH_PATH_PREFIXES.some(p => pathname.startsWith(p))) return 'auth';
  if (PUBLIC_PATH_PREFIXES.some(p => pathname.startsWith(p))) return 'public';
  return 'authenticated';
}

/** Best-effort account key for the auth-tier backoff check — reads `email` from a cloned JSON body without consuming the original request stream. */
async function extractAccountKey(request: NextRequest): Promise<string | null> {
  if (request.method !== 'POST') return null;
  try {
    const body = await request.clone().json();
    const email = typeof body?.email === 'string' ? body.email : null;
    return email ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const category = categoryFor(pathname);
  const ip = extractIp(request);

  const ipResult = checkIpRateLimit(category, ip);
  if (!ipResult.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(ipResult.retryAfterSeconds ?? 60) } }
    );
  }

  if (category === 'auth') {
    const accountKey = await extractAccountKey(request);
    if (accountKey) {
      const accountResult = checkAccountBackoff(accountKey);
      if (!accountResult.allowed) {
        return NextResponse.json(
          { error: 'Too many attempts on this account. Please wait before trying again.' },
          { status: 429, headers: { 'Retry-After': String(accountResult.retryAfterSeconds ?? 60) } }
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
