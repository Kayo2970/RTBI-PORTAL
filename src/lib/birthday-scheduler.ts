import { readCollection, mutateCollection } from './server-db';
import { dispatchEmail, generateBirthdayEmailTemplate } from './email-service';
import type { Member } from './local-data';

interface BirthdayEmailLogEntry {
  id: string;
  memberId: string;
  date: string; // "YYYY-MM-DD" — the server-local calendar date this was sent for
  sentAt: string;
}

function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// "YYYY-MM-DD" -> "MM-DD". Slicing (rather than re-parsing through `Date`)
// avoids any timezone shifting — dateOfBirth is stored as a plain calendar
// date, not an instant.
function monthDay(dateStr: string): string {
  return dateStr.slice(5, 10);
}

/**
 * Scans every member for a stored date of birth matching today's month+day
 * and sends each one a birthday email — skipping anyone already logged as
 * sent for today. That log is the idempotency guard: it's what makes it
 * safe to call this on every server boot (a PM2 restart near midnight) and
 * from the daily timer without ever double-sending the same member.
 */
export async function runBirthdayCheck(): Promise<{ checked: number; sent: number }> {
  const today = todayDateString();
  const todayMonthDay = monthDay(today);

  const members = await readCollection<Member>('members');
  const candidates = members.filter(
    (m) => m.dateOfBirth && monthDay(m.dateOfBirth) === todayMonthDay && m.email && m.status !== 'Terminated'
  );

  if (candidates.length === 0) {
    return { checked: members.length, sent: 0 };
  }

  const log = await readCollection<BirthdayEmailLogEntry>('birthdayEmailLog');
  const alreadySent = new Set(log.filter((e) => e.date === today).map((e) => e.memberId));

  let sentCount = 0;
  for (const member of candidates) {
    if (alreadySent.has(member.id)) continue;

    const { subject, bodyText, bodyHtml } = generateBirthdayEmailTemplate(member.name);
    const result = await dispatchEmail({
      to: member.email,
      subject,
      bodyText,
      bodyHtml,
      category: 'BIRTHDAY',
    });

    if (result.status === 'SENT' || result.status === 'BUFFERED') {
      sentCount++;
      await mutateCollection<BirthdayEmailLogEntry>('birthdayEmailLog', (current) => [
        { id: `bday-${today}-${member.id}`, memberId: member.id, date: today, sentAt: new Date().toISOString() },
        ...(current || []),
      ]);
    }
  }

  return { checked: members.length, sent: sentCount };
}

function msUntilNextMidnight(): number {
  const now = new Date();
  // A few seconds past midnight, so the check reliably lands on the new day.
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 10, 0);
  return next.getTime() - now.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Starts the in-process daily birthday-email scheduler. Registered once from
 * instrumentation.ts at server boot — this app runs continuously under PM2
 * (`next start`, not serverless), so a single long-lived in-process timer is
 * enough on its own; no external VPS crontab entry is needed.
 *
 * Safe to call more than once (e.g. Next.js dev-mode module reloads): a
 * flag on `globalThis` stops a second call from stacking a duplicate timer.
 */
export function startBirthdayScheduler(): void {
  const g = globalThis as unknown as { __birthdaySchedulerStarted?: boolean };
  if (g.__birthdaySchedulerStarted) return;
  g.__birthdaySchedulerStarted = true;

  // Catch up immediately on boot in case the server was down at midnight —
  // the idempotency log makes this always safe to run, even right after a
  // scheduled run already fired today.
  runBirthdayCheck().catch((err) => console.error('[birthday-scheduler] Startup catch-up check failed:', err));

  setTimeout(() => {
    runBirthdayCheck().catch((err) => console.error('[birthday-scheduler] Midnight check failed:', err));
    setInterval(() => {
      runBirthdayCheck().catch((err) => console.error('[birthday-scheduler] Daily check failed:', err));
    }, DAY_MS);
  }, msUntilNextMidnight());
}
