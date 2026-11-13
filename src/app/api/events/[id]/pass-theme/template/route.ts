import { NextResponse } from 'next/server';
import { createCanvas } from '@napi-rs/canvas';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { EMAIL_CARD_W, EMAIL_CARD_H } from '@/lib/pass-theme';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Designer template for the emailed ticket: the exact 1160×420 card with the safe zones marked.
 * Layout (card-relative): main area 0–870, perforation at x=870, white stub 870–1160 with the QR drawn at
 * 220×220 (x 905, y 50). Text is drawn over the main area starting at x=50.
 */
export async function GET(request: Request) {
  try {
    await requireSession(request);
    const W = EMAIL_CARD_W, H = EMAIL_CARD_H;
    const c = createCanvas(W, H);
    const x = c.getContext('2d');
    const font = 'DejaVu Sans, Arial, sans-serif';

    x.fillStyle = '#1e293b';
    x.fillRect(0, 0, W, H);
    x.fillStyle = '#ffffff';
    x.fillRect(870, 0, 290, H); // stub (covered by the white tear-off in the final ticket)

    const zone = (zx: number, zy: number, zw: number, zh: number, color: string, label: string) => {
      x.fillStyle = color + '33';
      x.fillRect(zx, zy, zw, zh);
      x.strokeStyle = color;
      x.lineWidth = 2;
      x.setLineDash([10, 6]);
      x.strokeRect(zx, zy, zw, zh);
      x.setLineDash([]);
      x.fillStyle = color;
      x.font = `bold 15px ${font}`;
      x.fillText(label, zx + 10, zy + 22);
    };
    zone(50, 28, 790, 56, '#38bdf8', 'Brand / logo zone (top-left)');
    zone(50, 96, 790, 70, '#f59e0b', 'EVENT NAME text (auto-fits)');
    zone(50, 176, 790, 96, '#a78bfa', 'GUEST CATEGORY + ATTENDEE NAME');
    zone(50, 290, 790, 90, '#34d399', 'PASS TYPE · VENUE · VALID DAYS');
    zone(905, 50, 220, 220, '#ef4444', 'QR code 220×220');
    x.fillStyle = '#0f172a';
    x.font = `13px ${font}`;
    x.fillText('SCAN AT ENTRY + serial (auto)', 888, 310);

    // perforation + notches
    x.strokeStyle = '#475569';
    x.setLineDash([8, 8]);
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(870, 24);
    x.lineTo(870, H - 24);
    x.stroke();
    x.setLineDash([]);

    x.fillStyle = '#94a3b8';
    x.font = `13px ${font}`;
    x.fillText(`Design at ${W}×${H} px (PNG/JPG). Keep important art outside the coloured zones, or accept the darkening overlay.`, 50, H - 14);

    return new NextResponse(new Uint8Array(c.toBuffer('image/png')), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="rtbi-email-ticket-template-${W}x${H}.png"`,
      },
    });
  } catch (err: any) {
    return apiError(err, 'pass-theme-template', 500);
  }
}
