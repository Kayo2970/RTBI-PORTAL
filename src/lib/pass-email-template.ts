/**
 * The ONE pass-email message used everywhere (single send, Mail-Merge Dispatch and bulk Preview & dispatch).
 * Subject + body are editable templates with @placeholders; the layout (ticket image, details table, wallet /
 * calendar buttons) is added around them by buildPassEmail() in local-data.ts. The edited template is kept in
 * the browser so every screen uses the same message.
 */
export const PASS_EMAIL_PLACEHOLDERS: Array<{ tag: string; desc: string }> = [
  { tag: '@name', desc: 'Attendee name' },
  { tag: '@first_name', desc: 'First name' },
  { tag: '@event_name', desc: 'Event title' },
  { tag: '@pass_type', desc: 'Pass tier' },
  { tag: '@guest_category', desc: 'Category' },
  { tag: '@room_or_venue', desc: 'Venue / room' },
  { tag: '@valid_days', desc: 'Valid days (e.g. 10 Oct – 12 Oct 2026)' },
  { tag: '@event_date', desc: 'Event date / validity text' },
  { tag: '@serial_number', desc: 'Pass serial ID' },
  { tag: '@pass_link', desc: 'Digital pass link' },
  { tag: '@pass_image', desc: 'Where the wide ticket image goes' },
  { tag: '@details', desc: 'Where the pass details table goes' },
];

export const DEFAULT_PASS_EMAIL_SUBJECT = 'Your Official Pass for @event_name — @pass_type';

export const DEFAULT_PASS_EMAIL_BODY = `Dear @name,

We are delighted to confirm your credential for @event_name. Your pass is ready and verified for gate turnstile entry.

@pass_image

@details

Your pass is valid on @valid_days. It is one pass with one QR code — present it at the gate each day.

Use the buttons below to add it to your Apple Wallet or Google Wallet, save it to your calendar, or open your digital pass.

Warm regards,
RTBI • RUAS`;

export interface PassEmailTemplate {
  subject: string;
  body: string;
  /** Optional extras: a Google Maps button (blank link = search the pass's venue) and a WhatsApp group button. */
  includeMap?: boolean;
  mapUrl?: string;
  includeWhatsapp?: boolean;
  whatsappUrl?: string;
}

/** Only http(s) links are ever put in an email button. */
export function safeHttpUrl(u?: string): string | undefined {
  const t = (u || '').trim();
  return /^https?:\/\/\S+$/i.test(t) ? t : undefined;
}

/** Template fields -> the options buildPassEmail()/dispatchPassEmail() take. */
export function passEmailOptsFromTemplate(t: PassEmailTemplate) {
  return {
    subjectTemplate: t.subject,
    bodyTemplate: t.body,
    includeMap: t.includeMap,
    mapUrl: t.mapUrl,
    includeWhatsapp: t.includeWhatsapp,
    whatsappUrl: t.whatsappUrl,
  };
}

export const IMAGE_MARKER = '[[PASS_IMAGE]]';
export const DETAILS_MARKER = '[[PASS_DETAILS]]';

/** Replace @key / {{key}} placeholders (longest first so @event_date never clips @event_date_x). */
export function mergePassTemplate(template: string, vars: Record<string, string>): string {
  const keys = Object.keys(vars).sort((a, b) => b.length - a.length);
  let out = template;
  for (const k of keys) {
    out = out.replace(new RegExp(`@${k}\\b|\\{\\{${k}\\}\\}`, 'gi'), () => vars[k]);
  }
  return out
    .replace(/@pass_image\b|\{\{pass_image\}\}/gi, IMAGE_MARKER)
    .replace(/@details\b|\{\{details\}\}/gi, DETAILS_MARKER);
}

const STORAGE_KEY = 'leads_pass_email_template_v1';

export function loadPassEmailTemplate(): PassEmailTemplate {
  const fallback = { subject: DEFAULT_PASS_EMAIL_SUBJECT, body: DEFAULT_PASS_EMAIL_BODY };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      subject: typeof parsed.subject === 'string' && parsed.subject.trim() ? parsed.subject : fallback.subject,
      body: typeof parsed.body === 'string' && parsed.body.trim() ? parsed.body : fallback.body,
      includeMap: parsed.includeMap === true,
      mapUrl: typeof parsed.mapUrl === 'string' ? parsed.mapUrl : '',
      includeWhatsapp: parsed.includeWhatsapp === true,
      whatsappUrl: typeof parsed.whatsappUrl === 'string' ? parsed.whatsappUrl : '',
    };
  } catch {
    return fallback;
  }
}

export function savePassEmailTemplate(t: PassEmailTemplate): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* storage unavailable — the template just won't persist */
  }
}
