import { readCollection } from '@/lib/server-db';

export const SOCIAL_KEYS = ['instagram', 'linkedin', 'x', 'youtube', 'facebook', 'website'] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];
export type CentreSocials = Partial<Record<SocialKey, string>>;

/** Keep only http(s) URLs so nothing like javascript: can ever be rendered as a link. */
export function sanitizeSocials(input: unknown): CentreSocials {
  const out: CentreSocials = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of SOCIAL_KEYS) {
    const raw = (input as Record<string, unknown>)[k];
    if (typeof raw !== 'string') continue;
    const v = raw.trim();
    if (!v) continue;
    const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    try {
      const u = new URL(withProto);
      if (u.protocol === 'http:' || u.protocol === 'https:') out[k] = u.toString();
    } catch {
      /* ignore invalid */
    }
  }
  return out;
}

/** Centre social accounts, set by a Super User in Settings → Integrations (single row in walletSettings). */
export async function readCentreSocials(): Promise<CentreSocials> {
  const rows = await readCollection<any>('walletSettings');
  const row = rows.find((r) => r.id === 'default');
  return sanitizeSocials(row?.socials);
}
