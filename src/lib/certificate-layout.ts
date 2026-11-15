/**
 * Certificate layout model shared by the server renderer and the design editor (no server-only imports).
 * Every element is a text box placed on the A4-landscape page in % of its width/height, so it stays put for any artwork.
 */

export const CERT_W = 1754;
export const CERT_H = 1240;

/** Built-in ids, or `custom:<id>` for an uploaded / Google font. */
export type CertFontId = string;

export const isCustomFont = (id: string) => /^custom:[a-z0-9-]{1,40}$/.test(id);

export const CERT_FONT_OPTIONS: Array<{ id: CertFontId; label: string; css: string }> = [
  { id: 'serif', label: 'Serif (Times style)', css: "CertSerif, CertSerifFallback, 'Times New Roman', serif" },
  { id: 'sans', label: 'Sans (Arial style)', css: "CertSans, CertSerifFallback, Arial, sans-serif" },
  { id: 'mono', label: 'Monospace', css: "CertMono, 'Courier New', monospace" },
  { id: 'dejavu', label: 'DejaVu Sans', css: "CertDejaVu, CertSans, Arial, sans-serif" },
];

export interface CertBox {
  /** Position and size, in % of the page (0-100). */
  x: number;
  y: number;
  w: number;
  h: number;
  fontFamily: CertFontId;
  /** px on the 1754 x 1240 canvas (the A4 page at 150 dpi). */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  /** '' = use the template's text colour. */
  color: string;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  /** Shrink the font until the text fits inside the box. Off = text is clipped to the box. */
  autoFit: boolean;
  /** 1 keeps a single line (e.g. for names); 0 = as many as fit. */
  maxLines: number;
  underline: boolean;
  opacity: number;
  enabled: boolean;
}

export type CertBoxKey = 'title' | 'intro' | 'name' | 'body' | 'signatory' | 'qr';

export type CertLayout = Record<CertBoxKey, CertBox>;

export const CERT_BOX_LABELS: Record<CertBoxKey, string> = {
  title: 'Heading',
  intro: 'Intro line',
  name: 'Attendee name',
  body: 'Content',
  signatory: 'Signatory',
  qr: 'QR + ID',
};

const px = (v: number, total: number) => Math.round((v / total) * 1000) / 10;

const base: CertBox = {
  x: 0, y: 0, w: 50, h: 10, fontFamily: 'serif', fontSize: 36, bold: false, italic: false, color: '',
  align: 'center', valign: 'middle', autoFit: true, maxLines: 0, underline: false, opacity: 1, enabled: true,
};

/** Matches the original fixed layout so certificates designed before boxes existed look the same. */
export const DEFAULT_CERT_LAYOUT: CertLayout = {
  title: { ...base, x: px(200, CERT_W), y: px(262, CERT_H), w: px(1354, CERT_W), h: px(88, CERT_H), fontSize: 64, bold: true, maxLines: 1 },
  intro: { ...base, x: px(200, CERT_W), y: px(392, CERT_H), w: px(1354, CERT_W), h: px(54, CERT_H), fontSize: 34, opacity: 0.75, maxLines: 1 },
  name: { ...base, x: px(200, CERT_W), y: px(462, CERT_H), w: px(1354, CERT_W), h: px(160, CERT_H), fontSize: 118, bold: true, italic: true, maxLines: 1, underline: true },
  body: { ...base, x: px(240, CERT_W), y: px(660, CERT_H), w: px(1274, CERT_W), h: px(230, CERT_H), fontSize: 36, valign: 'top', maxLines: 4 },
  signatory: { ...base, x: px(230, CERT_W), y: px(1015, CERT_H), w: px(380, CERT_W), h: px(110, CERT_H), fontSize: 36, bold: true, valign: 'top', maxLines: 1 },
  qr: { ...base, x: px(1249, CERT_W), y: px(920, CERT_H), w: px(170, CERT_W), h: px(170, CERT_H), fontSize: 22 },
};

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Fills gaps and clamps every value, so stored / posted layouts can never break the renderer. */
export function normalizeLayout(input: unknown): CertLayout {
  const src = (input && typeof input === 'object' ? input : {}) as Partial<Record<CertBoxKey, Partial<CertBox>>>;
  const out = {} as CertLayout;
  (Object.keys(DEFAULT_CERT_LAYOUT) as CertBoxKey[]).forEach((key) => {
    const d = DEFAULT_CERT_LAYOUT[key];
    const s = src[key] || {};
    const x = num(s.x, 0, 98, d.x);
    const y = num(s.y, 0, 98, d.y);
    out[key] = {
      x,
      y,
      w: num(s.w, 2, 100 - x, Math.min(d.w, 100 - x)),
      h: num(s.h, 1, 100 - y, Math.min(d.h, 100 - y)),
      fontFamily: typeof s.fontFamily === 'string' && (CERT_FONT_OPTIONS.some((f) => f.id === s.fontFamily) || isCustomFont(s.fontFamily)) ? s.fontFamily : d.fontFamily,
      fontSize: num(s.fontSize, 8, 300, d.fontSize),
      bold: typeof s.bold === 'boolean' ? s.bold : d.bold,
      italic: typeof s.italic === 'boolean' ? s.italic : d.italic,
      color: typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : s.color === '' ? '' : d.color,
      // The attendee's name is always centred horizontally; its vertical position (top / middle / bottom) is the designer's choice
      align: key === 'name' ? 'center' : s.align === 'left' || s.align === 'right' || s.align === 'center' ? s.align : d.align,
      valign: s.valign === 'top' || s.valign === 'bottom' || s.valign === 'middle' ? s.valign : d.valign,
      autoFit: typeof s.autoFit === 'boolean' ? s.autoFit : d.autoFit,
      maxLines: Math.round(num(s.maxLines, 0, 12, d.maxLines)),
      underline: typeof s.underline === 'boolean' ? s.underline : d.underline,
      opacity: num(s.opacity, 0.1, 1, d.opacity),
      enabled: typeof s.enabled === 'boolean' ? s.enabled : d.enabled,
    };
  });
  return out;
}

// ── Certificate email (the message that travels with the PDF) ───────────────────

export interface CertEmailMessage { subject: string; bodyText: string }

export const CERT_EMAIL_MAX_SUBJECT = 200;
export const CERT_EMAIL_MAX_BODY = 5000;

export const DEFAULT_CERT_EMAIL: CertEmailMessage = {
  subject: 'Your certificate — {{event}}',
  bodyText:
    'Dear {{name}},\n\nThank you for attending {{event}}. Your certificate of participation is attached to this email.\n\nYou can verify it any time at {{verify_url}} (certificate ID {{code}}).\n\nWarm regards,\nRTBI • RUAS',
};

export const CERT_EMAIL_FIELDS: Array<{ token: string; label: string }> = [
  { token: '{{name}}', label: 'Attendee name' },
  { token: '{{email}}', label: 'Attendee email' },
  { token: '{{event}}', label: 'Event name' },
  { token: '{{date}}', label: 'Event date' },
  { token: '{{code}}', label: 'Certificate ID' },
  { token: '{{verify_url}}', label: 'Verification link' },
];

/** Fills {{name}} / @name style placeholders (same convention as Mail Merge) with one attendee's details. */
export function mergeCertEmail(template: string, v: { name: string; email: string; event: string; date: string; code: string; verifyUrl: string }): string {
  return template
    .replace(/\{\{\s*name\s*\}\}|@name\b/gi, () => v.name)
    .replace(/\{\{\s*email\s*\}\}|@email\b/gi, () => v.email)
    .replace(/\{\{\s*event\s*\}\}/gi, () => v.event)
    .replace(/\{\{\s*date\s*\}\}/gi, () => v.date)
    .replace(/\{\{\s*code\s*\}\}/gi, () => v.code)
    .replace(/\{\{\s*verify_url\s*\}\}/gi, () => v.verifyUrl);
}

/** Validates a client-supplied message; returns undefined when blank/invalid so the default wording is used. */
export function cleanCertEmail(raw: unknown): CertEmailMessage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const subject = typeof r.subject === 'string' ? r.subject.trim().slice(0, CERT_EMAIL_MAX_SUBJECT) : '';
  const bodyText = typeof r.bodyText === 'string' ? r.bodyText.trim().slice(0, CERT_EMAIL_MAX_BODY) : '';
  if (!subject || !bodyText) return undefined;
  return { subject, bodyText };
}
