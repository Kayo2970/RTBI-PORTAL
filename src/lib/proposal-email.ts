import { readCollection, mutateCollection } from './server-db';
import { dispatchEmail, wrapInMasterEmailTemplate } from './email-service';
import { proposalRecipientIds, type ProposalItem } from './proposals';
import type { Member } from './local-data';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Emails every recipient of a delivered proposal (groups expanded + individually
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
        <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Hello <strong>${esc(m.name)}</strong>,</p>
        <p style="color: #422C5C; font-size: 14px; line-height: 1.6;"><strong>${esc(proposal.authorName)}</strong> has shared a proposal with you:</p>
        <div style="background: #FEF7F6; border: 1px solid #E9E2F0; border-left: 4px solid #CC3D19; padding: 14px 18px; border-radius: 8px; margin: 18px 0;">
          <p style="margin: 0; font-weight: 700; font-size: 15px; color: #1C0F2A;">${esc(proposal.title)}</p>
          ${files ? `<p style="margin: 8px 0 0 0; color: #574769; font-size: 13px;">${files} attachment${files === 1 ? '' : 's'}</p>` : ''}
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${link}" target="_blank" style="display: inline-block; background: #CC3D19; color: #ffffff; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 10px; text-decoration: none;">View Proposal &rarr;</a>
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
          badgeColor: '#CC3D19',
          bodyContentHtml: bodyHtml,
        }),
        badgeText: 'PROPOSAL',
        badgeColor: '#CC3D19',
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

/** Emails the proposal's author when one of its recipients replies (Under Review / Accepted / Declined). */
export async function dispatchProposalReplyEmail(
  proposal: ProposalItem,
  reply: { name: string; status: 'Under Review' | 'Accepted' | 'Declined'; comment?: string }
): Promise<boolean> {
  try {
    let to = proposal.authorEmail;
    if (!to) {
      const members = await readCollection<Member>('members');
      to = members.find(m => m.id === proposal.authorId && m.status !== 'Terminated')?.email;
    }
    if (!to) return false;

    const { getAppBaseUrl } = await import('./app-url');
    const link = `${getAppBaseUrl()}/dashboard/proposals?highlight=${encodeURIComponent(proposal.id)}`;
    const verb = reply.status === 'Accepted' ? 'accepted' : reply.status === 'Declined' ? 'declined' : 'started reviewing';
    const colour = reply.status === 'Accepted' ? '#15803D' : reply.status === 'Declined' ? '#BE123C' : '#B45309';
    const bodyHtml = `
      <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Hello <strong>${esc(proposal.authorName)}</strong>,</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;"><strong>${esc(reply.name)}</strong> has <strong>${verb}</strong> your proposal:</p>
      <div style="background: #FEF7F6; border: 1px solid #E9E2F0; border-left: 4px solid ${colour}; padding: 14px 18px; border-radius: 8px; margin: 18px 0;">
        <p style="margin: 0; font-weight: 700; font-size: 15px; color: #1C0F2A;">${esc(proposal.title)}</p>
        <p style="margin: 8px 0 0 0; color: ${colour}; font-size: 13px; font-weight: 700;">${esc(reply.status)}</p>
        ${reply.comment ? `<p style="margin: 8px 0 0 0; color: #574769; font-size: 13px;">&ldquo;${esc(reply.comment)}&rdquo;</p>` : ''}
      </div>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${link}" target="_blank" style="display: inline-block; background: #CC3D19; color: #ffffff; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 10px; text-decoration: none;">View the reply &rarr;</a>
      </div>`;
    await dispatchEmail({
      to,
      subject: `${reply.name} ${verb} your proposal: ${proposal.title}`,
      bodyText: `${reply.name} has ${verb} your proposal "${proposal.title}"${reply.comment ? ` — "${reply.comment}"` : ''}. View it here: ${link}`,
      bodyHtml: wrapInMasterEmailTemplate({
        pageTitle: `Reply to your proposal: ${proposal.title}`,
        headerTitle: 'Proposal Reply',
        headerSubtitle: `${reply.name} · ${reply.status}`,
        badgeText: reply.status.toUpperCase(),
        badgeColor: colour,
        bodyContentHtml: bodyHtml,
      }),
      badgeText: reply.status.toUpperCase(),
      badgeColor: colour,
      category: 'PROPOSAL',
    });
    return true;
  } catch (err) {
    console.error('[dispatchProposalReplyEmail] Failed to email the proposal author:', err);
    return false;
  }
}
