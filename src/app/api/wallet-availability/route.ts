import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { isWalletWalletConfigured } from '@/lib/wallet/walletwallet-config';
import { apiError } from '@/lib/api-error';

/**
 * Lets any logged-in member check whether wallet passes are currently live
 * on this deployment — used by the Visiting Card live preview so it shows
 * real "Add to Wallet" buttons instead of always rendering "coming soon".
 * Only booleans, never the API key itself — unlike
 * /api/admin/wallet-settings, this doesn't need Super User.
 */
export async function GET(request: Request) {
  try {
    await requireSession(request);

    const walletWalletAvailable = await isWalletWalletConfigured();

    return NextResponse.json({
      appleWalletAvailable: walletWalletAvailable,
      googleWalletAvailable: walletWalletAvailable,
    });
  } catch (err: any) {
    return apiError(err, 'wallet-availability-get');
  }
}
