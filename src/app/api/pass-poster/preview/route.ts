import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { renderWalletPosterJpeg } from '@/lib/wallet-poster';
import { FALLBACK_ORIGIN } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Studio / Edit Pass live preview: renders the poster artwork for an unsaved draft (same renderer as the real wallet pass). */
export async function POST(request: NextRequest) {
  try {
    await requireSession(request);
    const body = await request.json();
    const buf = await renderWalletPosterJpeg(
      {
        eventName: String(body.eventName || 'Event name').slice(0, 200),
        passColor: body.passColor,
        passGradient: body.passGradient,
        textColor: body.textColor,
        labelColor: body.labelColor,
        fontScale: Number(body.fontScale) || 1,
        showEventTitle: typeof body.showEventTitle === 'boolean' ? body.showEventTitle : undefined,
        qr: body.qr && body.qr.options ? { url: String(body.qr.url || `${FALLBACK_ORIGIN}/pass/PREVIEW`), options: body.qr.options, caption: body.qr.caption ? String(body.qr.caption).slice(0, 40) : undefined } : undefined,
      },
      body.theme || {}
    );
    return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    const status = err?.status === 401 || /unauth/i.test(err?.message || '') ? 401 : 500;
    return NextResponse.json({ error: 'Preview failed' }, { status });
  }
}
