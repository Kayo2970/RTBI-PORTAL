import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl } from '@/lib/app-url';
import { lookupPassBySerial } from '@/lib/pass-lookup';
import { getOrCreateWalletPass } from '@/lib/wallet/pass-cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Makes sure the wallet pass exists (created once, then cached) and says what is available. The pass page and the
 * email buttons call this behind a progress bar, then fetch the finished file / follow the Google link.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  try {
    const found = await lookupPassBySerial(serial);
    if (!found || found.archived) return NextResponse.json({ error: 'This pass is no longer available.' }, { status: 404 });
    if (found.pass.status === 'Cancelled') return NextResponse.json({ error: 'This pass has been cancelled.' }, { status: 410 });
    const wallet = await getOrCreateWalletPass(found.pass.id, getAppBaseUrl(request));
    return NextResponse.json({
      apple: Boolean(wallet.appleUrl),
      googleSaveUrl: /^https:\/\//i.test(wallet.googleSaveUrl) ? wallet.googleSaveUrl : '',
      cached: wallet.cached,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error)?.message || 'Wallet pass could not be created.' }, { status: 502 });
  }
}
