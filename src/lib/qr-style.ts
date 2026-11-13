/**
 * One styled-QR renderer for every surface (portal keycard in the browser, emailed ticket and wallet poster on the
 * server). It only needs a Canvas 2D context, which the browser and @napi-rs/canvas both provide.
 */
import QRCode from 'qrcode';
import type { PassQrShape } from '@/lib/local-data';

export interface QrDrawOptions {
  dark: string;
  light: string;
  /** Colour of the three corner "eyes". Defaults to the dot colour. */
  eye?: string;
  shape: PassQrShape;
  /** Optional centre logo (an Image / canvas image). Needs error-correction H, which we always use. */
  logo?: unknown;
}

export function qrMatrix(text: string): { size: number; get: (x: number, y: number) => boolean } {
  const q = QRCode.create(text, { errorCorrectionLevel: 'H' });
  return { size: q.modules.size, get: (x, y) => Boolean(q.modules.get(x, y)) };
}

const inEye = (x: number, y: number, n: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);

function rr(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws the QR into the square (x, y, size) including a quiet zone filled with the light colour. */
export function drawStyledQr(ctx: any, text: string, x: number, y: number, size: number, o: QrDrawOptions): void {
  const m = qrMatrix(text);
  const quiet = 2;
  const cell = size / (m.size + quiet * 2);
  const ox = x + quiet * cell;
  const oy = y + quiet * cell;

  ctx.fillStyle = o.light;
  ctx.fillRect(x, y, size, size);

  // Data modules
  ctx.fillStyle = o.dark;
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.get(c, r) || inEye(c, r, m.size)) continue;
      const px = ox + c * cell;
      const py = oy + r * cell;
      if (o.shape === 'dots') {
        ctx.beginPath();
        ctx.arc(px + cell / 2, py + cell / 2, cell * 0.43, 0, Math.PI * 2);
        ctx.fill();
      } else if (o.shape === 'rounded') {
        rr(ctx, px + cell * 0.04, py + cell * 0.04, cell * 0.92, cell * 0.92, cell * 0.34);
        ctx.fill();
      } else {
        ctx.fillRect(px - 0.3, py - 0.3, cell + 0.6, cell + 0.6);
      }
    }
  }

  // Finder "eyes": outer ring + inner block, in their own colour
  const eye = o.eye || o.dark;
  for (const [ex, ey] of [[0, 0], [m.size - 7, 0], [0, m.size - 7]]) {
    const px = ox + ex * cell;
    const py = oy + ey * cell;
    ctx.fillStyle = eye;
    if (o.shape === 'dots') {
      ctx.beginPath(); ctx.arc(px + 3.5 * cell, py + 3.5 * cell, 3.5 * cell, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = o.light;
      ctx.beginPath(); ctx.arc(px + 3.5 * cell, py + 3.5 * cell, 2.5 * cell, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = eye;
      ctx.beginPath(); ctx.arc(px + 3.5 * cell, py + 3.5 * cell, 1.5 * cell, 0, Math.PI * 2); ctx.fill();
    } else {
      const rad = o.shape === 'rounded' ? cell * 1.6 : 0;
      const draw = (ix: number, w: number, r: number) => {
        if (r > 0) { rr(ctx, px + ix * cell, py + ix * cell, w * cell, w * cell, r); ctx.fill(); }
        else ctx.fillRect(px + ix * cell, py + ix * cell, w * cell, w * cell);
      };
      draw(0, 7, rad);
      ctx.fillStyle = o.light;
      draw(1, 5, rad * 0.7);
      ctx.fillStyle = eye;
      draw(2, 3, rad * 0.5);
    }
  }

  // Centre logo on a light plate (error correction H tolerates ~25% damage; we cover ~5% of the area)
  if (o.logo) {
    const logoSize = size * 0.2;
    const pad = logoSize * 0.18;
    const box = logoSize + pad * 2;
    const bx = x + (size - box) / 2;
    const by = y + (size - box) / 2;
    ctx.fillStyle = o.light;
    rr(ctx, bx, by, box, box, box * 0.2);
    ctx.fill();
    try {
      ctx.drawImage(o.logo, bx + pad, by + pad, logoSize, logoSize);
    } catch {
      /* logo failed to decode: leave the plate */
    }
  }
}
