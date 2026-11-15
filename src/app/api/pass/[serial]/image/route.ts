import { getPassPublicUrl } from '@/lib/app-url';
import { NextRequest, NextResponse } from 'next/server';
import { getPassTheme } from '@/lib/pass-theme';
import { renderBoardingPassPng, renderThankYouPng } from '@/lib/pass-image';
import { lookupPassBySerial } from '@/lib/pass-lookup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Public boarding-pass image for a pass (inline in emails / shareable). Like /pass/[serial] itself it
 * is addressed by the unguessable serial. Cancelled passes render a 404 so a revoked pass stops working.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ serial: string }> }) {
  try {
    const { serial } = await params;
    const found = await lookupPassBySerial(serial);
    if (found?.archived) {
      const thanks = await renderThankYouPng(found.pass.eventName);
      return new NextResponse(new Uint8Array(thanks), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
      });
    }
    const pass = found?.pass;
    if (!pass || pass.status === 'Cancelled') {
      return NextResponse.json({ error: 'Pass not found' }, { status: 404 });
    }
    const png = await renderBoardingPassPng(pass, getPassPublicUrl(request, pass.serialNumber), await getPassTheme(pass.eventId));
    return new NextResponse(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300',
        'Content-Disposition': `inline; filename="${pass.serialNumber}.png"`,
      },
    });
  } catch (err) {
    console.error('[pass-image] render failed:', err);
    return NextResponse.json({ error: 'Failed to render pass image' }, { status: 500 });
  }
}
