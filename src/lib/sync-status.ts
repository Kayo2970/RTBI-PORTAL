'use client';

// A tiny pub-sub so the plain async serverPost/serverPatch/serverDelete
// helpers in local-data.ts (called from dozens of places, none of them React
// components) can broadcast "a background save is happening" to the one
// <SyncStatusPill/> mounted in the dashboard shell — without every call site
// having to manage its own loading/error UI. File uploads that already have
// their own FileDropzone progress bar skip this entirely (see local-data.ts)
// so the same write is never narrated twice.

export type SyncEntry = {
  id: string;
  /** Short noun phrase, e.g. "reimbursement claim" — never includes a verb. */
  label: string;
  verb: 'Saving' | 'Updating' | 'Removing';
  status: 'pending' | 'error';
  message?: string;
  retry?: () => void;
};

let entries: SyncEntry[] = [];
let successFlash: { id: string; label: string } | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(l => l());
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncEntries(): SyncEntry[] {
  return entries;
}

export function getSyncSuccessFlash() {
  return successFlash;
}

let counter = 0;
export function beginSync(label: string, verb: SyncEntry['verb']): string {
  const id = 'sync_' + Date.now() + '_' + (counter++);
  entries = [...entries, { id, label, verb, status: 'pending' }];
  notify();
  return id;
}

export function resolveSyncSuccess(id: string) {
  const entry = entries.find(e => e.id === id);
  entries = entries.filter(e => e.id !== id);
  // Brief "Saved" confirmation flash, then clear itself — honest positive
  // feedback for a write that used to happen in total silence.
  if (entry) {
    successFlash = { id, label: entry.label };
    notify();
    setTimeout(() => {
      if (successFlash?.id === id) {
        successFlash = null;
        notify();
      }
    }, 1800);
  } else {
    notify();
  }
}

export function resolveSyncError(id: string, message: string, retry?: () => void) {
  entries = entries.map(e => e.id === id ? { ...e, status: 'error' as const, message, retry } : e);
  notify();
}

export function dismissSyncEntry(id: string) {
  entries = entries.filter(e => e.id !== id);
  notify();
}

/** Wraps a background write with pending/success/error tracking. `run` may be
 * invoked again (by the pill's Retry tap) — each retry re-runs the exact same
 * fetch, not a cosmetic "try again" that just clears the error. */
export function trackSync<T>(label: string, verb: SyncEntry['verb'], run: () => Promise<T>, isSuccess: (result: T) => boolean): Promise<T> {
  const id = beginSync(label, verb);
  const failMessage = `Failed to ${verb === 'Removing' ? 'remove' : 'save'} ${label}.`;
  const attempt = (): Promise<T> =>
    run()
      .then(result => {
        if (isSuccess(result)) {
          resolveSyncSuccess(id);
        } else {
          resolveSyncError(id, failMessage, () => { attempt(); });
        }
        return result;
      })
      .catch(err => {
        resolveSyncError(id, err?.message || failMessage, () => { attempt(); });
        throw err;
      });
  return attempt();
}
