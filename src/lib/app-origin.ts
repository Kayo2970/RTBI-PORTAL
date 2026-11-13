/**
 * Origin used ONLY as a last-resort fallback when no browser origin / request is available
 * (SSR sample previews). Real pass links always use window.location.origin or getAppBaseUrl().
 * Set NEXT_PUBLIC_APP_URL in production.
 */
export const FALLBACK_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3030').replace(/\/+$/, '');
