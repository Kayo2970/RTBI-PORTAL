/**
 * Renders the 690×1010 Apple/Google Wallet poster artwork for an event pass: the event's artwork (or the pass's
 * colours/gradient), its overlay, the designed text (event title, eyebrow) in the pass's own colours and font size, an
 * empty band where Apple draws the barcode, and a dark fade that keeps Apple's white field text readable.
 * Layout constants live in lib/wallet-poster-spec.ts (shared with the Studio preview).
 */
import path from 'path';
import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from '@napi-rs/canvas';
import { readStoredFile } from '@/lib/file-storage';
import { DEFAULT_PASS_THEME, PassQrOptions, PassTheme } from '@/lib/local-data';
import { drawStyledQr } from '@/lib/qr-style';
import { POSTER_H, POSTER_W, POSTER_ZONES, gradientStops } from '@/lib/wallet-poster-spec';

export interface PosterRenderInput {
  eventName: string;
  passColor?: string;
  passGradient?: string;
  textColor?: string;
  labelColor?: string;
  fontScale?: number;
  showEventTitle?: boolean;
  /** When set, the styled QR is drawn into the artwork (the wallet then carries no native barcode). */
  qr?: { url: string; options: PassQrOptions; caption?: string };
}

let fontReady = false;
function font(): string {
  if (!fontReady) {
    fontReady = true;
    try {
      GlobalFonts.registerFromPath(
        path.join(process.cwd(), 'node_modules', 'next', 'dist', 'compiled', '@vercel', 'og', 'Geist-Regular.ttf'),
        'PassSans'
      );
    } catch {
      /* system fallback */
    }
  }
  return 'PassSans, DejaVu Sans, Arial, sans-serif';
}

/** Artwork for the theme: a pending data: URL (Studio preview) or a stored pass-themes file. */
async function loadArt(theme: PassTheme): Promise<Buffer | null> {
  const url = theme.walletBackgroundUrl || theme.backgroundUrl;
  if (!url) return null;
  try {
    if (url.startsWith('data:')) return Buffer.from(url.split(',')[1] || '', 'base64');
    const m = /^\/api\/files\/(pass-themes\/[^?]+)/.exec(url);
    if (m) return await readStoredFile(decodeURIComponent(m[1]));
  } catch {
    /* no artwork */
  }
  return null;
}

function wrap(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

export async function renderWalletPosterJpeg(input: PosterRenderInput, theme: PassTheme = {}): Promise<Buffer> {
  const fam = font();
  const W = POSTER_W, H = POSTER_H;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const scale = Math.min(1.4, Math.max(0.7, input.fontScale || 1));

  const stops = gradientStops(input.passGradient);
  const base = stops[0] || input.passColor || theme.backgroundColor || DEFAULT_PASS_THEME.backgroundColor;
  const end = stops[1] || '#030712';
  const fg = input.textColor || theme.foregroundColor || DEFAULT_PASS_THEME.foregroundColor;
  const label = input.labelColor || theme.labelColor || DEFAULT_PASS_THEME.labelColor;
  const overlay = typeof theme.overlay === 'number' ? theme.overlay : DEFAULT_PASS_THEME.overlay;

  // Background: artwork (cover) or the pass's own gradient/solid colour
  const artBuf = await loadArt(theme);
  let hasArt = false;
  if (artBuf) {
    try {
      const art = await loadImage(artBuf);
      const s = Math.max(W / art.width, H / art.height);
      const dw = art.width * s, dh = art.height * s;
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(art, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.fillStyle = `rgba(0,0,0,${overlay})`;
      ctx.fillRect(0, 0, W, H);
      hasArt = true;
    } catch {
      /* fall through to colour */
    }
  }
  if (!hasArt) {
    const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
    g.addColorStop(0, base);
    g.addColorStop(1, input.passGradient ? end : '#030712');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Dark fade behind Apple's field row (always: white field text must stay readable on any artwork)
  const fade = ctx.createLinearGradient(0, H * POSTER_ZONES.fadeStart, 0, H);
  fade.addColorStop(0, 'rgba(3,7,18,0)');
  fade.addColorStop(0.55, 'rgba(3,7,18,0.72)');
  fade.addColorStop(1, 'rgba(3,7,18,0.94)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, H * POSTER_ZONES.fadeStart, W, H * (1 - POSTER_ZONES.fadeStart));

  // Designed text band (event title) — by default only when there is no artwork already carrying the title
  const showTitle = input.showEventTitle ?? !hasArt;
  if (showTitle) {
    const left = 48, maxW = W - 96;
    let y = H * POSTER_ZONES.titleTop + 34;
    ctx.fillStyle = label;
    ctx.font = `${Math.round(19 * scale)}px ${fam}`;
    ctx.fillText('OFFICIAL EVENT PASS', left, y);
    y += Math.round(30 * scale);
    // Everything (title lines + accent rule) must end above the barcode band Apple draws
    const available = H * POSTER_ZONES.titleBottom - y - 34;
    ctx.fillStyle = fg;
    ctx.shadowColor = hasArt ? 'rgba(0,0,0,0.55)' : 'transparent';
    ctx.shadowBlur = 14;
    let size = Math.round(58 * scale);
    let lines: string[] = [];
    while (size >= 28) {
      ctx.font = `bold ${size}px ${fam}`;
      lines = wrap(ctx, input.eventName, maxW, 4);
      const fits = lines.every((l) => ctx.measureText(l).width <= maxW) && lines.length * size * 1.15 <= available;
      if (fits) break;
      size -= 2;
    }
    for (const line of lines) {
      y += size * 1.15;
      ctx.fillText(line, left, y);
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = label;
    ctx.fillRect(left, y + 20, 72, 4);
  }

  // Styled QR instead of Apple's native barcode: white plate in the barcode band, same place Apple would draw it
  if (input.qr) {
    const { url, options, caption } = input.qr;
    // Must end above Apple's field row (fieldsTop): barcodeTop + plate*2 + size + caption <= ~79% of the card
    const size = 250;
    const plate = 18;
    const px = (W - size - plate * 2) / 2;
    const py = H * POSTER_ZONES.barcodeTop;
    const ph = size + plate * 2 + (caption ? 30 : 0);
    ctx.fillStyle = options.light;
    ctx.beginPath();
    ctx.moveTo(px + 22, py);
    ctx.arcTo(px + size + plate * 2, py, px + size + plate * 2, py + ph, 22);
    ctx.arcTo(px + size + plate * 2, py + ph, px, py + ph, 22);
    ctx.arcTo(px, py + ph, px, py, 22);
    ctx.arcTo(px, py, px + size + plate * 2, py, 22);
    ctx.closePath();
    ctx.fill();
    let logo: any;
    if (options.logo) {
      try {
        logo = await loadImage(path.join(process.cwd(), 'public', 'card', 'rtbi-logo-clean.png'));
      } catch {
        /* no logo */
      }
    }
    drawStyledQr(ctx, url, px + plate, py + plate, size, { dark: options.dark, light: options.light, eye: options.eye || undefined, shape: options.shape, logo });
    if (caption) {
      ctx.fillStyle = options.dark;
      ctx.font = `bold 18px ${fam}`;
      ctx.textAlign = 'center';
      ctx.fillText(caption, W / 2, py + plate * 2 + size + 2);
      ctx.textAlign = 'left';
    }
  }

  return canvas.toBuffer('image/jpeg', 86);
}
