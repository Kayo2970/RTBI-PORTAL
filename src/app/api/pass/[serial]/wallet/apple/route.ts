import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl } from '@/lib/app-url';
import { lookupPassBySerial } from '@/lib/pass-lookup';
import { getOrCreateWalletPass, markWalletInstalled } from '@/lib/wallet/pass-cache';
import { readStoredFile } from '@/lib/file-storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Email "Add to Apple Wallet" button: streams the cached .pkpass (created once, on first click). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const base = getAppBaseUrl(request);
  const back = (q = '') => NextResponse.redirect(`${base}/pass/${encodeURIComponent(serial)}${q}`, 302);
  try {
    const found = await lookupPassBySerial(serial);
    if (!found || found.pass.status === 'Cancelled' || found.archived) return back();
    const wallet = await getOrCreateWalletPass(found.pass.id, base);
    if (!wallet.appleUrl) return back('?wallet=unavailable');
    const buf = await readStoredFile(wallet.appleUrl.replace(/^\/api\/files\//, ''));
    await markWalletInstalled(found.pass.id);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="${found.pass.serialNumber}.pkpass"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    console.warn('[pass-wallet-apple]', (err as Error)?.message);
    return back('?wallet=unavailable');
  }
}
