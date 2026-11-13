/**
 * Central "delete it everywhere" helpers. Every ERP delete that owns uploaded files or
 * child records should go through here so nothing is orphaned on disk or in the JSON
 * collections (which is what silently inflates storage over time).
 */
import { mutateCollection, readCollection } from '@/lib/server-db';
import { deleteStoredFile, deleteStoredFilesForRecord } from '@/lib/file-storage';
import { deleteLinkedApprovalRequests } from '@/lib/approval-sync';

/** Remove every uploaded file belonging to one record, across the categories it can use. */
async function purgeFolders(pairs: Array<[category: string, id: string]>): Promise<void> {
  await Promise.all(pairs.map(([category, id]) => deleteStoredFilesForRecord(category, id)));
}

/** Delete a standalone stored file referenced by `storageKey` (no-op when empty). */
export async function purgeStoredKey(storageKey?: string | null): Promise<void> {
  if (storageKey) await deleteStoredFile(storageKey);
}

/** Member deletion: avatar, card photo, link icons, tokens and approval rows. */
export async function purgeMemberArtifacts(memberId: string, email?: string): Promise<void> {
  await purgeFolders([
    ['members', memberId],
    ['card-link-icons', memberId],
  ]);
  await deleteLinkedApprovalRequests('member', memberId);
  const lower = (email || '').trim().toLowerCase();
  const isMine = (r: any) =>
    r.memberId === memberId || (lower && typeof r.email === 'string' && r.email.trim().toLowerCase() === lower);
  await Promise.all([
    mutateCollection('passwordResets', (cur) => (cur || []).filter((r: any) => !isMine(r))),
    mutateCollection('emailChanges', (cur) => (cur || []).filter((r: any) => r.memberId !== memberId)),
    mutateCollection('accountActivations', (cur) => (cur || []).filter((r: any) => r.memberId !== memberId)),
  ]);
}

/**
 * Event deletion: removes everything that only makes sense while the event exists —
 * passes (+pkpass files, wallet revoke), reports (+files), designs (+assets), tasks
 * (+attachments, ratings, approvals), forms (+submissions) and the pass-theme assets.
 * Finance records (reimbursements, budgets, income) are intentionally kept for history.
 */
export async function cascadeDeleteEvent(eventId: string): Promise<{ removed: Record<string, number> }> {
  const removed: Record<string, number> = {};
  const takeByEvent = async (key: any, match: (row: any) => boolean): Promise<any[]> => {
    let taken: any[] = [];
    await mutateCollection(key, (current) => {
      taken = (current || []).filter(match);
      return taken.length ? (current || []).filter((r: any) => !match(r)) : current;
    });
    removed[key] = taken.length;
    return taken;
  };
  const byEvent = (r: any) => r.eventId === eventId;

  const passes = await takeByEvent('event_passes', byEvent);
  for (const pass of passes) await purgeFolders([['event-passes', pass.id]]);

  const reports = await takeByEvent('eventReports', byEvent);
  for (const r of reports) {
    await purgeFolders([['event-reports', r.id]]);
    await deleteLinkedApprovalRequests('event-report', r.id);
  }

  const designs = await takeByEvent('designs', byEvent);
  for (const d of designs) {
    await purgeFolders([['designs', d.id]]);
    await deleteLinkedApprovalRequests('design', d.id);
  }

  const tasks = await takeByEvent('tasks', byEvent);
  const taskIds = new Set(tasks.map((t: any) => t.id));
  for (const t of tasks) {
    await purgeFolders([['tasks', t.id]]);
    // Attachments uploaded before the task existed live under a temporary record id
    for (const att of t.attachments || []) {
      const parts = String(att?.storageKey || '').split('/');
      if (parts[0] === 'tasks' && parts[1] && parts[1] !== t.id) await deleteStoredFilesForRecord('tasks', parts[1]);
    }
    await deleteLinkedApprovalRequests('task', t.id);
  }
  if (taskIds.size > 0) {
    await mutateCollection('ratings', (cur) => (cur || []).filter((r: any) => !taskIds.has(r.taskId)));
  }
  await takeByEvent('ratings', byEvent);

  const forms = await takeByEvent('forms', byEvent);
  if (forms.length > 0) {
    const formIds = new Set(forms.map((f: any) => f.id));
    const slugs = new Set(forms.map((f: any) => f.slug).filter(Boolean));
    await mutateCollection('submissions', (cur) =>
      (cur || []).filter((s: any) => !formIds.has(s.formId) && !slugs.has(s.slug))
    );
    for (const f of forms) await deleteLinkedApprovalRequests('form', f.id);
  }

  await purgeFolders([['pass-themes', eventId]]);
  return { removed };
}

/** Sum of the on-disk size of a record's uploads — handy for logs and the storage report. */
export async function countCollection(key: any): Promise<number> {
  return (await readCollection<any>(key)).length;
}

/** Delete the on-disk files behind attachment arrays (ReceiptFile-shaped: { storageKey }). */
export async function purgeAttachmentFiles(files?: Array<{ storageKey?: string }> | null): Promise<void> {
  for (const f of files || []) await purgeStoredKey(f?.storageKey);
}

/** Delete files that were present in `before` but are no longer referenced in `after`. */
export async function purgeRemovedAttachments(
  before?: Array<{ storageKey?: string }> | null,
  after?: Array<{ storageKey?: string }> | null
): Promise<void> {
  const keep = new Set((after || []).map((f) => f?.storageKey).filter(Boolean));
  await purgeAttachmentFiles((before || []).filter((f) => f?.storageKey && !keep.has(f.storageKey)));
}
