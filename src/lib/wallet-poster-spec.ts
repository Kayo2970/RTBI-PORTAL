/**
 * Single source of truth for the Apple/Google Wallet "poster" pass. Used by the wallet API client (what is sent),
 * the poster artwork renderer (what is baked into the picture) and the Studio preview (what the designer sees),
 * so all three always agree. Isomorphic: no Node-only imports.
 *
 * How Apple's iOS 27 poster layout works (measured from a real pass): the artwork fills the card; Apple itself draws
 * the logo + logo text top-left, ONE header field top-right, the barcode panel in the middle, up to four primary
 * fields in a single row near the bottom and the footer line(s) last. Text colours/sizes of those are Apple's. So our
 * artwork carries the *designed* part (event title, category chip, colours, font size) in the clear top band, keeps
 * the barcode band empty, and ends in a dark fade so Apple's white field text is always readable.
 */
import type { PassBarcodeFormat } from '@/lib/local-data';

export const POSTER_W = 690;
export const POSTER_H = 1010;

/** Fractions of the card height. */
export const POSTER_ZONES = {
  /** Event title / chip band baked into the artwork. */
  titleTop: 0.13,
  titleBottom: 0.45,
  /** Barcode panel drawn by Apple. */
  barcodeTop: 0.475,
  barcodeBottom: 0.785,
  /** The dark fade behind Apple's field row starts here. */
  fadeStart: 0.62,
  /** Primary-field row. */
  fieldsTop: 0.835,
} as const;

export interface PosterFieldInput {
  attendeeName: string;
  guestCategory?: string;
  passType: string;
  eventName: string;
  venue: string;
  validity: string;
  /** ISO days the pass is valid on — preferred over `validity` for the compact date. */
  validDays?: string[];
  serial: string;
  validDaysCount?: number;
  barcodeFormat?: PassBarcodeFormat;
  altText?: 'serial' | 'name' | 'none';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "13–14 Oct 2026", "30 Oct – 2 Nov 2026", "13, 15 Oct 2026" — short enough for a narrow wallet field. */
export function compactDays(days: string[]): string {
  const d = days.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
  if (d.length === 0) return '';
  const p = (iso: string) => ({ y: iso.slice(0, 4), m: Number(iso.slice(5, 7)) - 1, d: Number(iso.slice(8, 10)) });
  const a = p(d[0]);
  const z = p(d[d.length - 1]);
  if (d.length === 1) return `${a.d} ${MONTHS[a.m]} ${a.y}`;
  const contiguous = (new Date(`${d[d.length - 1]}T00:00:00Z`).getTime() - new Date(`${d[0]}T00:00:00Z`).getTime()) / 86_400_000 + 1 === d.length;
  if (a.m === z.m && a.y === z.y) {
    return contiguous ? `${a.d}–${z.d} ${MONTHS[a.m]} ${a.y}` : `${d.map((x) => p(x).d).join(', ')} ${MONTHS[a.m]} ${a.y}`;
  }
  return `${a.d} ${MONTHS[a.m]} – ${z.d} ${MONTHS[z.m]} ${z.y}`;
}

const clip = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1).trimEnd()}…` : v);

/** "2026-10-13 — 2026-10-14" / long labels become a short "13 – 14 Oct 2026" that fits a narrow field. */
export function shortValidity(v: string): string {
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})\s*[—–-]\s*(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const f = (y: string, m: string, d: string) =>
      new Date(`${y}-${m}-${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${f(iso[1], iso[2], iso[3])} – ${f(iso[4], iso[5], iso[6])}`;
  }
  return v;
}

/** The (short!) fields Apple draws on the poster, and the wallet barcode settings. */
export function posterFields(i: PosterFieldInput) {
  const days = i.validDays?.length || i.validDaysCount || 0;
  const alt = i.altText ?? 'serial';
  return {
    logoText: 'RTBI',
    header: { label: 'ACCESS', value: clip((i.passType || 'VIP PASS').toUpperCase(), 14) },
    // Four across at ~150px each: short values only, the full text lives on the back and on the pass page
    primary: [
      { label: clip((i.guestCategory || 'GUEST').toUpperCase(), 14), value: clip(i.attendeeName || 'Attendee', 22) },
      { label: 'VENUE', value: clip(i.venue, 24) },
      { label: 'VALID', value: clip(i.validDays && i.validDays.length > 0 ? compactDays(i.validDays) : shortValidity(i.validity), 22) },
    ],
    footer: [{ label: 'ENTRY', value: days > 1 ? `One pass · ${days} days` : i.serial }],
    barcodeFormat: (i.barcodeFormat || 'QR') as PassBarcodeFormat,
    barcodeAltText: alt === 'none' ? undefined : alt === 'name' ? i.attendeeName : i.serial,
  };
}

/** Relative luminance (0..1) of a #rrggbb colour. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Contrast ratio between two hex colours (1..21). Scanners need ≥ ~3 between QR dark and light. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pulls the colour stops out of a CSS linear-gradient string. */
export function gradientStops(gradient?: string): string[] {
  return (gradient || '').match(/#[0-9a-fA-F]{6}/g) || [];
}
