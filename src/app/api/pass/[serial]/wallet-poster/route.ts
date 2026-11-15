import { NextRequest, NextResponse } from 'next/server';
import { lookupPassBySerial } from '@/lib/pass-lookup';
import { getPassTheme } from '@/lib/pass-theme';
import { renderWalletPosterJpeg } from '@/lib/wallet-poster';
import { qrOptionsFromPass } from '@/lib/local-data';
import { getPassPublicUrl } from '@/lib/app-url';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The wallet poster artwork for one pass. WalletWallet fetches this (public, serial-addressed) when it creates/updates the pass. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const found = await lookupPassBySerial(serial);
  if (!found || found.archived || found.pass.status === 'Cancelled') return new NextResponse('Not found', { status: 404 });
  const { pass } = found;
  const theme = await getPassTheme(pass.eventId);
  const buf = await renderWalletPosterJpeg(
    {
      eventName: pass.eventName,
      passColor: pass.passColor,
      passGradient: pass.passGradient,
      textColor: pass.textColor,
      labelColor: pass.labelColor,
      fontScale: pass.fontScale,
      showEventTitle: pass.showEventTitle ?? theme.showEventTitle,
      qr: qrOptionsFromPass(pass).inWallet
        ? {
            url: getPassPublicUrl(req, pass.serialNumber),
            options: qrOptionsFromPass(pass),
            caption: pass.qrAltText === 'none' ? undefined : pass.qrAltText === 'name' ? pass.attendeeName : pass.serialNumber,
          }
        : undefined,
    },
    theme
  );
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' },
  });
}
