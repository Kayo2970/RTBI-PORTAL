/**
 * email-background.ts — optional blurred picture behind an e-mail.
 *
 * Mail clients don't support CSS `filter: blur()`, so the picture is blurred here on the server into a ready-made JPEG
 * (cached under data/uploads/email-backgrounds-blurred/) and used as an ordinary background image, with a solid colour
 * behind it for clients that block images or ignore CSS backgrounds (e.g. desktop Outlook).
 *
 * Where it comes from, per e-mail:
 *   - the default set in Admin → Settings → Email (EmailSettings.background), unless
 *   - the sender picked 'none', or a custom picture ({ storageKey, blur }) for that one send.
 * Every e-mail goes through dispatchEmail(), which calls applyBackgroundTo() — so the certificate, pass, guest-invite
 * and Email-page mail merges (and the one-off notices) all get it without each generator knowing about it.
 */
import { createHash } from 'crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readStoredFile, saveBase64File } from './file-storage';
import { getAppBaseUrl } from './app-url';

/** Uploaded originals live here; a custom per-send storageKey must too. */
export const EMAIL_BACKGROUND_CATEGORY = 'email-backgrounds';
export const MAX_EMAIL_BLUR = 40;
export const DEFAULT_EMAIL_BLUR = 12;
const OUT_WIDTH = 1200;
const OUT_MAX_HEIGHT = 1600;

export interface EmailBackgroundSetting {
  enabled?: boolean;
  storageKey?: string;
  /** Blur radius in pixels (0–40). */
  blur?: number;
}

/** What one send asks for: the saved default, no background, or a specific picture. */
export type EmailBackgroundChoice = 'default' | 'none' | { storageKey: string; blur?: number };

export function clampBlur(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_EMAIL_BLUR;
  return Math.min(MAX_EMAIL_BLUR, Math.max(0, Math.round(n)));
}

/** True for a storage key of an uploaded e-mail background (so a caller can't point at some other file). */
export function isEmailBackgroundKey(key: unknown): key is string {
  return typeof key === 'string' && key.startsWith(`${EMAIL_BACKGROUND_CATEGORY}/`) && !key.includes('..');
}

// ── Blurred copies: creation, usage tracking, retention ──────────────────────────
// A sent e-mail doesn't contain its background — it links to the blurred JPEG on this server, which the recipient's mail app
// fetches whenever the e-mail is opened. So a copy is kept while e-mails using it are still likely to be opened:
//   • full quality for 90 days after the last e-mail that used it,
//   • then shrunk to a tiny blurred version (same URL, so old e-mails keep a soft backdrop),
//   • and removed 180 days after the last use — old e-mails then simply show the plain solid background.
// Sending again with the same picture + blur after that rebuilds a full-quality copy from the uploaded original.
// The daily sweep lives in email-background-retention.ts.

export const BLURRED_CATEGORY = 'email-backgrounds-blurred';
export const SMALL_AFTER_DAYS = 90;
export const DELETE_AFTER_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SMALL_WIDTH = 160;
const SMALL_QUALITY = 35;

export interface BlurredMeta {
  stage: 'full' | 'small';
  /** The last time an e-mail (or preview) used this copy. */
  lastUsedAt: string;
  sourceKey: string;
  blur: number;
}

export const blurredFileKey = (hash: string) => `${BLURRED_CATEGORY}/${hash}/0__bg.jpg`;
const blurredMetaKey = (hash: string) => `${BLURRED_CATEGORY}/${hash}/1__meta.json`;

export async function readBlurredMeta(hash: string): Promise<BlurredMeta | null> {
  try {
    const m = JSON.parse((await readStoredFile(blurredMetaKey(hash))).toString('utf8'));
    return m && (m.stage === 'full' || m.stage === 'small') && typeof m.lastUsedAt === 'string' ? (m as BlurredMeta) : null;
  } catch {
    return null;
  }
}

export async function writeBlurredMeta(hash: string, meta: BlurredMeta): Promise<void> {
  await saveBase64File(BLURRED_CATEGORY, hash, 1, 'meta.json', `data:application/json;base64,${Buffer.from(JSON.stringify(meta)).toString('base64')}`);
}

/** Re-encodes an already-blurred JPEG as a very small one (a few KB); upscaled by the mail app it looks the same, only softer. */
export async function shrinkBlurredJpeg(jpeg: Buffer): Promise<Buffer> {
  const img = await loadImage(jpeg);
  const width = SMALL_WIDTH;
  const height = Math.max(1, Math.round((img.height * width) / img.width));
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas.toBuffer('image/jpeg', SMALL_QUALITY);
}

async function renderBlurredJpeg(storageKey: string, radius: number): Promise<Buffer> {
  const img = await loadImage(await readStoredFile(storageKey));
  const scale = OUT_WIDTH / img.width;
  const width = OUT_WIDTH;
  const height = Math.min(OUT_MAX_HEIGHT, Math.max(1, Math.round(img.height * scale)));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);
  // Draw slightly larger than the canvas so the blur doesn't fade to transparent at the edges.
  const bleed = radius * 2;
  (ctx as unknown as { filter: string }).filter = radius > 0 ? `blur(${radius}px)` : 'none';
  ctx.drawImage(img, -bleed, -bleed, width + bleed * 2, Math.round(img.height * scale) + bleed * 2);
  return canvas.toBuffer('image/jpeg', 80);
}

const urlCache = new Map<string, { path: string; until: number }>();

/** Validates a per-send background choice that arrived from a browser; anything unrecognised means "use the default". */
export function cleanBackgroundChoice(raw: unknown): EmailBackgroundChoice | undefined {
  if (raw === 'none') return 'none';
  if (raw && typeof raw === 'object' && isEmailBackgroundKey((raw as { storageKey?: unknown }).storageKey)) {
    return { storageKey: (raw as { storageKey: string }).storageKey, blur: clampBlur((raw as { blur?: unknown }).blur) };
  }
  return undefined;
}

/** Server-relative URL (/api/files/...) of the blurred JPEG for this picture + blur: reused if it exists, else (re)built. Marks it as used today. */
export async function getBlurredBackgroundPath(storageKey: string, blur: number): Promise<string | null> {
  if (!isEmailBackgroundKey(storageKey)) return null;
  const radius = clampBlur(blur);
  const hash = createHash('sha1').update(`${storageKey}|${radius}`).digest('hex').slice(0, 20);
  const now = Date.now();
  const cached = urlCache.get(hash);
  if (cached && cached.until > now) return cached.path;

  const outKey = blurredFileKey(hash);
  const path = `/api/files/${outKey}`;
  const meta = await readBlurredMeta(hash);
  let exists = false;
  try {
    await readStoredFile(outKey);
    exists = true;
  } catch {
    /* not made yet, or removed by the retention sweep */
  }

  // Up to date: just note today's use (at most one write a day per copy).
  if (exists && meta?.stage !== 'small') {
    if (!meta || now - Date.parse(meta.lastUsedAt) > DAY_MS) {
      await writeBlurredMeta(hash, { stage: 'full', lastUsedAt: new Date(now).toISOString(), sourceKey: storageKey, blur: radius }).catch(() => {});
    }
    urlCache.set(hash, { path, until: now + CACHE_TTL_MS });
    return path;
  }

  // Missing, or only the shrunken copy is left (an old picture used again): rebuild full quality from the original.
  try {
    const jpeg = await renderBlurredJpeg(storageKey, radius);
    await saveBase64File(BLURRED_CATEGORY, hash, 0, 'bg.jpg', `data:image/jpeg;base64,${jpeg.toString('base64')}`);
    await writeBlurredMeta(hash, { stage: 'full', lastUsedAt: new Date(now).toISOString(), sourceKey: storageKey, blur: radius });
    urlCache.set(hash, { path, until: now + CACHE_TTL_MS });
    return path;
  } catch (err) {
    console.error('[email-background] Could not build the blurred background:', err);
    // The original is gone but a shrunken copy remains: better a soft tiny backdrop than none.
    return exists ? path : null;
  }
}

/** The absolute URL of the background an e-mail should use, or null for none. */
export async function resolveEmailBackgroundUrl(
  defaults: { background?: EmailBackgroundSetting } | undefined,
  choice: EmailBackgroundChoice | undefined
): Promise<string | null> {
  if (choice === 'none') return null;
  let key: string | undefined;
  let blur: number | undefined;
  if (choice && typeof choice === 'object') {
    key = choice.storageKey;
    blur = choice.blur;
  } else {
    const d = defaults?.background;
    if (!d?.enabled || !d.storageKey) return null;
    key = d.storageKey;
    blur = d.blur;
  }
  if (!key) return null;
  const path = await getBlurredBackgroundPath(key, blur === undefined ? DEFAULT_EMAIL_BLUR : blur);
  return path ? `${getAppBaseUrl()}${path}` : null;
}

const FALLBACK_COLOR = '#f8fafc';

/**
 * Puts `url` behind the whole e-mail: the content is wrapped in a full-width table whose `background` attribute and
 * inline CSS carry the picture (the widest-supported way), with a solid-colour fallback. Idempotent.
 */
export function applyEmailBackground(html: string, url: string): string {
  if (!html || !url || html.includes('data-leads-bg')) return html;
  const safe = url.replace(/["'()<>\s\\]/g, (c) => encodeURIComponent(c));
  const open =
    `<table role="presentation" data-leads-bg="1" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FALLBACK_COLOR}" background="${safe}" ` +
    `style="width:100%;background-color:${FALLBACK_COLOR};background-image:url('${safe}');background-size:cover;background-position:center;background-repeat:no-repeat;">` +
    `<tr><td align="center" style="padding:24px 12px;">`;
  const close = `</td></tr></table>`;

  if (/<body[^>]*>/i.test(html)) {
    // The master template pads the <body> itself; move that padding inside the picture so the picture reaches the edges.
    const withBody = html.replace(/<body[^>]*>/i, (tag) => `${tag.replace('padding: 24px 12px', 'padding: 0')}${open}`);
    const idx = withBody.toLowerCase().lastIndexOf('</body>');
    return idx === -1 ? `${withBody}${close}` : `${withBody.slice(0, idx)}${close}${withBody.slice(idx)}`;
  }
  return `${open}${html}${close}`;
}
