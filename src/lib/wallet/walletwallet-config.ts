import { readCollection } from '@/lib/server-db';

/**
 * Digital Visiting Card wallet passes (Apple + Google) are issued through
 * WalletWallet (https://walletwallet.dev) — a hosted API that signs passes
 * with its own Apple/Google credentials, so this deployment never needs its
 * own Apple Developer certificate or Google Cloud service account. See
 * docs/wallet-setup.md for how to get an API key.
 *
 * The key can come from either an env var (server-level, one-time setup) or
 * the `walletSettings` collection (so a Super User can paste it in from
 * Settings without a redeploy) — the env var wins if both are present.
 */
export async function getWalletWalletApiKey(): Promise<string | null> {
  if (process.env.WALLETWALLET_API_KEY) return process.env.WALLETWALLET_API_KEY;

  const rows = await readCollection<any>('walletSettings');
  const stored = rows.find((r) => r.id === 'default');
  return stored?.walletwallet?.apiKey || null;
}

export async function isWalletWalletConfigured(): Promise<boolean> {
  return (await getWalletWalletApiKey()) !== null;
}
