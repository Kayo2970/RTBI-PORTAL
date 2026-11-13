import { canApproveProposal, isCentreHead, type AccessLevelSettings } from './permissions-server';
import { proposalRecipientIds, type ProposalItem } from './proposals';
import type { Member } from './local-data';

/**
 * Applies the Proposals visibility rules for one viewer and attaches the
 * `viewer` flags the page renders from.
 *   - author: always sees their own proposals
 *   - approvers (+ Super User / Centre Head): see every proposal, so they can decide
 *   - recipients: see a proposal only once it is Approved
 * Returns null when the viewer may not see the proposal at all.
 */
export function viewProposalAs(
  proposal: ProposalItem,
  actor: any,
  members: Member[],
  settings: AccessLevelSettings
): ProposalItem | null {
  const isAuthor = proposal.authorId === actor.id;
  const approver = canApproveProposal(actor, settings);
  const isRecipient = proposal.status === 'Approved' && proposal.authorId !== actor.id
    && proposalRecipientIds(proposal.recipients, members).has(actor.id);
  const canDecide = approver && (actor.tier === 1 || !isAuthor);
  if (!isAuthor && !approver && !isRecipient) return null;
  const canDelete = actor.tier === 1 || isCentreHead(actor, settings) || (isAuthor && proposal.status === 'Pending Approval');
  return { ...proposal, viewer: { isAuthor, isRecipient, canDecide, canDelete } };
}

export function viewProposalsAs(items: ProposalItem[], actor: any, members: Member[], settings: AccessLevelSettings): ProposalItem[] {
  const out: ProposalItem[] = [];
  for (const p of items) {
    const v = viewProposalAs(p, actor, members, settings);
    if (v) out.push(v);
  }
  return out;
}
