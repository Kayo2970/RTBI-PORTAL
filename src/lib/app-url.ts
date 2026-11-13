import { NextRequest } from 'next/server';

/**
 * Returns the canonical application base URL for email links, activation tokens, and deep-link notifications.
 * Never returns 'localhost' in production unless explicitly running in local dev.
 */
export function getAppBaseUrl(req?: Request | NextRequest | null, customOrigin?: string): string {
  // 1. Explicit custom origin passed from client or API handler
  if (customOrigin && !customOrigin.includes('localhost')) {
    return customOrigin.replace(/\/+$/, '');
  }

  // 2. Check process environment variables if set
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (envUrl && !envUrl.includes('localhost')) {
    const formatted = envUrl.startsWith('http') ? envUrl : `https://${envUrl}`;
    return formatted.replace(/\/+$/, '');
  }

  // 3. Infer from incoming HTTP Request headers (Origin / Host)
  if (req) {
    try {
      const headers = req.headers;
      const origin = headers.get('origin');
      if (origin && !origin.includes('localhost')) {
        return origin.replace(/\/+$/, '');
      }

      const host = headers.get('x-forwarded-host') || headers.get('host');
      if (host && !host.includes('localhost')) {
        const proto = headers.get('x-forwarded-proto') || 'https';
        return `${proto}://${host}`.replace(/\/+$/, '');
      }
    } catch (e) {
      console.warn('[getAppBaseUrl] Error reading request headers:', e);
    }
  }

  // 4. Default Production Domain Fallback
  // If no request header or env var exists (e.g. background task/cron queue worker),
  // default to the primary live production domain instead of localhost!
  if (process.env.NODE_ENV === 'production') {
    return 'http://localhost:3030';
  }

  // 5. If customOrigin was provided (even if localhost in dev), use it
  if (customOrigin) {
    return customOrigin.replace(/\/+$/, '');
  }

  // Fallback to primary production domain
  return 'http://localhost:3030';
}

/** The public pass link every surface encodes in its QR (emailed ticket, wallet artwork, wallet barcode): one source of truth. */
export function getPassPublicUrl(req: Request | NextRequest | null | undefined, serial: string): string {
  return `${getAppBaseUrl(req)}/pass/${serial}`;
}
