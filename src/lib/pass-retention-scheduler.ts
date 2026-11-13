/**
 * Daily housekeeping: 30 days after an event ends, delete the cached wallet files and theme images of its
 * passes (the pass URLs already show the thank-you page by date — see lib/pass-retention.ts). Wallet passes
 * already installed on guests' phones are NOT revoked; they expire on their own via `expirationDays`.
 */
import { readCollection, mutateCollection } from '@/lib/server-db';
import { deleteStoredFilesForRecord } from '@/lib/file-storage';
import { isPassArchived } from '@/lib/pass-retention';
import type { EventItem, EventPassItem } from '@/lib/local-data';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runPassRetention(now: Date = new Date()): Promise<{ passesArchived: number; themesRemoved: number }> {
  const [passes, events] = await Promise.all([
    readCollection<EventPassItem>('event_passes'),
    readCollection<EventItem>('events'),
  ]);
  const eventById = new Map(events.map((e) => [e.id, e]));
  const due = passes.filter((p) => !p.archivedAt && isPassArchived(p, eventById.get(p.eventId), now));
  if (due.length === 0) return { passesArchived: 0, themesRemoved: 0 };

  for (const pass of due) await deleteStoredFilesForRecord('event-passes', pass.id);

  const dueIds = new Set(due.map((p) => p.id));
  const stamp = now.toISOString();
  await mutateCollection<EventPassItem>('event_passes', (current = []) =>
    current.map((p) =>
      dueIds.has(p.id) ? ({ ...p, walletAppleUrl: undefined, walletGoogleSaveUrl: undefined, archivedAt: stamp } as EventPassItem) : p
    )
  );

  // Event-level theme assets can go once every pass of the event is archived
  const after = await readCollection<EventPassItem>('event_passes');
  let themesRemoved = 0;
  for (const eventId of new Set(due.map((p) => p.eventId))) {
    const stillActive = after.some((p) => p.eventId === eventId && !p.archivedAt && !isPassArchived(p, eventById.get(eventId), now));
    if (!stillActive && eventId && !/[\\/.]/.test(eventId)) {
      await deleteStoredFilesForRecord('pass-themes', eventId);
      themesRemoved += 1;
    }
  }
  return { passesArchived: due.length, themesRemoved };
}

let timer: NodeJS.Timeout | null = null;

export function startPassRetentionScheduler(): void {
  if (timer) return;
  const tick = () => {
    runPassRetention()
      .then((r) => r.passesArchived && console.log(`[pass-retention] archived ${r.passesArchived} pass(es), removed ${r.themesRemoved} theme folder(s)`))
      .catch((err) => console.error('[pass-retention] run failed:', err));
    // Same 30-day rule for certificates: keep only a small background-free thumbnail for the verify page
    import('@/lib/certificate')
      .then(({ runCertificateRetention }) => runCertificateRetention())
      .then((r) => r.archived && console.log(`[certificate-retention] thumbnailed ${r.archived} certificate(s), removed ${r.artworkRemoved} artwork file(s)`))
      .catch((err) => console.error('[certificate-retention] run failed:', err));
  };
  setTimeout(tick, 60_000); // shortly after boot, then daily
  timer = setInterval(tick, DAY_MS);
  timer.unref?.();
}
