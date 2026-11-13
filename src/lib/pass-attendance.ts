/**
 * Derived attendance state for a pass once its event is over. Nothing is stored: a pass whose valid days have
 * all passed without a scan (or a manual "Admit") simply reads as Absent, so it never depends on a scheduler.
 */
import { getPassValidDays, todayIso } from '@/lib/local-data';
import type { EventItem, EventPassItem } from '@/lib/local-data';
import { getPassEndIso } from '@/lib/pass-retention';

export type PassAttendanceState = 'Pending' | 'Checked In' | 'Attended' | 'Partial' | 'Absent' | 'Cancelled';

type EventDates = Pick<EventItem, 'startDate' | 'endDate' | 'datesTBD'> | null | undefined;

/** True once the last day the pass (or its event) is relevant on is before today. */
export function isPassEventDone(pass: EventPassItem, event?: EventDates, today: string = todayIso()): boolean {
  const end = getPassEndIso(pass, event);
  return !!end && end < today;
}

/** Event-level version for grouping: completed once the event's end (or start) date is before today. */
export function isEventDone(event: Pick<EventItem, 'startDate' | 'endDate' | 'datesTBD'>, today: string = todayIso()): boolean {
  if (event.datesTBD) return false;
  const end = event.endDate || event.startDate;
  return !!end && /^\d{4}-\d{2}-\d{2}$/.test(end) && end < today;
}

function hasAttended(pass: EventPassItem): boolean {
  // Older passes were admitted by hand (status only), so that counts as attended too
  return (pass.attendance || []).length > 0 || pass.status === 'Checked In';
}

/** Valid days that are already over with no attendance record for them. */
export function getAbsentDays(pass: EventPassItem, today: string = todayIso()): string[] {
  const attended = new Set((pass.attendance || []).map((a) => (a.date || a.day).toLowerCase()));
  return getPassValidDays(pass).filter((d) => d < today && !attended.has(d.toLowerCase()));
}

export function getPassAttendanceState(pass: EventPassItem, event?: EventDates, today: string = todayIso()): PassAttendanceState {
  if (pass.status === 'Cancelled') return 'Cancelled';
  const done = isPassEventDone(pass, event, today);
  if (!hasAttended(pass)) return done ? 'Absent' : 'Pending';
  if (!done) return 'Checked In';
  const days = getPassValidDays(pass);
  if (days.length > 1 && (pass.attendance || []).length > 0 && getAbsentDays(pass, today).length > 0) return 'Partial';
  return 'Attended';
}
