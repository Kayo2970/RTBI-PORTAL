import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl } from '@/lib/app-url';
import { lookupPassBySerial } from '@/lib/pass-lookup';
import { getOrCreateWalletPass, markWalletInstalled } from '@/lib/wallet/pass-cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Email "Add to Google Wallet" button: redirects to the cached save URL (created once, on first click). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const base = getAppBaseUrl(request);
  const back = (q = '') => NextResponse.redirect(`${base}/pass/${encodeURIComponent(serial)}${q}`, 302);
  try {
    const found = await lookupPassBySerial(serial);
    if (!found || found.pass.status === 'Cancelled' || found.archived) return back();
    const wallet = await getOrCreateWalletPass(found.pass.id, base);
    if (!/^https:\/\//i.test(wallet.googleSaveUrl)) return back('?wallet=unavailable');
    await markWalletInstalled(found.pass.id);
    return NextResponse.redirect(wallet.googleSaveUrl, 302);
  } catch (err) {
    console.warn('[pass-wallet-google]', (err as Error)?.message);
    return back('?wallet=unavailable');
  }
}
