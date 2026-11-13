import { readCollection } from './server-db';
import { dispatchEmail, generateEventRosterEmailTemplate } from './email-service';

/**
 * Emails every member who is on a committee's roster in `next` but wasn't in
 * `previous` (the event record before this save; null/undefined for a brand
 * new event). Only the live `memberIds` roster counts: a staged
 * `pendingMemberIds` change isn't an appointment until it's approved, at
 * which point memberIds changes and this fires. Diffing means re-saving an
 * event never re-emails people who were already on the committee.
 */
export async function dispatchCommitteeRosterEmails(previous: any, next: any): Promise<void> {
  if (!next || !Array.isArray(next.committees) || next.committees.length === 0) return;
  if (next.approvalStatus === 'pending_create' || next.approvalStatus === 'rejected') return;

  const prevCommittees: any[] = Array.isArray(previous?.committees) ? previous.committees : [];
  const members = await readCollection<any>('members');

  for (const committee of next.committees) {
    if (committee.approvalStatus === 'pending_create' || committee.approvalStatus === 'rejected') continue;
    const prevIds = new Set<string>(prevCommittees.find((c: any) => c.id === committee.id)?.memberIds || []);
    const added = (committee.memberIds || []).filter((id: string) => !prevIds.has(id));

    for (const mId of added) {
      const member = members.find((m: any) => m.id === mId);
      if (!member?.email || member.status === 'Terminated') continue;
      try {
        const template = generateEventRosterEmailTemplate(member.name, next.title, committee.name, next.startDate);
        await dispatchEmail({
          to: member.email,
          subject: template.subject,
          bodyText: template.bodyText,
          bodyHtml: template.bodyHtml,
          category: 'EVENT_ROSTER',
        });
      } catch (err) {
        console.error(`[committee-roster-email] Failed to email ${member.email}:`, err);
      }
    }
  }
}
