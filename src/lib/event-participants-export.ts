/**
 * event-participants-export.ts — builds a CSV of an event's details followed by one row per member
 * who has been assigned a task for it. Access is gated by permissions.ts's canExportEventDetails() at the call site.
 */
import { EventItem, Member, TaskItem, formatEventDateRange, getTasks } from './local-data';
import { toCsvRow, downloadCsv } from './csv';

/** Distinct members taking part in an event: everyone assigned a task linked to it, with how many tasks they hold. */
export function getEventParticipants(event: EventItem, members: Member[], tasks: TaskItem[] = getTasks()) {
  const byId = new Map<string, { member?: Member; name: string; taskCount: number }>();
  const add = (id: string, fallbackName: string | undefined) => {
    const entry = byId.get(id) || { member: members.find(m => m.id === id), name: fallbackName || '', taskCount: 0 };
    entry.taskCount += 1;
    byId.set(id, entry);
  };
  for (const t of tasks) {
    if (t.eventId !== event.id) continue;
    if (t.assigneeType === 'group') (t.assigneeIds || []).forEach(id => add(id, undefined));
    else if (t.assigneeId) add(t.assigneeId, t.assignee);
    else {
      const m = members.find(x => x.name.toLowerCase() === (t.assignee || '').toLowerCase());
      if (m) add(m.id, m.name);
    }
  }
  return Array.from(byId.values());
}

export function downloadEventDetailsCsv(event: EventItem, members: Member[]) {
  const participants = getEventParticipants(event, members);
  const lines: string[] = [
    toCsvRow(['EVENT DETAILS']),
    toCsvRow(['Title', event.title]),
    toCsvRow(['Description', event.description]),
    toCsvRow(['Dates', formatEventDateRange(event)]),
    toCsvRow(['Status', event.status]),
    toCsvRow(['Location', event.location || '']),
    toCsvRow(['Total Participants', participants.length]),
    '',
    toCsvRow(['PARTICIPANT DETAILS']),
    toCsvRow(['Name', 'Email', 'Phone', 'Tier', 'Role', 'Department', 'Tasks for this event']),
    ...participants.map(p =>
      toCsvRow([
        p.member?.name || p.name || '(removed member)',
        p.member?.email,
        p.member?.phone,
        p.member?.division,
        p.member?.role,
        p.member?.department,
        p.taskCount,
      ])
    ),
  ];
  const slug = event.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase() || 'event';
  // Leading BOM so Excel reads names/accents as UTF-8.
  downloadCsv(`rtbi_event_${slug}_${new Date().toISOString().slice(0, 10)}.csv`, '\ufeff' + lines.join('\n'));
}
