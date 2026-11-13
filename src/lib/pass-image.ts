/**
 * Renders a horizontal boarding-pass style PNG for an event pass (QR + details + the event's
 * themed background). Used inline in invitation emails and by /api/pass/[serial]/image.
 */
import path from 'path';
import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from '@napi-rs/canvas';
import { drawStyledQr } from '@/lib/qr-style';
import { readStoredFile } from '@/lib/file-storage';
import {
  EventPassItem,
  PassTheme,
  DEFAULT_PASS_THEME,
  getPassValidDays,
  qrOptionsFromPass,
  formatValidDaysLabel,
} from '@/lib/local-data';

let fontReady = false;
function ensureFont(): string {
  if (!fontReady) {
    fontReady = true;
    try {
      // Next.js ships Geist with its OG renderer — a safe, always-present font on any deploy
      GlobalFonts.registerFromPath(
        path.join(process.cwd(), 'node_modules', 'next', 'dist', 'compiled', '@vercel', 'og', 'Geist-Regular.ttf'),
        'PassSans'
      );
    } catch {
      /* fall back to system fonts */
    }
  }
  return 'PassSans, DejaVu Sans, Arial, sans-serif';
}

const W = 1200;
const H = 460;
const STUB_X = 890;

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: SKRSContext2D, text: string, maxWidth: number, startSize: number, minSize: number, weight = ''): number {
  let size = startSize;
  const fam = ensureFont();
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${fam}`.trim();
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  ctx.font = `${weight} ${size}px ${fam}`.trim();
  return size;
}

function truncate(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Shrinks to fit on one line; if that still overflows, wraps to at most `maxLines` lines (last one ellipsised). Leaves ctx.font set. */
function wrapCell(ctx: SKRSContext2D, text: string, maxWidth: number, startSize: number, minSize: number, maxLines: number): { lines: string[]; size: number } {
  const fam = ensureFont();
  const size = fitText(ctx, text, maxWidth, startSize, minSize, 'bold');
  if (ctx.measureText(text).width <= maxWidth) return { lines: [text], size };
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  const push = () => { if (line) lines.push(line); line = ''; };
  for (const word of words) {
    let w = word;
    // break words that are wider than the column
    while (ctx.measureText(w).width > maxWidth && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && ctx.measureText(w.slice(0, cut)).width > maxWidth) cut--;
      push();
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    const test = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(test).width > maxWidth) { push(); line = w; } else line = test;
  }
  push();
  const out = lines.slice(0, maxLines);
  if (lines.length > maxLines) out[maxLines - 1] = truncate(ctx, `${out[maxLines - 1]} …`, maxWidth);
  ctx.font = `bold ${size}px ${fam}`;
  return { lines: out, size };
}

export async function renderBoardingPassPng(
  pass: EventPassItem,
  passUrl: string,
  theme: PassTheme = {}
): Promise<Buffer> {
  const fam = ensureFont();
  // Ticket look: by default shares the event background; with emailUseBackground === false it has its own design
  const own = theme.emailUseBackground === false;
  const bg = (own && theme.emailBackgroundColor) || theme.backgroundColor || pass.passColor || DEFAULT_PASS_THEME.backgroundColor;
  const fg = pass.textColor || (own && theme.emailForegroundColor) || theme.foregroundColor || DEFAULT_PASS_THEME.foregroundColor;
  const label = pass.labelColor || (own && theme.emailLabelColor) || theme.labelColor || DEFAULT_PASS_THEME.labelColor;
  const overlay = own && typeof theme.emailOverlay === 'number'
    ? theme.emailOverlay
    : typeof theme.overlay === 'number' ? theme.overlay : DEFAULT_PASS_THEME.overlay;
  const artKey = own ? theme.emailArtworkKey : theme.backgroundKey;

  const scale = Math.min(1.3, Math.max(0.8, pass.fontScale || 1));
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Outer margin (opaque so it looks right in dark/light mail clients)
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, W, H);

  const x0 = 20, y0 = 20, w = W - 40, h = H - 40;
  ctx.save();
  roundRect(ctx, x0, y0, w, h, 28);
  ctx.clip();

  // Background: artwork (cover-fit) or solid/gradient colour
  ctx.fillStyle = bg;
  ctx.fillRect(x0, y0, w, h);
  if (artKey) {
    try {
      const art = await loadImage(await readStoredFile(artKey));
      const s = Math.max(w / art.width, h / art.height);
      const dw = art.width * s, dh = art.height * s;
      ctx.drawImage(art, x0 + (w - dw) / 2, y0 + (h - dh) / 2, dw, dh);
    } catch {
      /* keep the colour */
    }
  } else {
    const g = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
    g.addColorStop(0, bg);
    g.addColorStop(1, '#030712');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, w, h);
  }
  ctx.fillStyle = `rgba(0,0,0,${overlay})`;
  ctx.fillRect(x0, y0, w, h);

  // Logo + brand header
  let textX = 70;
  if (theme.logoKey) {
    try {
      const logo = await loadImage(await readStoredFile(theme.logoKey));
      const lh = 56, lw = (logo.width / logo.height) * lh;
      ctx.drawImage(logo, 70, 52, Math.min(lw, 160), lh);
      textX = 70 + Math.min(lw, 160) + 18;
    } catch {
      /* no logo */
    }
  }
  ctx.fillStyle = label;
  ctx.font = `bold 20px ${fam}`;
  ctx.fillText('RTBI  •  RUAS', textX, 78);
  ctx.fillStyle = label;
  ctx.font = `16px ${fam}`;
  ctx.fillText('OFFICIAL EVENT PASS', textX, 102);

  const maxMain = STUB_X - 70 - 30;

  // Event name
  ctx.fillStyle = fg;
  fitText(ctx, pass.eventName, maxMain, Math.round(44 * scale), 26, 'bold');
  ctx.fillText(truncate(ctx, pass.eventName, maxMain), 70, 168);

  // Attendee
  ctx.fillStyle = label;
  ctx.font = `15px ${fam}`;
  ctx.fillText((pass.guestCategory || 'GUEST').toString().toUpperCase(), 70, 218);
  ctx.fillStyle = fg;
  fitText(ctx, pass.attendeeName, maxMain, Math.round(40 * scale), 24, 'bold');
  ctx.fillText(truncate(ctx, pass.attendeeName, maxMain), 70, 262);

  // Field grid
  const validDays = getPassValidDays(pass);
  const validity = validDays.length > 0 ? formatValidDaysLabel(validDays) : pass.validityDate || pass.eventDate || '';
  const cells: Array<[string, string]> = [
    ['PASS TYPE', String(pass.passType)],
    ['VENUE', pass.roomOrVenue || pass.eventVenue || 'Main Auditorium'],
    ['VALID', validity],
  ];
  const colW = maxMain / 3;
  let gridBottom = 362;
  cells.forEach(([k, v], i) => {
    const cx = 70 + i * colW;
    ctx.fillStyle = label;
    ctx.font = `14px ${fam}`;
    ctx.fillText(k, cx, 330);
    ctx.fillStyle = fg;
    // Long values (e.g. a venue) wrap inside their own column instead of running into the next one
    const lines = wrapCell(ctx, v, colW - 16, Math.round(24 * scale), 15, 3);
    lines.lines.forEach((l, li) => ctx.fillText(l, cx, 362 + li * (lines.size + 6)));
    gridBottom = Math.max(gridBottom, 362 + (lines.lines.length - 1) * (lines.size + 6));
  });
  if (validDays.length > 1) {
    ctx.fillStyle = label;
    ctx.font = `15px ${fam}`;
    ctx.fillText(`One pass · one QR · valid on ${validDays.length} days`, 70, Math.max(408, gridBottom + 40));
  }

  // Stub (white) with QR
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  ctx.fillRect(STUB_X, y0, x0 + w - STUB_X, h);
  const qrSize = 220;
  const qrCanvas = createCanvas(600, 600);
  let qrLogo: any;
  if (qrOptionsFromPass(pass).logo) {
    try {
      qrLogo = await loadImage(path.join(process.cwd(), 'public', 'card', 'rtbi-logo-clean.png'));
    } catch {
      /* no logo */
    }
  }
  // Same settings (and defaults) as the portal card and the wallet pass
  const qrOpts = qrOptionsFromPass(pass);
  drawStyledQr(qrCanvas.getContext('2d'), passUrl, 0, 0, 600, {
    dark: qrOpts.dark,
    light: qrOpts.light,
    eye: qrOpts.eye || undefined,
    shape: qrOpts.shape,
    logo: qrLogo,
  });
  const qr = await loadImage(qrCanvas.toBuffer('image/png'));
  const stubW = x0 + w - STUB_X;
  const qx = STUB_X + (stubW - qrSize) / 2;
  ctx.drawImage(qr, qx, 70, qrSize, qrSize);
  ctx.fillStyle = '#0f172a';
  ctx.font = `bold 17px ${fam}`;
  ctx.textAlign = 'center';
  ctx.fillText('SCAN AT ENTRY', STUB_X + stubW / 2, 330);
  ctx.font = `14px ${fam}`;
  ctx.fillStyle = '#475569';
  ctx.fillText(pass.serialNumber, STUB_X + stubW / 2, 358);
  ctx.textAlign = 'left';

  // Perforation + notches
  ctx.strokeStyle = 'rgba(15,23,42,0.35)';
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(STUB_X, y0 + 24);
  ctx.lineTo(STUB_X, y0 + h - 24);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  ctx.fillStyle = '#e2e8f0';
  for (const cy of [y0, y0 + h]) {
    ctx.beginPath();
    ctx.arc(STUB_X, cy, 22, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas.toBuffer('image/png');
}

/** Small thank-you card served in place of the ticket image once a pass is archived. */
export async function renderThankYouPng(eventName: string): Promise<Buffer> {
  const fam = ensureFont();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  roundRect(ctx, 20, 20, W - 40, H - 40, 28);
  ctx.clip();
  const g = ctx.createLinearGradient(20, 20, W - 20, H - 20);
  g.addColorStop(0, DEFAULT_PASS_THEME.backgroundColor);
  g.addColorStop(1, '#030712');
  ctx.fillStyle = g;
  ctx.fillRect(20, 20, W - 40, H - 40);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.fillStyle = DEFAULT_PASS_THEME.labelColor;
  ctx.font = `bold 20px ${fam}`;
  ctx.fillText('RTBI  •  RUAS', W / 2, 120);
  ctx.fillStyle = '#ffffff';
  fitText(ctx, 'Thank you for being part of', W - 200, 44, 26, 'bold');
  ctx.fillText('Thank you for being part of', W / 2, 205);
  fitText(ctx, eventName, W - 200, 52, 26, 'bold');
  ctx.fillText(truncate(ctx, eventName, W - 200), W / 2, 275);
  ctx.fillStyle = DEFAULT_PASS_THEME.labelColor;
  ctx.font = `22px ${fam}`;
  ctx.fillText('Follow us on our socials for more exciting events', W / 2, 345);
  ctx.textAlign = 'left';
  return canvas.toBuffer('image/png');
}
