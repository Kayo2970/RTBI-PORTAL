import { readCollection, mutateCollection } from './server-db';

const DAY_MS = 24 * 60 * 60 * 1000;

function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * A committee that was never handed a task has nothing in the Ratings queue,
 * so its members would otherwise go entirely unevaluated. Once an event's
 * last day has passed, this creates one auto "Committee Performance Review"
 * task per approved committee (with members) that has no tasks at all. The
 * task is created already Completed and assigned to the committee, so it
 * lands straight in the Ratings Task Evaluation Queue for the usual
 * reviewers, and their single rating fans out to every committee member via
 * the existing committee-rating flow.
 *
 * Idempotent: a deterministic task id per (event, committee), plus a record
 * of every key ever created in systemSettings.committeeReviewCreatedKeys so
 * a review that a reviewer deleted is never resurrected on the next run.
 */
export async function runCommitteeReviewTasks(): Promise<{ created: number }> {
  const [events, tasks, systemSettingsList] = await Promise.all([
    readCollection<any>('events'),
    readCollection<any>('tasks'),
    readCollection<any>('systemSettings'),
  ]);
  const today = todayDateString();
  const doneKeys = new Set<string>(systemSettingsList?.[0]?.committeeReviewCreatedKeys || []);

  const candidates: { id: string; event: any; committee: any }[] = [];
  for (const e of events) {
    if (e.isHoliday || e.datesTBD) continue;
    if (typeof e.endDate !== 'string' || !e.endDate || e.endDate >= today) continue;
    if (e.approvalStatus === 'pending_create' || e.approvalStatus === 'rejected' || e.approvalStatus === 'pending_delete') continue;
    for (const c of e.committees || []) {
      if (c.approvalStatus === 'pending_create' || c.approvalStatus === 'rejected') continue;
      if (!Array.isArray(c.memberIds) || c.memberIds.length === 0) continue;
      const id = `task_committee_review_${e.id}_${c.id}`;
      if (doneKeys.has(id)) continue;
      const hasTask = tasks.some((t: any) =>
        t.eventId === e.id &&
        (t.eventCommitteeId === c.id ||
          (t.assigneeType === 'committee' && (t.assignee || '').toLowerCase() === (c.name || '').toLowerCase()))
      );
      if (hasTask) continue;
      candidates.push({ id, event: e, committee: c });
    }
  }
  if (candidates.length === 0) return { created: 0 };

  let created = 0;
  await mutateCollection<any>('tasks', (current) => {
    const next = [...current];
    for (const { id, event, committee } of candidates) {
      if (next.some((t: any) => t.id === id)) continue;
      next.unshift({
        id,
        title: `Committee performance review: ${committee.name} (${event.title})`,
        event: event.title,
        eventId: event.id,
        eventCampus: event.campus,
        eventCommitteeId: committee.id,
        eventCommitteeName: committee.name,
        assignee: committee.name,
        assigneeType: 'committee',
        dueDate: event.endDate,
        status: 'Completed',
        creatorName: 'Committee Review Scheduler',
        workflowType: 'committee_performance_review',
        briefDescription: `"${committee.name}" was not assigned any task for "${event.title}". Please rate the committee's overall performance.`,
      });
      created++;
    }
    return next;
  });

  await mutateCollection<any>('systemSettings', (current) => {
    const currentSettings = current[0] || { id: 'default', lockdownEnabled: false };
    const keys = new Set<string>(currentSettings.committeeReviewCreatedKeys || []);
    candidates.forEach(c => keys.add(c.id));
    return [{ ...currentSettings, committeeReviewCreatedKeys: Array.from(keys) }];
  });

  return { created };
}

function msUntilNextMidnight(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 30, 0);
  return next.getTime() - now.getTime();
}

/** Starts the daily committee-review check; registered once from instrumentation.ts (same pattern as event-social-scheduler.ts). */
export function startCommitteeReviewScheduler(): void {
  const g = globalThis as unknown as { __committeeReviewSchedulerStarted?: boolean };
  if (g.__committeeReviewSchedulerStarted) return;
  g.__committeeReviewSchedulerStarted = true;

  const run = (label: string) =>
    runCommitteeReviewTasks().catch((err) => console.error(`[committee-review-scheduler] ${label} check failed:`, err));

  run('Startup catch-up');
  setTimeout(() => {
    run('Midnight');
    setInterval(() => run('Daily'), DAY_MS);
  }, msUntilNextMidnight());
}
