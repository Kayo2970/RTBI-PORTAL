/**
 * event-participants-export.ts — builds a CSV of an event's details followed by
 * one row per student placed on one of its committees (or leading one).
 * Access is gated by permissions.ts's canExportEventDetails() at the call site.
 */
import { EventItem, Member, formatEventDateRange } from './local-data';
import { toCsvRow, downloadCsv } from './csv';

/** Distinct members taking part in an event, with the committee(s)/role they hold. */
export function getEventParticipants(event: EventItem, members: Member[]) {
  const byId = new Map<string, { member?: Member; name: string; committees: string[]; leads: string[] }>();
  const add = (id: string, fallbackName: string | undefined, committee: string, isLead: boolean) => {
    const entry = byId.get(id) || { member: members.find(m => m.id === id), name: fallbackName || '', committees: [], leads: [] };
    if (!entry.committees.includes(committee)) entry.committees.push(committee);
    if (isLead && !entry.leads.includes(committee)) entry.leads.push(committee);
    byId.set(id, entry);
  };
  for (const c of event.committees || []) {
    if (c.approvalStatus === 'pending_create' || c.approvalStatus === 'rejected') continue;
    if (c.leadMemberId) add(c.leadMemberId, c.leadMemberName, c.name, true);
    for (const id of c.memberIds || []) add(id, undefined, c.name, false);
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
    toCsvRow(['Campus', event.campus || '']),
    toCsvRow(['Location', event.location || '']),
    toCsvRow(['Committees', (event.committees || []).map(c => c.name).join('; ')]),
    toCsvRow(['Total Students', participants.length]),
    '',
    toCsvRow(['STUDENT DETAILS']),
    toCsvRow(['Name', 'Email', 'Phone', 'Division', 'Role', 'Department', 'Program', 'Batch', 'Event Committee(s)', 'Leads Committee(s)']),
    ...participants.map(p =>
      toCsvRow([
        p.member?.name || p.name || '(removed member)',
        p.member?.email,
        p.member?.phone,
        p.member?.division,
        p.member?.role,
        p.member?.department,
        p.member?.program,
        p.member?.batch,
        p.committees.join('; '),
        p.leads.join('; '),
      ])
    ),
  ];
  const slug = event.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase() || 'event';
  // Leading BOM so Excel reads names/accents as UTF-8.
  downloadCsv(`leads_event_${slug}_${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\n'));
}
