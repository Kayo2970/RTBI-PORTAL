/**
 * Event-attendance certificates (server only): per-event template, eligibility, A4 PDF rendering and emailing.
 * One record per pass in the `certificates` collection keeps re-sends idempotent and powers the public verify page.
 * Template files live in their own upload category so the pass-theme retention purge never deletes them.
 */
import { randomBytes } from 'crypto';
import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from '@napi-rs/canvas';
import { jsPDF } from 'jspdf';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { saveBase64File, readStoredFile, deleteStoredFile, deleteStoredFilesForRecord } from '@/lib/file-storage';
import { dispatchEmail, EmailLog } from '@/lib/email-service';
import { getAppBaseUrl } from '@/lib/app-url';
import { drawStyledQr } from '@/lib/qr-style';
import type { EmailBackgroundChoice } from '@/lib/email-background';
import { registerCustomFonts } from '@/lib/certificate-fonts';
import { customFamily } from '@/lib/certificate-fonts';
import { CERT_W, CERT_H, CERT_FONT_OPTIONS, CertBox, CertLayout, DEFAULT_CERT_LAYOUT, normalizeLayout, isCustomFont, CertEmailMessage, DEFAULT_CERT_EMAIL, mergeCertEmail } from '@/lib/certificate-layout';
import { EventItem, EventPassItem, getPassAttendanceSummary, getEffectiveEventStatus, formatEventDateRange } from '@/lib/local-data';

const CATEGORY = 'certificate-templates';
const TEMPLATE_FILE_INDEX = 0;
const BACKGROUND_FILE_INDEX = 1;
const HEX = /^#[0-9a-fA-F]{6}$/;
const TYPES_FILE_INDEX = 2;

/** An event can have several kinds of certificate (Participation, Volunteer, Speaker...). `default` is always present. */
export const DEFAULT_TYPE_ID = 'default';
export interface CertificateType { id: string; name: string }

export function cleanTypeId(typeId?: string | null): string {
  return typeof typeId === 'string' && /^[a-z0-9]{3,24}$/.test(typeId) ? typeId : DEFAULT_TYPE_ID;
}
/** Upload folder owner: the default type keeps the original per-event folder, so existing designs are untouched. */
function typeOwner(eventId: string, typeId?: string | null): string {
  const t = cleanTypeId(typeId);
  return t === DEFAULT_TYPE_ID ? eventId : `${eventId}__${t}`;
}

export interface CertificateTemplate {
  title: string;
  /** Line printed above the attendee's name. */
  introText: string;
  /** @event_name, @event_date and @name are merged in. */
  bodyText: string;
  signatoryName: string;
  signatoryTitle: string;
  /** Which attendee field is printed in the name box. */
  nameSource: 'name' | 'organisation' | 'category' | 'serial';
  /** Default ink; a box with its own colour overrides it. */
  textColor: string;
  /** Position, size and font of every text box (name, content, heading, ...). */
  layout: CertLayout;
  backgroundKey?: string;
}

export const DEFAULT_CERTIFICATE_TEMPLATE: CertificateTemplate = {
  title: 'Certificate of Participation',
  introText: 'This is to certify that',
  bodyText: 'has successfully attended @event_name held on @event_date, organised by RTBI, RUAS.',
  signatoryName: '',
  signatoryTitle: 'RTBI',
  nameSource: 'name',
  textColor: '#1e293b',
  layout: DEFAULT_CERT_LAYOUT,
};

export interface CertificateRecord {
  id: string;
  code: string;
  passId: string;
  eventId: string;
  attendeeName: string;
  attendeeEmail: string;
  eventName: string;
  eventDate: string;
  issuedAt: string;
  sentAt?: string;
  status: 'Issued' | 'Sent' | 'Failed';
  error?: string;
  /** Which certificate type of the event this is (absent = the default type). */
  typeId?: string;
  typeName?: string;
  /** Created by hand for someone without a pass; passId is then `manual-…`. */
  manual?: boolean;
  organisation?: string;
  category?: string;
  /** Email log entry the certificate went out in — lets the ledger report real delivery, not just queueing. */
  emailLogId?: string;
  sentBy?: string;
  /** Set by the 30-day retention run: the full-size render is dropped and only this small background-free thumbnail is kept for the verify page. */
  thumbKey?: string;
  archivedAt?: string;
}

// ── Template storage ────────────────────────────────────────────────────────────

export async function getCertificateTemplate(eventId: string, typeId?: string | null): Promise<CertificateTemplate> {
  try {
    const buf = await readStoredFile(`${CATEGORY}/${typeOwner(eventId, typeId)}/${TEMPLATE_FILE_INDEX}__template.json`);
    const stored = JSON.parse(buf.toString('utf8'));
    return { ...DEFAULT_CERTIFICATE_TEMPLATE, ...stored, layout: normalizeLayout(stored.layout) };
  } catch {
    return { ...DEFAULT_CERTIFICATE_TEMPLATE };
  }
}

/** Saves text settings; `backgroundDataUrl` replaces the artwork, `null` removes it, `undefined` keeps it. */
export async function saveCertificateTemplate(
  eventId: string,
  input: Partial<CertificateTemplate>,
  backgroundDataUrl?: string | null,
  typeId?: string | null
): Promise<CertificateTemplate> {
  const owner = typeOwner(eventId, typeId);
  const current = await getCertificateTemplate(eventId, typeId);
  const clip = (v: unknown, max: number, fallback: string) => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);
  const next: CertificateTemplate = {
    title: clip(input.title, 80, current.title) || DEFAULT_CERTIFICATE_TEMPLATE.title,
    introText: input.introText === undefined ? current.introText : clip(input.introText, 120, current.introText),
    bodyText: clip(input.bodyText, 400, current.bodyText) || DEFAULT_CERTIFICATE_TEMPLATE.bodyText,
    signatoryName: clip(input.signatoryName, 80, current.signatoryName),
    signatoryTitle: clip(input.signatoryTitle, 80, current.signatoryTitle),
    nameSource: ['name', 'organisation', 'category', 'serial'].includes(input.nameSource as string) ? (input.nameSource as CertificateTemplate['nameSource']) : current.nameSource,
    textColor: typeof input.textColor === 'string' && HEX.test(input.textColor) ? input.textColor : current.textColor,
    layout: input.layout === undefined ? current.layout : normalizeLayout(input.layout),
    backgroundKey: current.backgroundKey,
  };
  if (backgroundDataUrl === null && current.backgroundKey) {
    await deleteStoredFile(current.backgroundKey);
    next.backgroundKey = undefined;
  } else if (typeof backgroundDataUrl === 'string' && backgroundDataUrl) {
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(backgroundDataUrl)) throw new Error('Artwork must be a PNG, JPG or WebP image.');
    // Re-encode as a capped JPEG so a huge upload can't bloat every PDF
    const img = await loadImage(Buffer.from(backgroundDataUrl.split(',')[1] || '', 'base64'));
    const scale = Math.min(1, 2480 / Math.max(img.width, img.height));
    const c = createCanvas(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
    const cctx = c.getContext('2d');
    cctx.fillStyle = '#fff';
    cctx.fillRect(0, 0, c.width, c.height);
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(img, 0, 0, c.width, c.height);
    if (current.backgroundKey) await deleteStoredFile(current.backgroundKey);
    const saved = await saveBase64File(CATEGORY, owner, BACKGROUND_FILE_INDEX, 'background.jpg', `data:image/jpeg;base64,${c.toBuffer('image/jpeg', 95).toString('base64')}`);
    next.backgroundKey = saved.storageKey;
  }
  const payload = Buffer.from(JSON.stringify(next)).toString('base64');
  await saveBase64File(CATEGORY, owner, TEMPLATE_FILE_INDEX, 'template.json', `data:application/json;base64,${payload}`);
  return next;
}

// ── Certificate types (several designs per event) ─────────────────────────────

export async function getCertificateTypes(eventId: string): Promise<CertificateType[]> {
  let stored: CertificateType[] = [];
  try {
    const parsed = JSON.parse((await readStoredFile(`${CATEGORY}/${eventId}/${TYPES_FILE_INDEX}__types.json`)).toString('utf8'));
    if (Array.isArray(parsed)) stored = parsed.filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string');
  } catch {
    /* none yet */
  }
  const def = stored.find((t) => t.id === DEFAULT_TYPE_ID);
  return [{ id: DEFAULT_TYPE_ID, name: def?.name || 'Participation' }, ...stored.filter((t) => t.id !== DEFAULT_TYPE_ID)];
}

async function saveCertificateTypes(eventId: string, types: CertificateType[]): Promise<void> {
  const payload = Buffer.from(JSON.stringify(types)).toString('base64');
  await saveBase64File(CATEGORY, eventId, TYPES_FILE_INDEX, 'types.json', `data:application/json;base64,${payload}`);
}

const cleanName = (n: unknown) => (typeof n === 'string' ? n.trim().replace(/\s+/g, ' ').slice(0, 60) : '');

/** Adds a type; `copyFrom` clones that type's wording, layout and artwork as the starting point. */
export async function createCertificateType(eventId: string, name: string, copyFrom?: string | null): Promise<CertificateType[]> {
  const clean = cleanName(name);
  if (!clean) throw new Error('Give the certificate type a name.');
  const types = await getCertificateTypes(eventId);
  if (types.length >= 12) throw new Error('An event can have at most 12 certificate types.');
  if (types.some((t) => t.name.toLowerCase() === clean.toLowerCase())) throw new Error('That event already has a certificate type with this name.');
  const id = `t${randomBytes(4).toString('hex')}`;
  const base = copyFrom ? await getCertificateTemplate(eventId, copyFrom) : { ...DEFAULT_CERTIFICATE_TEMPLATE, title: clean };
  const next: CertificateTemplate = { ...base, backgroundKey: undefined };
  if (copyFrom && base.backgroundKey) {
    try {
      const bytes = await readStoredFile(base.backgroundKey);
      const saved = await saveBase64File(CATEGORY, typeOwner(eventId, id), BACKGROUND_FILE_INDEX, 'background.jpg', `data:image/jpeg;base64,${bytes.toString('base64')}`);
      next.backgroundKey = saved.storageKey;
    } catch {
      /* artwork missing: the copy simply starts without it */
    }
  }
  await saveBase64File(CATEGORY, typeOwner(eventId, id), TEMPLATE_FILE_INDEX, 'template.json', `data:application/json;base64,${Buffer.from(JSON.stringify(next)).toString('base64')}`);
  const out = [...types, { id, name: clean }];
  await saveCertificateTypes(eventId, out);
  return out;
}

export async function renameCertificateType(eventId: string, typeId: string, name: string): Promise<CertificateType[]> {
  const clean = cleanName(name);
  if (!clean) throw new Error('Give the certificate type a name.');
  const t = cleanTypeId(typeId);
  const types = await getCertificateTypes(eventId);
  if (!types.some((x) => x.id === t)) throw new Error('Certificate type not found.');
  if (types.some((x) => x.id !== t && x.name.toLowerCase() === clean.toLowerCase())) throw new Error('That event already has a certificate type with this name.');
  const out = types.map((x) => (x.id === t ? { ...x, name: clean } : x));
  await saveCertificateTypes(eventId, out);
  return out;
}

/** Removes a type and its design. Refused while certificates of that type exist, so issued IDs keep verifying. */
export async function deleteCertificateType(eventId: string, typeId: string): Promise<CertificateType[]> {
  const t = cleanTypeId(typeId);
  if (t === DEFAULT_TYPE_ID) throw new Error('The default certificate type cannot be deleted.');
  const used = (await readCollection<CertificateRecord>('certificates')).some((c) => c.eventId === eventId && cleanTypeId(c.typeId) === t);
  if (used) throw new Error('Certificates of this type were already created, so it cannot be deleted.');
  const types = (await getCertificateTypes(eventId)).filter((x) => x.id !== t);
  await deleteStoredFilesForRecord(CATEGORY, typeOwner(eventId, t));
  await saveCertificateTypes(eventId, types);
  return types;
}

// ── Eligibility ─────────────────────────────────────────────────────────────────

/** Attended = checked in at least once. Needs an email, and not cancelled / held for approval. */
export function isCertificateEligible(pass: EventPassItem): boolean {
  if (pass.status === 'Cancelled' || !pass.attendeeEmail?.trim()) return false;
  if ((pass as any).approvalStatus && (pass as any).approvalStatus !== 'approved') return false;
  return pass.status === 'Checked In' || getPassAttendanceSummary(pass).attended > 0;
}

/** Certificates open on the event's last day itself (not only the day after), so they can go out the same day. */
export function isEventOver(event: EventItem | undefined): boolean {
  if (!event || event.datesTBD) return false;
  if (getEffectiveEventStatus(event) === 'completed') return true;
  if (event.status === 'archived') return false;
  const lastDay = event.endDate || event.startDate;
  return !!lastDay && lastDay <= new Date().toISOString().split('T')[0];
}

// ── Rendering ───────────────────────────────────────────────────────────────────

const W = CERT_W;
const H = CERT_H;
const FONT_FILES: Array<[string, string]> = [
  ['/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf', 'CertSerif'],
  ['/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf', 'CertSerif'],
  ['/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf', 'CertSerif'],
  ['/usr/share/fonts/truetype/liberation/LiberationSerif-BoldItalic.ttf', 'CertSerif'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', 'CertSans'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 'CertSans'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf', 'CertSans'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf', 'CertSans'],
  ['/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf', 'CertMono'],
  ['/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf', 'CertMono'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', 'CertSerifFallback'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'CertDejaVu'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'CertDejaVu'],
];
let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  fontsReady = true;
  for (const [file, family] of FONT_FILES) {
    try {
      GlobalFonts.registerFromPath(file, family); // missing file just throws -> generic fallback
    } catch {
      /* fall back to generic font */
    }
  }
}

function fontCss(box: CertBox, size: number): string {
  const fam = isCustomFont(box.fontFamily)
    ? `${customFamily(box.fontFamily.slice(7))}, ${CERT_FONT_OPTIONS[0].css}`
    : (CERT_FONT_OPTIONS.find((f) => f.id === box.fontFamily) || CERT_FONT_OPTIONS[0]).css;
  return `${box.italic ? 'italic ' : ''}${box.bold ? 'bold ' : ''}${size}px ${fam}`;
}

/** Breaks one over-wide word into pieces that fit. */
function breakWord(ctx: SKRSContext2D, word: string, maxWidth: number): string[] {
  const parts: string[] = [];
  let rest = word;
  while (rest.length > 1 && ctx.measureText(rest).width > maxWidth) {
    let cut = rest.length - 1;
    while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) cut--;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  parts.push(rest);
  return parts;
}

function wrapLines(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const raw of para.split(/\s+/).filter(Boolean)) {
      const pieces = ctx.measureText(raw).width > maxWidth ? breakWord(ctx, raw, maxWidth) : [raw];
      pieces.forEach((word, i) => {
        const test = line && i === 0 ? `${line} ${word}` : word;
        if (line && ctx.measureText(test).width > maxWidth) {
          lines.push(line);
          line = word;
        } else if (i > 0 && line) {
          lines.push(line);
          line = word;
        } else line = test;
      });
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Draws `text` inside the box: wraps to the box width, optionally shrinks until it fits the box height / line limit,
 * aligns it, and clips anything that still overflows. Returns the drawn size and block bounds.
 */
function drawTextBox(ctx: SKRSContext2D, text: string, box: CertBox, fallbackColor: string) {
  const bx = (box.x / 100) * W;
  const by = (box.y / 100) * H;
  const bw = (box.w / 100) * W;
  const bh = (box.h / 100) * H;
  const LH = 1.3;
  let size = box.fontSize;
  let lines: string[] = [];
  const layoutAt = (s: number) => {
    ctx.font = fontCss(box, s);
    lines = wrapLines(ctx, text, bw);
    if (box.maxLines > 0 && lines.length > box.maxLines) {
      lines = lines.slice(0, box.maxLines);
      return false;
    }
    return lines.length * s * LH <= bh + 0.5;
  };
  let fits = layoutAt(size);
  if (box.autoFit) {
    while (!fits && size > 8) {
      size -= 2;
      fits = layoutAt(size);
    }
    if (!fits) layoutAt(size);
  }
  ctx.font = fontCss(box, size);
  const lineH = size * LH;
  const blockH = lines.length * lineH;
  const top = box.valign === 'top' ? by : box.valign === 'bottom' ? by + bh - blockH : by + (bh - blockH) / 2;
  const ax = box.align === 'left' ? bx : box.align === 'right' ? bx + bw : bx + bw / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, by, bw, bh);
  ctx.clip();
  ctx.fillStyle = box.color || fallbackColor;
  ctx.globalAlpha = box.opacity;
  ctx.textAlign = box.align;
  if (box.valign === 'bottom') {
    // Bottom-anchored: the lowest letters (including descenders like g, y, p) rest on the box's bottom edge.
    ctx.textBaseline = 'alphabetic';
    const descent = ctx.measureText('gjpqy').actualBoundingBoxDescent || size * 0.22;
    lines.forEach((l, i) => ctx.fillText(l, ax, by + bh - descent - (lines.length - 1 - i) * lineH));
  } else {
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, ax, top + lineH * (i + 0.5)));
  }
  if (box.underline && lines.length) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const w = Math.min(widest + 80, bw);
    const ux = box.align === 'left' ? bx : box.align === 'right' ? bx + bw - w : bx + (bw - w) / 2;
    ctx.fillRect(ux, Math.min(top + blockH + 2, by + bh - 3), w, 3);
  }
  ctx.restore();
  return { size, top, blockH, bx, by, bw, bh };
}

function merge(text: string, vars: Record<string, string>): string {
  return text.replace(/@(name|event_name|event_date|organisation|category|serial)\b/gi, (_, k: string) => vars[k.toLowerCase()] ?? '');
}

export async function renderCertificatePng(
  data: { attendeeName: string; eventName: string; eventDate: string; code: string; organisation?: string; category?: string; serial?: string; manual?: boolean },
  template: CertificateTemplate,
  verifyUrl: string,
  /** Pixel multiplier on the 1754x1240 design space: 1 = quick preview, 2 = 300 dpi print/PDF quality. */
  scale = 1,
  /** Leave the artwork out (thumbnails after the retention period) — plain paper with the thin frame. */
  skipBackground = false
): Promise<Buffer> {
  ensureFonts();
  await registerCustomFonts();
  const canvas = createCanvas(Math.round(W * scale), Math.round(H * scale));
  const ctx = canvas.getContext('2d');
  // Layouts stay in the 1754x1240 coordinate space; only the pixel density changes.
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const ink = template.textColor;
  const L = template.layout;

  ctx.fillStyle = '#fffdf7';
  ctx.fillRect(0, 0, W, H);
  let hasArt = false;
  if (template.backgroundKey && !skipBackground) {
    try {
      const art = await loadImage(await readStoredFile(template.backgroundKey));
      const s = Math.max(W / art.width, H / art.height);
      ctx.drawImage(art, (W - art.width * s) / 2, (H - art.height * s) / 2, art.width * s, art.height * s);
      hasArt = true;
    } catch {
      /* fall back to the plain design */
    }
  }
  if (!hasArt) {
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 10;
    ctx.strokeRect(50, 50, W - 100, H - 100);
    ctx.lineWidth = 2;
    ctx.strokeRect(75, 75, W - 150, H - 150);
  }

  const vars = { name: data.attendeeName, event_name: data.eventName, event_date: data.eventDate, organisation: data.organisation || '', category: data.category || '', serial: data.serial || '' };
  // A manual certificate (typed in, or picked from the Members Directory) always prints the name that was entered — its
  // category / organisation are a designation / department there, so "Print in the name box" only applies to pass-based ones.
  const nameText = data.manual ? data.attendeeName : ({ name: data.attendeeName, organisation: data.organisation || data.attendeeName, category: data.category || data.attendeeName, serial: data.serial || data.attendeeName } as Record<string, string>)[template.nameSource] || data.attendeeName;
  if (L.title.enabled) drawTextBox(ctx, merge(template.title, vars).toUpperCase(), L.title, ink);
  if (L.intro.enabled && template.introText) drawTextBox(ctx, merge(template.introText, vars), L.intro, ink);
  if (L.name.enabled) drawTextBox(ctx, nameText, { ...L.name, align: 'center' }, ink);
  if (L.body.enabled) drawTextBox(ctx, merge(template.bodyText, vars), L.body, ink);

  // Signatory: a rule with the name and designation under it
  if (L.signatory.enabled) {
    const sg = L.signatory;
    const sx = (sg.x / 100) * W;
    const sy = (sg.y / 100) * H;
    const sw = (sg.w / 100) * W;
    const sh = (sg.h / 100) * H;
    ctx.fillStyle = sg.color || ink;
    ctx.fillRect(sx, sy, sw, 2);
    const nameH = sh * 0.55;
    if (template.signatoryName) drawTextBox(ctx, template.signatoryName, { ...sg, y: ((sy + 8) / H) * 100, h: (nameH / H) * 100, valign: 'middle' }, ink);
    if (template.signatoryTitle) {
      drawTextBox(ctx, template.signatoryTitle, { ...sg, bold: false, fontSize: Math.round(sg.fontSize * 0.78), y: ((sy + 8 + nameH) / H) * 100, h: ((sh - nameH - 8) / H) * 100, valign: 'middle' }, ink);
    }
  }

  // Verify QR + certificate ID
  if (L.qr.enabled) {
    const q = L.qr;
    const qr = (q.w / 100) * W;
    const qx = (q.x / 100) * W;
    const qy = (q.y / 100) * H;
    drawStyledQr(ctx, verifyUrl, qx, qy, qr, { dark: q.color || ink, light: '#ffffff', shape: 'square' } as any);
    drawTextBox(ctx, `ID ${data.code}`, { ...q, x: q.x - 2, w: q.w + 4, y: ((qy + qr + 4) / H) * 100, h: (Math.max(24, q.fontSize * 1.6) / H) * 100, align: 'center', valign: 'top', maxLines: 1 }, ink);
  }
  return canvas.toBuffer('image/png');
}

export function pngToPdf(png: Buffer): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  // 'FAST' = lossless deflate. jsPDF's default stores the raster uncompressed (~26 MB at 300 dpi).
  doc.addImage(`data:image/png;base64,${png.toString('base64')}`, 'PNG', 0, 0, 297, 210, undefined, 'FAST');
  return Buffer.from(doc.output('arraybuffer'));
}

// ── Records + sending ───────────────────────────────────────────────────────────

export function eventDateLabel(event: EventItem): string {
  return formatEventDateRange(event);
}

export function verifyUrlFor(origin: string, code: string): string {
  return `${origin}/certificate/${code}`;
}

/** Finds or creates the certificate record for a pass (one per pass). */
export async function ensureCertificateRecord(pass: EventPassItem, event: EventItem, typeId?: string | null, typeName?: string): Promise<CertificateRecord> {
  let result!: CertificateRecord;
  const type = cleanTypeId(typeId);
  await mutateCollection<CertificateRecord>('certificates', (current = []) => {
    const found = current.find((c) => c.passId === pass.id && cleanTypeId(c.typeId) === type);
    if (found) {
      result = found;
      return current;
    }
    const code = randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').toUpperCase();
    result = {
      id: `cert-${Date.now()}-${randomBytes(3).toString('hex')}`,
      code,
      passId: pass.id,
      eventId: pass.eventId,
      attendeeName: pass.attendeeName,
      attendeeEmail: (pass.attendeeEmail || '').trim(),
      eventName: event.title || pass.eventName,
      eventDate: eventDateLabel(event),
      issuedAt: new Date().toISOString(),
      status: 'Issued',
      ...(type !== DEFAULT_TYPE_ID ? { typeId: type } : {}),
      ...(typeName ? { typeName } : {}),
    };
    return [...current, result];
  });
  return result;
}

export function passExtras(pass?: EventPassItem) {
  return { organisation: pass?.attendeeOrg || '', category: String(pass?.guestCategory || ''), serial: pass?.serialNumber || '' };
}

/** Same merge fields for a record: from its pass when it has one, from the typed-in details for a manual certificate. */
export function recordExtras(rec: CertificateRecord, pass?: EventPassItem) {
  return pass ? passExtras(pass) : { organisation: rec.organisation || '', category: rec.category || '', serial: '' };
}

/** Creates a certificate on the spot for someone without a pass. */
export async function createManualCertificate(
  event: EventItem,
  input: { name: string; email?: string; organisation?: string; category?: string },
  typeId?: string | null,
  typeName?: string
): Promise<CertificateRecord> {
  const name = (input.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!name) throw new Error('Enter the name to print on the certificate.');
  const email = (input.email || '').trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error('That email address is not valid.');
  const type = cleanTypeId(typeId);
  const rec: CertificateRecord = {
    id: `cert-${Date.now()}-${randomBytes(3).toString('hex')}`,
    code: randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').toUpperCase(),
    passId: `manual-${randomBytes(6).toString('hex')}`,
    eventId: event.id,
    attendeeName: name,
    attendeeEmail: email,
    eventName: event.title,
    eventDate: eventDateLabel(event),
    issuedAt: new Date().toISOString(),
    status: 'Issued',
    manual: true,
    organisation: (input.organisation || '').trim().slice(0, 120),
    category: (input.category || '').trim().slice(0, 80),
    ...(type !== DEFAULT_TYPE_ID ? { typeId: type } : {}),
    ...(typeName ? { typeName } : {}),
  };
  await mutateCollection<CertificateRecord>('certificates', (cur = []) => [...cur, rec]);
  return rec;
}

export async function renderCertificatePdf(rec: CertificateRecord, origin: string, pass?: EventPassItem): Promise<Buffer> {
  const template = await getCertificateTemplate(rec.eventId, rec.typeId);
  const png = await renderCertificatePng({ ...rec, ...recordExtras(rec, pass) }, template, verifyUrlFor(origin, rec.code), 2);
  return pngToPdf(png);
}

/** Emails the PDF for an existing record and records the outcome. `pass` is absent for manual certificates. */
async function sendRecord(
  rec: CertificateRecord,
  origin: string,
  recipient: string,
  message?: CertEmailMessage,
  sentBy?: string,
  pass?: EventPassItem,
  background?: EmailBackgroundChoice
): Promise<{ ok: boolean; error?: string; record: CertificateRecord }> {
  try {
    if (!recipient) throw new Error('No email address.');
    const pdf = await renderCertificatePdf(rec, origin, pass);
    const verify = verifyUrlFor(origin, rec.code);
    const msg = message || DEFAULT_CERT_EMAIL;
    const vars = { name: rec.attendeeName, email: recipient, event: rec.eventName, date: rec.eventDate, code: rec.code, verifyUrl: verify };
    const log = await dispatchEmail({
      to: recipient,
      subject: mergeCertEmail(msg.subject, vars),
      bodyText: mergeCertEmail(msg.bodyText, vars),
      category: 'CERTIFICATE',
      attachments: [{ filename: `Certificate-${rec.attendeeName.replace(/[^\w]+/g, '_')}.pdf`, content: pdf, contentType: 'application/pdf' }],
      background,
    });
    const sentAt = new Date().toISOString();
    await mutateCollection<CertificateRecord>('certificates', (cur = []) => cur.map((c) => (c.id === rec.id ? { ...c, status: 'Sent', sentAt, error: undefined, emailLogId: log?.id, sentBy, ...(recipient !== c.attendeeEmail && c.manual ? { attendeeEmail: recipient } : {}) } : c)));
    return { ok: true, record: { ...rec, status: 'Sent', sentAt, emailLogId: log?.id, sentBy } };
  } catch (err: any) {
    const error = err?.message || 'Failed to send.';
    await mutateCollection<CertificateRecord>('certificates', (cur = []) => cur.map((c) => (c.id === rec.id ? { ...c, status: 'Failed', error } : c)));
    return { ok: false, error, record: { ...rec, status: 'Failed', error } };
  }
}

export async function sendCertificate(
  pass: EventPassItem,
  event: EventItem,
  origin: string,
  to?: string,
  message?: CertEmailMessage,
  sentBy?: string,
  typeId?: string | null,
  typeName?: string,
  background?: EmailBackgroundChoice
): Promise<{ ok: boolean; error?: string; record: CertificateRecord }> {
  const rec = await ensureCertificateRecord(pass, event, typeId, typeName);
  return sendRecord(rec, origin, (to || pass.attendeeEmail || '').trim(), message, sentBy, pass, background);
}

/** Emails a certificate that was created by hand (no pass). */
export async function sendManualCertificate(rec: CertificateRecord, origin: string, to?: string, message?: CertEmailMessage, sentBy?: string, background?: EmailBackgroundChoice) {
  return sendRecord(rec, origin, (to || rec.attendeeEmail || '').trim(), message, sentBy, undefined, background);
}

export async function findCertificateByCode(code: string): Promise<CertificateRecord | undefined> {
  const all = await readCollection<CertificateRecord>('certificates');
  return all.find((c) => c.code.toLowerCase() === String(code).toLowerCase());
}

/** Renders what one attendee's certificate looks like right now (no record is created, nothing is sent). */
export async function renderPassPreview(pass: EventPassItem, event: EventItem, origin: string, scale = 1, typeId?: string | null): Promise<Buffer> {
  const template = await getCertificateTemplate(pass.eventId, typeId);
  return renderCertificatePng(
    { attendeeName: pass.attendeeName, eventName: event.title || pass.eventName, eventDate: eventDateLabel(event), code: 'PREVIEW000', ...passExtras(pass) },
    template,
    verifyUrlFor(origin, 'PREVIEW000'),
    scale
  );
}

/** Sends one certificate per eligible pass; shared by the send route and the scheduler. */
export async function sendCertificatesBatch(
  event: EventItem,
  passIds: string[],
  origin: string,
  emails?: Record<string, string>,
  message?: CertEmailMessage,
  sentBy?: string,
  typeId?: string | null,
  background?: EmailBackgroundChoice
): Promise<Array<{ passId: string; ok: boolean; error?: string }>> {
  const passes = await readCollection<EventPassItem>('event_passes');
  const type = cleanTypeId(typeId);
  const typeName = (await getCertificateTypes(event.id)).find((t) => t.id === type)?.name;
  const results: Array<{ passId: string; ok: boolean; error?: string }> = [];
  for (const passId of passIds) {
    if (passId.startsWith('manual-')) {
      const rec = (await readCollection<CertificateRecord>('certificates')).find((c) => c.passId === passId && c.eventId === event.id && cleanTypeId(c.typeId) === type);
      if (!rec) {
        results.push({ passId, ok: false, error: 'Certificate not found.' });
        continue;
      }
      const to = emails?.[passId];
      const r = await sendManualCertificate(rec, origin, typeof to === 'string' && /^\S+@\S+\.\S+$/.test(to.trim()) ? to : undefined, message, sentBy, background);
      results.push({ passId, ok: r.ok, error: r.error });
      continue;
    }
    const pass = passes.find((p) => p.id === passId && p.eventId === event.id);
    if (!pass || !isCertificateEligible(pass)) {
      results.push({ passId, ok: false, error: 'Not eligible (no check-in or no email).' });
      continue;
    }
    const to = emails?.[passId];
    const r = await sendCertificate(pass, event, origin, typeof to === 'string' && /^\S+@\S+\.\S+$/.test(to.trim()) ? to : undefined, message, sentBy, type, typeName, background);
    results.push({ passId, ok: r.ok, error: r.error });
  }
  return results;
}

// ── Ledger: what has been issued / sent to whom, and when ───────────────────────

export type CertDisplayStatus = 'Not issued' | 'Issued' | 'Queued' | 'Sent' | 'Failed';

export interface CertStatusInfo {
  status: CertDisplayStatus;
  code?: string;
  issuedAt?: string;
  /** When the email actually left the server (or, while still queued, when it was queued). */
  sentAt?: string;
  sentBy?: string;
  error?: string;
  typeId?: string;
  typeName?: string;
  /** How many certificates (across types) exist for this pass. */
  count?: number;
}

const STATUS_RANK: Record<CertDisplayStatus, number> = { 'Not issued': 0, Issued: 1, Failed: 2, Queued: 3, Sent: 4 };

/**
 * Per-pass certificate status. "Issued" = exists but not emailed; "Queued" = in the 10-minute email buffer; "Sent" = the mail server
 * accepted it; "Failed" = could not be sent, or the queued mail failed / was cancelled. Passes with no record are absent (shown as "Not issued").
 * With `typeId` it is that certificate type only; without, it is the most advanced status across all of
 * the pass's certificates, with `count` saying how many certificates exist for it.
 */
/** Real delivery status of one certificate record, folding in the email log (queued / sent / failed). */
function describeRecord(r: CertificateRecord, logs: Map<string, EmailLog>): CertStatusInfo {
  const info: CertStatusInfo = { status: 'Issued', code: r.code, issuedAt: r.issuedAt, sentBy: r.sentBy, typeId: cleanTypeId(r.typeId), typeName: r.typeName, count: 1 };
  if (r.status === 'Failed') {
    info.status = 'Failed';
    info.error = r.error;
  } else if (r.status === 'Sent') {
    const log = r.emailLogId ? logs.get(r.emailLogId) : undefined;
    info.sentAt = r.sentAt;
    if (!log) info.status = 'Sent'; // sent before delivery tracking existed
    else if (log.status === 'BUFFERED') info.status = 'Queued';
    else if (log.status === 'SENT') {
      info.status = 'Sent';
      info.sentAt = log.sentAt || r.sentAt;
    } else {
      info.status = 'Failed';
      info.error = log.errorMessage || (log.status === 'CANCELLED' ? 'Email was cancelled before it was sent.' : 'Email failed to send.');
    }
  }
  return info;
}

async function loadCertificateLogs(): Promise<Map<string, EmailLog>> {
  return new Map((await readCollection<EmailLog>('emails')).filter((l) => l.category === 'CERTIFICATE').map((l) => [l.id, l]));
}

export interface IssuedCertificateRow extends CertStatusInfo {
  id: string;
  passId: string;
  eventId: string;
  eventName: string;
  eventDate: string;
  attendeeName: string;
  attendeeEmail: string;
  organisation?: string;
  category?: string;
  manual?: boolean;
  /** Past the 30-day retention: only a thumbnail is kept. */
  archivedAt?: string;
}

/** Every certificate ever issued (one row each, newest first) with its live delivery status — feeds the Issued Certificates box. */
export async function listIssuedCertificates(eventId?: string): Promise<IssuedCertificateRow[]> {
  const records = (await readCollection<CertificateRecord>('certificates')).filter((c) => !eventId || c.eventId === eventId);
  const logs = await loadCertificateLogs();
  return records
    .map((r) => ({
      ...describeRecord(r, logs),
      id: r.id,
      passId: r.passId,
      eventId: r.eventId,
      eventName: r.eventName,
      eventDate: r.eventDate,
      attendeeName: r.attendeeName,
      attendeeEmail: r.attendeeEmail,
      organisation: r.organisation,
      category: r.category,
      manual: r.manual,
      archivedAt: r.archivedAt,
    }))
    .sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')));
}

export async function getCertificateStatuses(eventId?: string, typeId?: string | null): Promise<Record<string, CertStatusInfo>> {
  const type = typeId ? cleanTypeId(typeId) : undefined;
  const records = (await readCollection<CertificateRecord>('certificates')).filter((c) => (!eventId || c.eventId === eventId) && (!type || cleanTypeId(c.typeId) === type));
  const logs = await loadCertificateLogs();
  const out: Record<string, CertStatusInfo> = {};
  for (const r of records) {
    const info = describeRecord(r, logs);
    const prev = out[r.passId];
    if (!prev) out[r.passId] = info;
    else out[r.passId] = { ...(STATUS_RANK[info.status] > STATUS_RANK[prev.status] ? info : prev), count: (prev.count || 1) + 1 };
  }
  return out;
}

// ── Delete & 30-day retention ───────────────────────────────────────────────────

const THUMB_CATEGORY = 'certificate-thumbs';
export const CERTIFICATE_RETENTION_DAYS = 30;

/** Permanently removes issued certificates (and their kept thumbnails). Their verify links stop working. Returns how many were removed. */
export async function deleteCertificates(ids: string[]): Promise<number> {
  const wanted = new Set(ids.filter((i) => typeof i === 'string' && i));
  if (wanted.size === 0) return 0;
  let removed: CertificateRecord[] = [];
  await mutateCollection<CertificateRecord>('certificates', (current = []) => {
    removed = current.filter((c) => wanted.has(c.id));
    return current.filter((c) => !wanted.has(c.id));
  });
  for (const r of removed) await deleteStoredFilesForRecord(THUMB_CATEGORY, r.id);
  return removed.length;
}

/** Last day of an event (YYYY-MM-DD): its end/start date, else the latest ISO date found in the stored date label. */
function eventEndIso(event: EventItem | undefined, label: string): string | undefined {
  if (event && !event.datesTBD) {
    const d = event.endDate || event.startDate;
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  }
  const found = (label || '').match(/\d{4}-\d{2}-\d{2}/g);
  return found ? found.sort()[found.length - 1] : undefined;
}

export function isCertificateArchivable(event: EventItem | undefined, label: string, now: Date = new Date()): boolean {
  const end = eventEndIso(event, label);
  if (!end) return false;
  const cutoff = new Date(`${end}T23:59:59`);
  cutoff.setDate(cutoff.getDate() + CERTIFICATE_RETENTION_DAYS);
  return now.getTime() > cutoff.getTime();
}

/**
 * 30 days after an event ends: every certificate that was actually sent keeps only a small background-free thumbnail (served on
 * the public verify page) and the event's artwork images are deleted to free disk space. Text settings are kept.
 */
export async function runCertificateRetention(now: Date = new Date()): Promise<{ archived: number; artworkRemoved: number }> {
  const [records, events] = await Promise.all([readCollection<CertificateRecord>('certificates'), readCollection<EventItem>('events')]);
  const eventById = new Map(events.map((e) => [e.id, e]));
  const due = records.filter((r) => !r.archivedAt && r.status === 'Sent' && isCertificateArchivable(eventById.get(r.eventId), r.eventDate, now));
  const done = new Map<string, string>();
  for (const r of due) {
    try {
      const template = await getCertificateTemplate(r.eventId, r.typeId);
      const png = await renderCertificatePng({ ...r, ...recordExtras(r) }, template, verifyUrlFor(getAppBaseUrl(), r.code), 0.5, true);
      const img = await loadImage(png);
      const c = createCanvas(img.width, img.height);
      const cctx = c.getContext('2d');
      cctx.fillStyle = '#fff';
      cctx.fillRect(0, 0, c.width, c.height);
      cctx.drawImage(img, 0, 0);
      const saved = await saveBase64File(THUMB_CATEGORY, r.id, 0, 'thumb.jpg', `data:image/jpeg;base64,${c.toBuffer('image/jpeg', 80).toString('base64')}`);
      done.set(r.id, saved.storageKey);
    } catch (err) {
      console.error('[certificate-retention] thumbnail failed for', r.code, err);
    }
  }
  if (done.size === 0) return { archived: 0, artworkRemoved: 0 };
  const stamp = now.toISOString();
  await mutateCollection<CertificateRecord>('certificates', (current = []) =>
    current.map((c) => (done.has(c.id) ? { ...c, thumbKey: done.get(c.id), archivedAt: stamp } : c))
  );
  // Artwork of an event can go once none of its certificates is still waiting to be sent
  const after = await readCollection<CertificateRecord>('certificates');
  let artworkRemoved = 0;
  for (const eventId of new Set(due.filter((r) => done.has(r.id)).map((r) => r.eventId))) {
    if (after.some((c) => c.eventId === eventId && !c.archivedAt)) continue;
    for (const t of await getCertificateTypes(eventId)) {
      const tpl = await getCertificateTemplate(eventId, t.id);
      if (tpl.backgroundKey) {
        await saveCertificateTemplate(eventId, {}, null, t.id);
        artworkRemoved += 1;
      }
    }
  }
  return { archived: done.size, artworkRemoved };
}
