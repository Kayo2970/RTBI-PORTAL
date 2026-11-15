import { readCollection, mutateCollection } from './../server-db';
import { dispatchEmail } from './../email-service';
import { computeAlerts } from './alerts-server';

/**
 * Daily digest of overdue / due-soon incubation items to CEO and Super User accounts (tier 1-2).
 * Idempotent per day via a log row kept in `incubationSettings` (id 'digest') — safe to run on every boot and midnight tick.
 */
export async function runIncubationDigest(): Promise<{ sent: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await readCollection<any>('incubationSettings');
  if (rows.find(r => r.id === 'digest')?.lastDate === today) return { sent: 0 };

  const members = (await readCollection<any>('members')).filter(m => m.status !== 'Terminated' && typeof m.tier === 'number' && m.tier <= 2 && m.email);
  if (!members.length) return { sent: 0 };
  const alerts = (await computeAlerts({ id: 'scheduler', tier: 1 })).filter(a => a.severity !== 'info');
  let sent = 0;
  if (alerts.length) {
    const lines = alerts.map(a => `- [${a.severity === 'overdue' ? 'OVERDUE' : 'DUE SOON'}] ${a.title} — ${a.detail}`);
    for (const m of members) {
      try {
        await dispatchEmail({ to: m.email, category: 'SYSTEM', subject: `RTBI incubation: ${alerts.length} item${alerts.length === 1 ? '' : 's'} need attention`, bodyText: `Hello ${m.name},\n\n${lines.join('\n')}\n\nOpen the portal's Incubation section for details.\n` });
        sent++;
      } catch (e) { console.error('[incubation-scheduler] email failed', e); }
    }
  }
  await mutateCollection<any>('incubationSettings', cur => [...cur.filter(r => r.id !== 'digest'), { id: 'digest', lastDate: today }]);
  return { sent };
}

const DAY_MS = 24 * 60 * 60 * 1000;
function msUntilNextMidnight(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 1, 0, 0).getTime() - n.getTime();
}

export function startIncubationScheduler(): void {
  const g = globalThis as unknown as { __incubationSchedulerStarted?: boolean };
  if (g.__incubationSchedulerStarted) return;
  g.__incubationSchedulerStarted = true;
  runIncubationDigest().catch(e => console.error('[incubation-scheduler] startup run failed', e));
  setTimeout(() => {
    runIncubationDigest().catch(e => console.error('[incubation-scheduler] midnight run failed', e));
    setInterval(() => runIncubationDigest().catch(e => console.error('[incubation-scheduler] daily run failed', e)), DAY_MS);
  }, msUntilNextMidnight());
}
