import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { getPassTheme, updatePassTheme, walletDataForPass, PassThemeUpdate } from '@/lib/pass-theme';
import { readCollection } from '@/lib/server-db';
import { EventPassItem } from '@/lib/local-data';
import { getWalletWalletApiKey } from '@/lib/wallet/walletwallet-config';
import { getAppBaseUrl } from '@/lib/app-url';
import { syncEditedWalletPass } from '@/lib/wallet/pass-cache';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession(request);
    const { id } = await params;
    return NextResponse.json(await getPassTheme(id));
  } catch (err: any) {
    return apiError(err, 'pass-theme-get', 500);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession(request);
    const { id } = await params;
    if (!id || id === 'all' || /[\\/.]/.test(id)) {
      return NextResponse.json({ error: 'Invalid event id' }, { status: 400 });
    }
    const body = (await request.json()) as PassThemeUpdate;
    for (const f of [body.background, body.logo]) {
      if (f && (typeof f.dataUrl !== 'string' || !f.dataUrl.startsWith('data:image/'))) {
        return NextResponse.json({ error: 'Images must be sent as image data URLs.' }, { status: 400 });
      }
    }
    const theme = await updatePassTheme(id, body);

    // Push the new look to every pass already added to a wallet (best effort, never fails the save)
    let walletUpdated = 0;
    const walletErrors: string[] = [];
    try {
      const origin = getAppBaseUrl(request);
      const passes = (await readCollection<EventPassItem>('event_passes')).filter(
        (p) => p.eventId === id && p.walletSerialNumber && p.status !== 'Cancelled'
      );
      for (const pass of passes.slice(0, 300)) {
        // Installed → updated in place; never installed → rebuilt on the guest's next Add
        const r = await syncEditedWalletPass(pass.id, origin);
        if (r.action !== 'none') walletUpdated += 1;
        if (r.error && walletErrors.length < 3) walletErrors.push(r.error);
      }
    } catch (e: any) {
      console.warn('[pass-theme] wallet sync skipped:', e?.message);
    }
    return NextResponse.json({ ...theme, walletUpdated, walletErrors });
  } catch (err: any) {
    return apiError(err, 'pass-theme-put', 500);
  }
}
