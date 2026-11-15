import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { isSuperUser } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

/**
 * Super-User-only credential store for the Digital Visiting Card's wallet
 * integration — lets a Super User paste in a WalletWallet API key
 * (https://walletwallet.dev) from Settings without a redeploy, same
 * treatment as emailSettings' SMTP password (encrypted at rest via
 * server-db.ts). Never returns the raw key back to the client — only
 * whether one is currently configured, so the form always starts blank.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!isSuperUser(actor)) {
      return NextResponse.json({ error: 'Only a Super User can view wallet configuration.' }, { status: 403 });
    }
    const rows = await readCollection<any>('walletSettings');
    const row = rows.find((r) => r.id === 'default');
    return NextResponse.json({
      walletWalletConfigured: Boolean(row?.walletwallet?.apiKey),
    });
  } catch (err: any) {
    return apiError(err, 'admin-wallet-settings-get');
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!isSuperUser(actor)) {
      return NextResponse.json({ error: 'Only a Super User can change wallet configuration.' }, { status: 403 });
    }
    const body = await request.json();

    await mutateCollection('walletSettings', (current: any[]) => {
      const idx = current.findIndex((r) => r.id === 'default');
      const existing = idx === -1 ? { id: 'default' } : current[idx];
      const next = { ...existing };

      if (body.walletwallet) {
        next.walletwallet = { ...(existing.walletwallet || {}), ...body.walletwallet };
      }

      if (idx === -1) return [...current, next];
      const copy = [...current];
      copy[idx] = next;
      return copy;
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'admin-wallet-settings-patch', 400);
  }
}
