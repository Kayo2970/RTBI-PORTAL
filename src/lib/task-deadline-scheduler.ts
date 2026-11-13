import { readCollection, mutateCollection } from './server-db';
import { dispatchEmail, generateTaskDeadlineReminderEmailTemplate } from './email-service';
import { resolveTaskEmailRecipients } from './task-email-queue';
import type { TaskItem, Member, EventItem } from './local-data';

function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysDateString(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Emails every task assignee (individual/committee/group — see
 * resolveTaskEmailRecipients) whose task's dueDate is exactly tomorrow and
 * isn't already Completed. `deadlineReminderSentAt` on the task itself is the
 * idempotency guard — set the first time a reminder goes out, it's what
 * makes it safe to re-run this on every server boot and daily timer tick
 * without ever double-emailing the same deadline.
 */
export async function runTaskDeadlineReminderCheck(): Promise<{ checked: number; sent: number }> {
  const tomorrow = addDaysDateString(todayDateString(), 1);

  const tasks = await readCollection<TaskItem>('tasks');
  const candidates = tasks.filter(
    (t) => t.dueDate === tomorrow && t.status !== 'Completed' && !t.deadlineReminderSentAt
  );

  if (candidates.length === 0) {
    return { checked: tasks.length, sent: 0 };
  }

  const [members, events] = await Promise.all([
    readCollection<Member>('members'),
    readCollection<EventItem>('events'),
  ]);

  let sentCount = 0;
  const remindedTaskIds = new Set<string>();

  for (const task of candidates) {
    const recipients = resolveTaskEmailRecipients(task, members, events);
    if (recipients.length === 0) continue;

    let anySent = false;
    for (const recipient of recipients) {
      const { subject, bodyText, bodyHtml } = generateTaskDeadlineReminderEmailTemplate(
        recipient.name,
        task.title,
        task.event || 'LEADS Operations',
        task.dueDate
      );
      const result = await dispatchEmail({
        to: recipient.email,
        subject,
        bodyText,
        bodyHtml,
        category: 'TASK_DEADLINE_REMINDER',
      });
      if (result.status === 'SENT' || result.status === 'BUFFERED') anySent = true;
    }

    if (anySent) {
      sentCount++;
      remindedTaskIds.add(task.id);
    }
  }

  if (remindedTaskIds.size > 0) {
    await mutateCollection<TaskItem>('tasks', (current) =>
      (current || []).map((t) =>
        remindedTaskIds.has(t.id) ? { ...t, deadlineReminderSentAt: new Date().toISOString() } : t
      )
    );
  }

  return { checked: tasks.length, sent: sentCount };
}

function msUntilNextMidnight(): number {
  const now = new Date();
  // A few seconds past midnight, so the check reliably lands on the new day.
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 15, 0);
  return next.getTime() - now.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Starts the in-process daily task-deadline-reminder scheduler, mirroring
 * birthday-scheduler.ts's pattern exactly: an immediate boot catch-up run,
 * then a timer aligned to the next midnight, repeating every 24h after that.
 * Registered once from instrumentation.ts.
 */
export function startTaskDeadlineScheduler(): void {
  const g = globalThis as unknown as { __taskDeadlineSchedulerStarted?: boolean };
  if (g.__taskDeadlineSchedulerStarted) return;
  g.__taskDeadlineSchedulerStarted = true;

  runTaskDeadlineReminderCheck().catch((err) => console.error('[task-deadline-scheduler] Startup catch-up check failed:', err));

  setTimeout(() => {
    runTaskDeadlineReminderCheck().catch((err) => console.error('[task-deadline-scheduler] Midnight check failed:', err));
    setInterval(() => {
      runTaskDeadlineReminderCheck().catch((err) => console.error('[task-deadline-scheduler] Daily check failed:', err));
    }, DAY_MS);
  }, msUntilNextMidnight());
}
