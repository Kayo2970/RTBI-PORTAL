/**
 * One WalletWallet call per pass, ever. Apple (.pkpass) and Google (save URL) both come from the single
 * POST /api/passes response; both are cached on the pass record + disk and served from there afterwards.
 * Concurrent requests share one in-flight creation, and a failed creation backs off for a minute so a
 * burst of clicks can't burn through the monthly quota.
 */
import { mutateCollection, readCollection } from '@/lib/server-db';
import { saveBase64File, deleteStoredFile } from '@/lib/file-storage';
import { getWalletWalletApiKey } from '@/lib/wallet/walletwallet-config';
import { createEventWalletPass, revokeEventWalletPass, updateEventWalletPass } from '@/lib/wallet/walletwallet-client';
import { walletDataForPass } from '@/lib/pass-theme';
import type { EventPassItem } from '@/lib/local-data';

export interface CachedWalletPass {
  appleUrl: string;
  googleSaveUrl: string;
  cached: boolean;
}

const inFlight = new Map<string, Promise<CachedWalletPass>>();
const failedUntil = new Map<string, { until: number; message: string }>();

export class WalletUnavailableError extends Error {}

function fromRecord(pass: EventPassItem): CachedWalletPass | null {
  // Cached as soon as WalletWallet has issued the pass (Google link or stored serial) — not only when both exist
  if (pass.walletGoogleSaveUrl || pass.walletAppleUrl || pass.walletSerialNumber) {
    return { appleUrl: pass.walletAppleUrl || '', googleSaveUrl: pass.walletGoogleSaveUrl || '', cached: true };
  }
  return null;
}

/** POST a fresh wallet pass for `hit`, store its files + ids on the record (clearing the installed flag). */
async function createAndStore(hit: EventPassItem, origin: string, replacing = false): Promise<CachedWalletPass> {
  const apiKey = await getWalletWalletApiKey();
  if (!apiKey) throw new WalletUnavailableError('Wallet passes are temporarily unavailable.');
  const walletPass = await createEventWalletPass(
    apiKey,
    { ...(await walletDataForPass(hit)), walletSerial: undefined },
    `${origin}/pass/${hit.serialNumber}`
  );

  let appleUrl = '';
  if (walletPass.applePass) {
    const stored = await saveBase64File(
      'event-passes',
      hit.id,
      0,
      `${hit.serialNumber}-${Date.now()}.pkpass`,
      `data:application/vnd.apple.pkpass;base64,${walletPass.applePass}`
    );
    appleUrl = stored.url;
  }
  const googleSaveUrl = walletPass.googleSaveUrl || '';
  await mutateCollection<EventPassItem>('event_passes', (current = []) => {
    const idx = current.findIndex((p) => p.id === hit.id);
    if (idx === -1) return current;
    const copy = [...current];
    const { walletInstalledAt: _i, walletLastError: _e, walletStale: _s, ...rest } = copy[idx];
    copy[idx] = {
      ...rest,
      walletAppleUrl: appleUrl,
      walletGoogleSaveUrl: googleSaveUrl,
      walletSerialNumber: walletPass.serialNumber,
      walletSyncedAt: new Date().toISOString(),
    };
    return copy;
  });
  if (replacing) {
    // The new pass is stored: retire the previous one (best effort) and its cached file
    if (hit.walletSerialNumber) {
      await revokeEventWalletPass(apiKey, hit.walletSerialNumber).catch((e) => console.warn('[wallet-reissue] revoke old pass failed:', e?.message));
    }
    const oldFile = hit.walletAppleUrl ? hit.walletAppleUrl.replace(/^\/api\/files\//, '') : '';
    if (oldFile) await deleteStoredFile(oldFile).catch(() => undefined);
  }
  return { appleUrl, googleSaveUrl, cached: false };
}

export async function getOrCreateWalletPass(passRef: string, origin: string): Promise<CachedWalletPass> {
  const hit = (await readCollection<EventPassItem>('event_passes')).find(
    (p) => p.id === passRef || p.serialNumber.toLowerCase() === passRef.toLowerCase()
  );
  if (!hit) throw new WalletUnavailableError('Pass not found');
  if (hit.status === 'Cancelled') throw new WalletUnavailableError('This pass has been cancelled.');

  // Edited after creation and never handed to a guest: rebuild from the current design instead of serving the old file
  const rebuild = Boolean(hit.walletStale && !hit.walletInstalledAt && hit.walletSerialNumber);
  const cached = fromRecord(hit);
  if (cached && !rebuild) return cached;

  const key = hit.id;
  const failed = failedUntil.get(key);
  if (failed && failed.until > Date.now()) throw new WalletUnavailableError(failed.message);

  const running = inFlight.get(key);
  if (running) return running;

  const job = createAndStore(hit, origin, rebuild);

  inFlight.set(key, job);
  try {
    return await job;
  } catch (err: any) {
    const message = err?.message || 'Wallet pass could not be created.';
    failedUntil.set(key, { until: Date.now() + 60_000, message });
    throw err instanceof WalletUnavailableError ? err : new WalletUnavailableError(message);
  } finally {
    inFlight.delete(key);
  }
}

/** Test hook / admin reset: forget back-off state. */
export function resetWalletBackoff(): void {
  failedUntil.clear();
}

/** Remember that a guest has been handed the Apple/Google pass: from then on edits are pushed in place. */
export async function markWalletInstalled(passId: string): Promise<void> {
  await mutateCollection<EventPassItem>('event_passes', (current = []) => {
    const idx = current.findIndex((p) => p.id === passId);
    if (idx === -1 || current[idx].walletInstalledAt) return current;
    const copy = [...current];
    copy[idx] = { ...copy[idx], walletInstalledAt: new Date().toISOString() };
    return copy;
  });
}

async function recordWalletResult(passId: string, error?: string): Promise<void> {
  await mutateCollection<EventPassItem>('event_passes', (current = []) => {
    const idx = current.findIndex((p) => p.id === passId);
    if (idx === -1) return current;
    const copy = [...current];
    const { walletLastError: _e, ...rest } = copy[idx];
    copy[idx] = error ? { ...rest, walletLastError: error.slice(0, 300) } : { ...rest, walletSyncedAt: new Date().toISOString() };
    return copy;
  });
}

/**
 * Builds a brand-new wallet pass from the pass's CURRENT design, then revokes the previous one and deletes its cached
 * file. Whoever already has the old copy on their phone loses it, so this is only automatic for passes nobody has taken.
 */
export async function reissueWalletPass(passRef: string, origin: string): Promise<CachedWalletPass> {
  const hit = (await readCollection<EventPassItem>('event_passes')).find(
    (p) => p.id === passRef || p.serialNumber.toLowerCase() === passRef.toLowerCase()
  );
  if (!hit) throw new WalletUnavailableError('Pass not found');
  if (hit.status === 'Cancelled') throw new WalletUnavailableError('This pass has been cancelled.');

  const running = inFlight.get(hit.id);
  if (running) await running.catch(() => undefined);

  const job = createAndStore(hit, origin, Boolean(hit.walletSerialNumber));
  inFlight.set(hit.id, job);
  try {
    const result = await job;
    failedUntil.delete(hit.id);
    return result;
  } catch (err: any) {
    throw err instanceof WalletUnavailableError ? err : new WalletUnavailableError(err?.message || 'Wallet pass could not be created.');
  } finally {
    inFlight.delete(hit.id);
  }
}

export type WalletSyncAction = 'none' | 'queued' | 'updated';

/**
 * After a pass was edited: keep its wallet copy in step. Never taken by a guest → mark stale so the next Add rebuilds it
 * from the new design (no wasted API calls); already taken → update in place (WalletWallet pushes it to the device).
 */
export async function syncEditedWalletPass(passRef: string, origin: string): Promise<{ action: WalletSyncAction; error?: string }> {
  const pass = (await readCollection<EventPassItem>('event_passes')).find((p) => p.id === passRef || p.serialNumber === passRef);
  if (!pass || !pass.walletSerialNumber) return { action: 'none' };
  const apiKey = await getWalletWalletApiKey();
  if (!apiKey) return { action: 'none' };
  try {
    if (!pass.walletInstalledAt) {
      await mutateCollection<EventPassItem>('event_passes', (current = []) => {
        const idx = current.findIndex((p) => p.id === pass.id);
        if (idx === -1) return current;
        const copy = [...current];
        copy[idx] = { ...copy[idx], walletStale: true };
        return copy;
      });
      return { action: 'queued' };
    }
    await updateEventWalletPass(apiKey, await walletDataForPass(pass), `${origin}/pass/${pass.serialNumber}`);
    await recordWalletResult(pass.id);
    return { action: 'updated' };
  } catch (err: any) {
    const message = err?.message || 'Wallet update failed.';
    await recordWalletResult(pass.id, message);
    return { action: 'none', error: message };
  }
}
