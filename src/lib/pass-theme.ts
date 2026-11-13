/**
 * Server-side storage for an event's pass theme (background artwork, logo, colours).
 * Everything lives in data/uploads/pass-themes/<eventId>/ so deleting the event removes it.
 */
import { createHash } from 'crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { saveBase64File, readStoredFile, deleteStoredFile } from '@/lib/file-storage';
import { PassTheme, qrOptionsFromPass } from '@/lib/local-data';

const CATEGORY = 'pass-themes';
const THEME_FILE_INDEX = 9;
const HEX = /^#[0-9a-fA-F]{6}$/;

export async function getPassTheme(eventId: string): Promise<PassTheme> {
  if (!eventId || eventId === 'all') return {};
  try {
    const buf = await readStoredFile(`${CATEGORY}/${eventId}/${THEME_FILE_INDEX}__theme.json`);
    return JSON.parse(buf.toString('utf8')) as PassTheme;
  } catch {
    return {};
  }
}

async function writeTheme(eventId: string, theme: PassTheme): Promise<void> {
  const payload = Buffer.from(JSON.stringify({ ...theme, updatedAt: new Date().toISOString() })).toString('base64');
  await saveBase64File(CATEGORY, eventId, THEME_FILE_INDEX, 'theme.json', `data:application/json;base64,${payload}`);
}

/** Cover-resize an uploaded image to a JPEG data URL of at most `maxBytes` (WalletWallet limit: 1MB). */
export async function toJpegDataUrl(dataUrl: string, maxSide: number, maxBytes = 900_000): Promise<string> {
  const base64 = dataUrl.split(',')[1] || '';
  const img = await loadImage(Buffer.from(base64, 'base64'));
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  for (const quality of [88, 78, 68, 55, 42]) {
    const buf = canvas.toBuffer('image/jpeg', quality);
    if (buf.length <= maxBytes || quality === 42) return `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
  return dataUrl;
}

export const EMAIL_CARD_W = 1160;
export const EMAIL_CARD_H = 420;

/** Cover-crop to an exact W×H JPEG (≤ ~900 KB). */
async function toCoverJpegDataUrl(dataUrl: string, W: number, H: number): Promise<string> {
  const img = await loadImage(Buffer.from(dataUrl.split(',')[1] || '', 'base64'));
  const scale = Math.max(W / img.width, H / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  for (const quality of [90, 80, 70, 58, 45]) {
    const buf = canvas.toBuffer('image/jpeg', quality);
    if (buf.length <= 900_000 || quality === 45) return `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
  return dataUrl;
}

/** Portrait 690×1010 cover crop (Apple poster / WalletWallet backgroundURL spec), JPEG ≤ ~900 KB. */
async function toWalletPortraitJpeg(dataUrl: string): Promise<string> {
  const base64 = dataUrl.split(',')[1] || '';
  const img = await loadImage(Buffer.from(base64, 'base64'));
  const W = 690, H = 1010;
  const scale = Math.max(W / img.width, H / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  for (const quality of [88, 78, 68, 55, 42]) {
    const buf = canvas.toBuffer('image/jpeg', quality);
    if (buf.length <= 900_000 || quality === 42) return `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
  return dataUrl;
}

async function toPngDataUrl(dataUrl: string, maxSide: number): Promise<string> {
  const base64 = dataUrl.split(',')[1] || '';
  const img = await loadImage(Buffer.from(base64, 'base64'));
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;
}

export interface PassThemeUpdate {
  emailUseBackground?: boolean;
  emailOverlay?: number;
  /** Email-specific colours; `null` clears them so the ticket follows the general colours again. */
  emailBackgroundColor?: string | null;
  emailForegroundColor?: string | null;
  emailLabelColor?: string | null;
  /** New email-ticket artwork (data URL), or null to remove it. */
  emailArtwork?: { dataUrl: string } | null;
  backgroundColor?: string;
  foregroundColor?: string;
  labelColor?: string;
  overlay?: number;
  /** Event default for the wallet poster title; `null` clears it back to Auto. */
  showEventTitle?: boolean | null;
  /** Event default for the portal card's event title; `null` clears it back to Show. */
  showPortalTitle?: boolean | null;
  /** New artwork (data URL), or null to remove the current one. */
  background?: { dataUrl: string } | null;
  logo?: { dataUrl: string } | null;
}

export async function updatePassTheme(eventId: string, update: PassThemeUpdate): Promise<PassTheme> {
  const theme = await getPassTheme(eventId);

  for (const k of ['backgroundColor', 'foregroundColor', 'labelColor'] as const) {
    const v = update[k];
    if (typeof v === 'string' && HEX.test(v)) theme[k] = v;
  }
  if (typeof update.overlay === 'number' && Number.isFinite(update.overlay)) {
    theme.overlay = Math.min(0.9, Math.max(0, update.overlay));
  }
  if (update.showEventTitle === null) delete theme.showEventTitle;
  else if (typeof update.showEventTitle === 'boolean') theme.showEventTitle = update.showEventTitle;
  if (update.showPortalTitle === null) delete theme.showPortalTitle;
  else if (typeof update.showPortalTitle === 'boolean') theme.showPortalTitle = update.showPortalTitle;
  for (const k of ['emailBackgroundColor', 'emailForegroundColor', 'emailLabelColor'] as const) {
    const v = update[k];
    if (v === null) delete theme[k];
    else if (typeof v === 'string' && HEX.test(v)) theme[k] = v;
  }
  if (typeof update.emailOverlay === 'number' && Number.isFinite(update.emailOverlay)) {
    theme.emailOverlay = Math.min(0.9, Math.max(0, update.emailOverlay));
  }
  if (typeof update.emailUseBackground === 'boolean') theme.emailUseBackground = update.emailUseBackground;

  if (update.emailArtwork === null && theme.emailArtworkKey) {
    await deleteStoredFile(theme.emailArtworkKey);
    delete theme.emailArtworkKey;
    delete theme.emailArtworkUrl;
  } else if (update.emailArtwork) {
    // Exactly the ticket card size (1160x420) so a designer's file maps 1:1
    const img = await toCoverJpegDataUrl(update.emailArtwork.dataUrl, EMAIL_CARD_W, EMAIL_CARD_H);
    if (theme.emailArtworkKey) await deleteStoredFile(theme.emailArtworkKey);
    const stored = await saveBase64File(CATEGORY, eventId, 3, `email-${Date.now()}.jpg`, img);
    theme.emailArtworkKey = stored.storageKey;
    theme.emailArtworkUrl = stored.url;
  }

  if (update.background === null && theme.backgroundKey) {
    await deleteStoredFile(theme.backgroundKey);
    delete theme.backgroundKey;
    delete theme.backgroundUrl;
    if (theme.walletBackgroundKey) await deleteStoredFile(theme.walletBackgroundKey);
    delete theme.walletBackgroundKey;
    delete theme.walletBackgroundUrl;
  } else if (update.background) {
    // Two renditions of one upload: landscape (portal + emailed boarding pass) and portrait (Wallet poster).
    // The filename carries a timestamp so every re-upload gets a NEW public URL — WalletWallet caches by URL.
    const stamp = Date.now();
    const landscape = await toJpegDataUrl(update.background.dataUrl, 1600);
    const portrait = await toWalletPortraitJpeg(update.background.dataUrl);
    if (theme.backgroundKey) await deleteStoredFile(theme.backgroundKey);
    if (theme.walletBackgroundKey) await deleteStoredFile(theme.walletBackgroundKey);
    const stored = await saveBase64File(CATEGORY, eventId, 0, `background-${stamp}.jpg`, landscape);
    const wallet = await saveBase64File(CATEGORY, eventId, 2, `wallet-${stamp}.jpg`, portrait);
    theme.backgroundKey = stored.storageKey;
    theme.backgroundUrl = stored.url;
    theme.walletBackgroundKey = wallet.storageKey;
    theme.walletBackgroundUrl = wallet.url;
  }

  if (update.logo === null && theme.logoKey) {
    await deleteStoredFile(theme.logoKey);
    delete theme.logoKey;
    delete theme.logoUrl;
  } else if (update.logo) {
    const png = await toPngDataUrl(update.logo.dataUrl, 512);
    if (theme.logoKey) await deleteStoredFile(theme.logoKey);
    const stored = await saveBase64File(CATEGORY, eventId, 1, `logo-${Date.now()}.png`, png);
    theme.logoKey = stored.storageKey;
    theme.logoUrl = stored.url;
  }

  await writeTheme(eventId, theme);
  return theme;
}

import type { EventPassItem } from '@/lib/local-data';
import type { WalletEventPassData } from '@/lib/wallet/walletwallet-client';

/** Everything the Wallet API needs for one pass, including the event's themed artwork + colours. */
export async function walletDataForPass(pass: EventPassItem): Promise<WalletEventPassData> {
  const theme = await getPassTheme(pass.eventId);
  // Version the poster URL by everything that changes how it looks, so WalletWallet re-fetches after a design edit
  const version = createHash('sha1')
    .update(JSON.stringify([pass.eventName, pass.passColor, pass.passGradient, pass.textColor, pass.labelColor, pass.fontScale, pass.showEventTitle, theme.showEventTitle, qrOptionsFromPass(pass), pass.qrDark, pass.qrLight, pass.qrEyeColor, pass.qrShape, pass.qrLogo, pass.qrAltText, theme.updatedAt, theme.walletBackgroundUrl, theme.overlay]))
    .digest('hex')
    .slice(0, 10);
  return {
    posterUrl: `/api/pass/${encodeURIComponent(pass.serialNumber)}/wallet-poster?v=${version}`,
    barcodeFormat: pass.qrFormat,
    barcodeAltText: pass.qrAltText,
    qrInWallet: qrOptionsFromPass(pass).inWallet,
    hideEventTitle: (pass.showEventTitle ?? theme.showEventTitle) === false,
    attendeeOrg: pass.attendeeOrg,
    serialNumber: pass.serialNumber,
    walletSerial: pass.walletSerialNumber,
    eventName: pass.eventName,
    eventDate: pass.eventDate,
    eventVenue: pass.eventVenue,
    attendeeName: pass.attendeeName,
    guestCategory: pass.guestCategory,
    roomOrVenue: pass.roomOrVenue,
    passType: pass.passType,
    validityDate: pass.validityDate,
    validDays: pass.validDays,
    passColor: pass.passColor,
    passGradient: pass.passGradient,
    themeColor: theme.backgroundColor,
    // Public URLs (not data URIs): WalletWallet fetches + re-hosts them once, like the LEADS logo
    themeBackgroundUrl: theme.walletBackgroundUrl,
    themeLogoUrl: theme.logoUrl,
  };
}
