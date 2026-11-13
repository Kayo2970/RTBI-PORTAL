import { NextResponse } from 'next/server';
import { UnauthorizedError, ForbiddenError } from './session';
import { ValidationError } from './validation';

/**
 * api-error.ts — the one place every API route's catch block should route
 * through. Routes previously did `NextResponse.json({ error: err.message },
 * ...)` directly — fine for a deliberately-thrown business error ("Member
 * with email X already exists"), but an *unexpected* failure (a filesystem
 * error, a bug, a bad JSON parse deep in some library) carries Node's own
 * `err.message`, which can include internal file paths, stack-trace-shaped
 * text, or other implementation detail no client should ever see. This
 * always logs the full error server-side, and only forwards `err.message`
 * to the client when it looks like one of this codebase's own
 * deliberately-thrown, human-readable messages — anything that looks like
 * a Node/system-level error gets a generic message instead.
 */
const GENERIC_MESSAGE = 'Something went wrong on our end. Please try again, and contact an admin if this keeps happening.';

function looksLikeInternalError(err: any): boolean {
  if (!err) return true;
  if (typeof err.code === 'string') return true; // Node system errors (ENOENT, EACCES, ECONNREFUSED, ...) always carry .code
  if (err instanceof SyntaxError || err instanceof TypeError || err instanceof RangeError) return true;
  const msg = String(err.message ?? '');
  if (!msg) return true;
  if (/[\\/](home|usr|var|root|Users|node_modules)[\\/]/i.test(msg)) return true; // a filesystem path leaked into the message
  if (/^[A-Za-z]:\\\\/.test(msg)) return true; // a Windows-style path
  if (/\bat\s+.+\(.+:\d+:\d+\)/.test(msg)) return true; // looks like a stack frame
  return false;
}

/** Build the NextResponse for a route's catch block — logs full detail server-side, returns a safe message to the client. Call as `return apiError(err, 'route-name')`. */
export function apiError(err: unknown, context: string, fallbackStatus = 500): NextResponse {
  console.error(`[${context}]`, err);

  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: (err as any).status });
  }
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message, issues: err.issues }, { status: err.status });
  }
  if (looksLikeInternalError(err)) {
    return NextResponse.json({ error: GENERIC_MESSAGE }, { status: fallbackStatus });
  }
  // A plain `throw new Error('human-readable message')` from this route's
  // own business logic — this codebase's established convention for
  // expected validation failures. Safe to forward as-is.
  return NextResponse.json({ error: (err as any).message || GENERIC_MESSAGE }, { status: fallbackStatus });
}
