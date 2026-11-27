import { mutateCollection } from '@/lib/server-db';
import { saveBase64File, deleteStoredFile } from '@/lib/file-storage';
import { ONBOARDING_ITEMS, type OnboardingFile, type OnboardingRecord } from './onboarding';

export const MAX_ONBOARDING_FILE_BYTES = 15 * 1024 * 1024;
export interface IncomingDoc { name?: string; type?: string; dataUrl?: string }

/** Validate + write one uploaded document to disk. Returns null when nothing was uploaded. */
export async function storeOnboardingFile(actorId: string, startupId: string, key: string, doc: IncomingDoc | undefined): Promise<OnboardingFile | null> {
  if (!doc || typeof doc.dataUrl !== 'string' || !doc.dataUrl.startsWith('data:')) return null;
  if (!ONBOARDING_ITEMS.some(i => i.key === key)) throw new Error(`Unknown document "${key}".`);
  const name = String(doc.name || 'file').slice(0, 150);
  if (Math.floor((doc.dataUrl.length * 3) / 4) > MAX_ONBOARDING_FILE_BYTES) throw new Error(`"${name}" exceeds the 15 MB per-file limit.`);
  const stored = await saveBase64File('onboarding', startupId, Date.now(), `${key}_${name}`, doc.dataUrl);
  return { name, url: stored.url, storageKey: stored.storageKey, type: typeof doc.type === 'string' ? doc.type : undefined, size: stored.size, uploadedAt: new Date().toISOString(), uploadedBy: actorId };
}

/**
 * Attach uploaded documents to a startup's onboarding record (creating it if needed).
 * A (re)upload clears the item's verified flag so staff scrutinise the new file.
 * `onlyKeys` restricts which items the caller may upload to.
 */
export async function attachOnboardingDocs(actorId: string, startupId: string, docs: Record<string, IncomingDoc> | undefined, onlyKeys?: string[]): Promise<number> {
  if (!docs || typeof docs !== 'object') return 0;
  const stored: Record<string, OnboardingFile> = {};
  for (const [key, doc] of Object.entries(docs)) {
    if (onlyKeys && !onlyKeys.includes(key)) continue;
    const f = await storeOnboardingFile(actorId, startupId, key, doc);
    if (f) stored[key] = f;
  }
  const keys = Object.keys(stored);
  if (keys.length === 0) return 0;
  const now = new Date().toISOString();
  const id = `onboarding_${startupId}`;
  const replaced: string[] = [];
  await mutateCollection<any>('incubationRecords', cur => {
    const existing = cur.find(r => r.id === id) as (OnboardingRecord & { id: string }) | undefined;
    const items = { ...(existing?.items || {}) };
    for (const k of keys) {
      const prev = items[k];
      if (prev?.file?.storageKey) replaced.push(prev.file.storageKey);
      items[k] = { ...(prev || { done: false }), done: false, doneAt: undefined, doneBy: undefined, file: stored[k] };
    }
    const record = { ...(existing || { id, kind: 'onboarding', createdAt: now, createdBy: actorId, changeLog: [] }), startupId, items, updatedAt: now };
    return existing ? cur.map(r => (r.id === id ? record : r)) : [record, ...cur];
  });
  await Promise.all(replaced.map(deleteStoredFile));
  return keys.length;
}
