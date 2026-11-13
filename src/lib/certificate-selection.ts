/**
 * Recipient-selection rules for the certificate sender (pure, so they can be checked without a browser).
 *
 * A person is "settled" once their certificate is Sent or Queued, and "scheduled" while a pending schedule
 * (Scheduled / Running) already contains them. Neither is ticked by default, and Select all never ticks them,
 * so nobody is e-mailed twice by accident.
 */
export interface SelectionAttendee {
  passId: string;
  status: string;
}
export interface SelectionSchedule {
  status: string;
  sendAt: string;
  passIds: string[];
}

const PENDING_SCHEDULE = new Set(['Scheduled', 'Running']);

/** passId -> the earliest pending send time that already includes them. */
export function scheduledMap(schedules: SelectionSchedule[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of schedules || []) {
    if (!PENDING_SCHEDULE.has(s.status)) continue;
    for (const id of s.passIds || []) {
      const cur = map.get(id);
      if (!cur || s.sendAt < cur) map.set(id, s.sendAt);
    }
  }
  return map;
}

export const isSettled = (a: SelectionAttendee) => a.status === 'Sent' || a.status === 'Queued';

export const isSelectable = (a: SelectionAttendee, scheduled: Map<string, string>) => !isSettled(a) && !scheduled.has(a.passId);

/** Everyone who still needs a certificate and isn't already scheduled. */
export function defaultSelection(attendees: SelectionAttendee[], scheduled: Map<string, string>): Set<string> {
  return new Set(attendees.filter((a) => isSelectable(a, scheduled)).map((a) => a.passId));
}

/** After a reload (e.g. a send): keep what the person ticked, minus anyone who is no longer eligible or no longer exists. */
export function keepSelection(prev: Set<string>, attendees: SelectionAttendee[], scheduled: Map<string, string>): Set<string> {
  const byId = new Map(attendees.map((a) => [a.passId, a]));
  const next = new Set<string>();
  prev.forEach((id) => {
    const a = byId.get(id);
    if (a && !scheduled.has(id) && !isSettled(a)) next.add(id);
  });
  return next;
}

export interface VisibleSelectionState {
  /** Rows in view that can be ticked. */
  selectable: string[];
  /** Ticked rows that are not in view (hidden by a filter or search). */
  hiddenSelected: number;
  /** Every selectable row in view is ticked. */
  allOn: boolean;
}

export function visibleSelectionState(selected: Set<string>, visible: SelectionAttendee[], scheduled: Map<string, string>): VisibleSelectionState {
  const selectable = visible.filter((a) => isSelectable(a, scheduled)).map((a) => a.passId);
  const visibleIds = new Set(visible.map((a) => a.passId));
  let hiddenSelected = 0;
  selected.forEach((id) => { if (!visibleIds.has(id)) hiddenSelected += 1; });
  return { selectable, hiddenSelected, allOn: selectable.length > 0 && selectable.every((id) => selected.has(id)) };
}

/** "Select all" / "Deselect all" for the rows in view only; anything ticked outside the view is left alone. */
export function toggleVisible(selected: Set<string>, visible: SelectionAttendee[], scheduled: Map<string, string>): Set<string> {
  const { selectable, allOn } = visibleSelectionState(selected, visible, scheduled);
  const next = new Set(selected);
  selectable.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
  return next;
}

/** "Select only shown": the ticked set becomes exactly the selectable rows in view; anything ticked outside the view is dropped. */
export function selectOnlyVisible(visible: SelectionAttendee[], scheduled: Map<string, string>): Set<string> {
  return new Set(visible.filter((a) => isSelectable(a, scheduled)).map((a) => a.passId));
}
