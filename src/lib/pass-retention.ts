/**
 * Pass lifetime rules. A pass is "archived" 30 days after its event ends: cached wallet files and theme
 * images are deleted (pass-retention-scheduler.ts) and every pass URL turns into a thank-you page.
 * Archived-ness is computed from dates at request time, so it never depends on the scheduler having run.
 */
import type { EventItem, EventPassItem } from '@/lib/local-data';

export const PASS_RETENTION_DAYS = 30;
const ISO = /\d{4}-\d{2}-\d{2}/g;

/** Latest date (YYYY-MM-DD) the pass/event is relevant: valid days, event end date, or dates found in the label. */
export function getPassEndIso(pass: EventPassItem, event?: Pick<EventItem, 'startDate' | 'endDate' | 'datesTBD'> | null): string | undefined {
  const dates: string[] = [];
  (pass.validDays || []).forEach((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && dates.push(d));
  if (event && !event.datesTBD) {
    [event.endDate, event.startDate].forEach((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d) && dates.push(d));
  }
  // Custom/standalone events keep the range only as text ("2026-10-10 – 2026-10-12")
  [pass.eventDate, pass.validityDate].forEach((t) => (t || '').match(ISO)?.forEach((d) => dates.push(d)));
  return dates.length ? dates.sort()[dates.length - 1] : undefined;
}

export function isPassArchived(
  pass: EventPassItem,
  event?: Pick<EventItem, 'startDate' | 'endDate' | 'datesTBD'> | null,
  now: Date = new Date()
): boolean {
  const end = getPassEndIso(pass, event);
  if (!end) return false;
  const cutoff = new Date(`${end}T23:59:59`);
  cutoff.setDate(cutoff.getDate() + PASS_RETENTION_DAYS);
  return now.getTime() > cutoff.getTime();
}
