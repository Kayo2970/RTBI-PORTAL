import { readCollection, mutateCollection } from './server-db';
import { dispatchEmail, generateAnnouncementEmailTemplate } from './email-service';
import { resolveAnnouncementRecipients } from './announcement-scope';
import type { Member, EventItem } from './local-data';

/**
 * Dispatches announcement notification emails ONLY if the announcement's status
 * is 'Approved' (e.g. after Centre Head approval). Sets `emailSent: true` on success
 * so emails are never duplicated on subsequent edits.
 */
export async function dispatchAnnouncementEmails(announcement: any): Promise<boolean> {
  if (!announcement || announcement.status !== 'Approved' || announcement.emailSent) {
    return false;
  }

  try {
    const [members, events] = await Promise.all([
      readCollection<Member>('members'),
      readCollection<EventItem>('events'),
    ]);

    const authorName = announcement.authorName || 'LEADS Admin';
    const recipients = resolveAnnouncementRecipients(announcement.scope, members, events)
      .filter((m) => !!m.email);

    if (recipients.length === 0) {
      return false;
    }

    await Promise.all(
      recipients.map((member) => {
        const template = generateAnnouncementEmailTemplate(
          member.name,
          announcement.title,
          announcement.content,
          authorName
        );
        return dispatchEmail({
          to: member.email,
          subject: template.subject,
          bodyText: template.bodyText,
          bodyHtml: template.bodyHtml,
          category: 'ANNOUNCEMENT',
        });
      })
    );

    // Mark emailSent: true in DB so duplicate emails are never sent
    await mutateCollection('announcements', (current) => {
      return (current || []).map((a: any) =>
        a.id === announcement.id ? { ...a, emailSent: true } : a
      );
    });

    return true;
  } catch (emailErr) {
    console.error('[dispatchAnnouncementEmails] Failed to dispatch announcement emails:', emailErr);
    return false;
  }
}
