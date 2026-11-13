import { readCollection, mutateCollection } from './server-db';
import { dispatchEmail, wrapInMasterEmailTemplate } from './email-service';
import { proposalRecipientIds, type ProposalItem } from './proposals';
import type { Member } from './local-data';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Emails every recipient of an APPROVED proposal (groups expanded + individually
 * picked members, minus the author). Sets `emailSent: true` afterwards so it is
 * never sent twice.
 */
export async function dispatchProposalEmails(proposal: ProposalItem): Promise<boolean> {
  if (!proposal || proposal.status !== 'Approved' || proposal.emailSent) return false;
  try {
    const members = await readCollection<Member>('members');
    const ids = proposalRecipientIds(proposal.recipients, members);
    ids.delete(proposal.authorId);
    const recipients = members.filter(m => ids.has(m.id) && m.email && m.status !== 'Terminated');
    if (recipients.length === 0) return false;

    const { getAppBaseUrl } = await import('./app-url');
    const link = `${getAppBaseUrl()}/dashboard/proposals?highlight=${encodeURIComponent(proposal.id)}`;
    const files = proposal.attachments?.length || 0;

    await Promise.all(recipients.map(m => {
      const bodyHtml = `
        <p style="margin-top: 0; color: #0f172a; font-size: 14px;">Hello <strong>${esc(m.name)}</strong>,</p>
        <p style="color: #334155; font-size: 14px; line-height: 1.6;"><strong>${esc(proposal.authorName)}</strong> has shared a proposal with you:</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #0284c7; padding: 14px 18px; border-radius: 8px; margin: 18px 0;">
          <p style="margin: 0; font-weight: 700; font-size: 15px; color: #0f172a;">${esc(proposal.title)}</p>
          ${files ? `<p style="margin: 8px 0 0 0; color: #475569; font-size: 13px;">${files} attachment${files === 1 ? '' : 's'}</p>` : ''}
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${link}" target="_blank" style="display: inline-block; background: #0284c7; color: #ffffff; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 10px; text-decoration: none;">View Proposal &rarr;</a>
        </div>`;
      return dispatchEmail({
        to: m.email,
        subject: `New proposal: ${proposal.title}`,
        bodyText: `${proposal.authorName} has shared a proposal with you: "${proposal.title}". View it here: ${link}`,
        bodyHtml: wrapInMasterEmailTemplate({
          pageTitle: `New proposal: ${proposal.title}`,
          headerTitle: 'New Proposal',
          headerSubtitle: `From ${proposal.authorName}`,
          badgeText: 'PROPOSAL',
          badgeColor: '#0284c7',
          bodyContentHtml: bodyHtml,
        }),
        badgeText: 'PROPOSAL',
        badgeColor: '#0284c7',
        category: 'PROPOSAL',
      });
    }));

    await mutateCollection('proposals', (current) =>
      (current || []).map((p: any) => (p.id === proposal.id ? { ...p, emailSent: true } : p))
    );
    return true;
  } catch (err) {
    console.error('[dispatchProposalEmails] Failed to dispatch proposal emails:', err);
    return false;
  }
}
