import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { isSuperUser } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { getWalletWalletApiKey } from '@/lib/wallet/walletwallet-config';

/**
 * Super User only: checks the stored WalletWallet key without creating (or billing) a pass.
 * Revoking a serial that doesn't exist is free: a valid key answers 404, an invalid one 401.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!isSuperUser(actor)) {
      return NextResponse.json({ error: 'Only a Super User can test the wallet key.' }, { status: 403 });
    }
    const key = await getWalletWalletApiKey();
    if (!key) return NextResponse.json({ ok: false, message: 'No API key is saved yet.' });
    const res = await fetch('https://api.walletwallet.dev/api/passes/leads-key-check', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401) return NextResponse.json({ ok: false, message: 'WalletWallet rejected this key (401).' });
    if (res.status === 404 || res.ok) return NextResponse.json({ ok: true, message: 'Key accepted by WalletWallet.' });
    return NextResponse.json({ ok: false, message: `Could not verify the key (HTTP ${res.status}).` });
  } catch (err: any) {
    return apiError(err, 'admin-wallet-settings-test', 500);
  }
}
