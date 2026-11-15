import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl } from '@/lib/app-url';
import { getOrCreateWalletPass, WalletUnavailableError } from '@/lib/wallet/pass-cache';
import { lookupPassBySerial } from '@/lib/pass-lookup';
import { readCollection } from '@/lib/server-db';
import type { EventPassItem } from '@/lib/local-data';

export const dynamic = 'force-dynamic';

/** Pass-page "Add to Apple/Google Wallet" buttons. Same single-creation cache as the email buttons. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; passId: string }> }
) {
  try {
    const { passId } = await params;
    const pass = (await readCollection<EventPassItem>('event_passes')).find((p) => p.id === passId || p.serialNumber === passId);
    if (!pass) return NextResponse.json({ error: 'Pass not found' }, { status: 404 });
    const found = await lookupPassBySerial(pass.serialNumber);
    if (found?.archived) return NextResponse.json({ error: 'This pass has expired.' }, { status: 410 });
    const wallet = await getOrCreateWalletPass(pass.id, getAppBaseUrl(request));
    return NextResponse.json({ appleUrl: wallet.appleUrl, googleSaveUrl: wallet.googleSaveUrl, cached: wallet.cached });
  } catch (error: any) {
    const status = error instanceof WalletUnavailableError ? 503 : 500;
    return NextResponse.json({ error: error?.message || 'Failed to generate wallet pass.' }, { status });
  }
}
