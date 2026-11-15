/**
 * proposals.ts — shared (server + client safe, no window/localStorage) types
 * and visibility rules for the Proposals module.
 *
 * Flow: any member submits a proposal addressed to groups and/or individual members -> it is delivered
 * to them straight away (visible + emailed, status 'Approved' = delivered) -> each recipient can reply
 * Under Review / Accepted / Declined, and the author is emailed the reply. (Proposals that predate this and
 * are still 'Pending Approval' can be decided by a Super User.)
 *
 * The API (src/app/api/proposals) does all filtering server-side and attaches a
 * `viewer` block to each item, so the page never re-implements these rules.
 */
import type { Member } from './local-data';
import { resolveAnnouncementRecipients } from './announcement-scope';

export type ProposalStatus = 'Pending Approval' | 'Approved' | 'Rejected';
export type ProposalResponseStatus = 'Under Review' | 'Accepted' | 'Declined';

export const PROPOSAL_RECIPIENT_GROUPS = ['CEO', 'Employee', 'Startup', 'Super User', 'All Members'] as const;

export const MAX_PROPOSAL_FILES = 5;
export const MAX_PROPOSAL_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file

export interface ProposalAttachment {
  name: string;
  url: string;
  storageKey: string;
  type?: string;
  /** Only present on the client before upload; never persisted. */
  dataUrl?: string;
}

export interface ProposalResponse {
  memberId: string;
  memberName: string;
  status: ProposalResponseStatus;
  comment?: string;
  at: string;
}

export interface ProposalViewerInfo {
  isAuthor: boolean;
  isRecipient: boolean;
  canDecide: boolean;
  canDelete: boolean;
}

export interface ProposalItem {
  id: string;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  authorEmail?: string;
  createdAt: string;
  recipients: { groups: string[]; memberIds: string[] };
  attachments: ProposalAttachment[];
  status: ProposalStatus;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  responses: ProposalResponse[];
  emailSent?: boolean;
  /** Attached by the API on read; not stored. */
  viewer?: ProposalViewerInfo;
}

/** Ids of every member the proposal is addressed to (groups expanded + explicit picks). */
export function proposalRecipientIds(
  recipients: { groups?: string[]; memberIds?: string[] } | undefined,
  members: Member[]
): Set<string> {
  const ids = new Set<string>(recipients?.memberIds || []);
  for (const group of recipients?.groups || []) {
    resolveAnnouncementRecipients(group, members, []).forEach(m => ids.add(m.id));
  }
  return ids;
}
