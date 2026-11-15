// Server-side bridge that feeds the Approvals module (the `approvalRequests`
// collection / src/app/dashboard/approvals) from the module-specific approval
// gates that live on Events, Tasks, Designs, Forms, Announcements, Proposals and
// Event Passes. Each of those keeps its own approval state on its own record —
// this module does not replace that. It fans a tracked ApprovalRequest row out to
// the approvers (the default approvers a Super User selects in the Approvals
// module; CEOs and Super Users when none are selected) whenever one of those
// gates opens, so the request is visible in the Approvals inbox too, and closes
// the sibling rows out again once the underlying record is actually decided —
// whichever approver acts first on either surface resolves it everywhere.
import { readCollection, mutateCollection } from './server-db';
import { dispatchEmail, wrapInMasterEmailTemplate } from './email-service';
import type { ApprovalRequest } from './local-data';

type AutoApprovalEntityType = 'event' | 'task' | 'design' | 'announcement' | 'form' | 'event-pass' | 'proposal';

const ENTITY_LABELS: Record<AutoApprovalEntityType, string> = {
  event: 'Event',
  task: 'Task',
  design: 'Design',
  announcement: 'Announcement',
  form: 'Form',
  'event-pass': 'Event Pass Action',
  proposal: 'Proposal',
};

export interface ApprovalPanelMember {
  id: string;
  name: string;
  email?: string;
  label: string;
}

/** Staff tiers that can act as approvers: Super User (1), CEO (2), Employee (3). Startups never approve. */
const APPROVER_MAX_TIER = 3;

/** The Super-User-selected default approver ids (empty = use the CEO + Super User fallback). */
export async function getDefaultApproverIds(): Promise<string[]> {
  const rows = await readCollection<any>('approvalSettings');
  const ids = rows?.[0]?.approverIds;
  return Array.isArray(ids) ? ids.filter((x: any) => typeof x === 'string') : [];
}

/**
 * Who gets asked when an approval opens automatically. If a Super User has selected default approvers in the
 * Approvals module, exactly those (while they are still active staff); otherwise every CEO and Super User.
 * Any one of them acting is sufficient — see cascadeCloseAutoApprovals below.
 */
export async function resolveApprovalPanel(): Promise<ApprovalPanelMember[]> {
  const members = await readCollection<any>('members');
  const active = members.filter((m: any) => m.status !== 'Terminated' && m.email && typeof m.tier === 'number' && m.tier <= APPROVER_MAX_TIER);
  const chosen = await getDefaultApproverIds();
  const picked = chosen.length ? active.filter((m: any) => chosen.includes(m.id)) : [];
  const source = picked.length ? picked : active.filter((m: any) => m.tier <= 2);
  return source.map((m: any) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    label: picked.length ? 'Approver' : m.tier === 1 ? 'Super User' : 'CEO',
  }));
}

/**
 * Resolves the panel for an entity whose Group Policy approval gate names a
 * specific person or a policy-tag audience rather than the default approvers — e.g. a member
 * configured as the named approver for a given capability. Mirrors the matching logic in
 * permissions.ts's memberMatchesPolicy/resolveApproverName, but reads from
 * the server collections directly since this runs server-side.
 */
export async function resolveCustomApprovalPanel(
  approverType: 'SPECIFIC_MEMBER' | 'POLICY_TAG' | undefined,
  approverMemberId: string | undefined,
  approverPolicyTagId: string | undefined
): Promise<ApprovalPanelMember[]> {
  if (!approverType) return [];
  const members = await readCollection<any>('members');
  const active = members.filter((m: any) => m.status !== 'Terminated');

  if (approverType === 'SPECIFIC_MEMBER') {
    const member = active.find((m: any) => m.id === approverMemberId);
    if (!member || !member.email) return [];
    return [{ id: member.id, name: member.name, email: member.email, label: 'Designated Approver' }];
  }

  if (approverType === 'POLICY_TAG' && approverPolicyTagId) {
    const policies = await readCollection<any>('groupPolicies');
    const tagPolicy = policies.find((p: any) => p.id === approverPolicyTagId);
    if (!tagPolicy) return [];
    const matches = (member: any) => {
      if (tagPolicy.targetMemberIds?.includes(member.id)) return true;
      if (tagPolicy.targetDivisions?.length && tagPolicy.targetDivisions.includes(member.division)) return true;
      if (tagPolicy.targetTiers?.length && tagPolicy.targetTiers.includes(member.tier)) return true;
      if (tagPolicy.targetDesignationKeyword?.trim()) {
        const kw = tagPolicy.targetDesignationKeyword.trim().toLowerCase();
        if ((member.role || '').toLowerCase().includes(kw)) return true;
      }
      return false;
    };
    return active
      .filter((m: any) => m.email && matches(m))
      .map((m: any) => ({ id: m.id, name: m.name, email: m.email, label: 'Designated Approver' }));
  }

  return [];
}

export interface FanOutOptions {
  entityType: AutoApprovalEntityType;
  entityId: string;
  entityTitle: string;
  eventId?: string;
  requesterId: string;
  requesterName: string;
  requesterEmail?: string;
  message?: string;
  customPanel?: ApprovalPanelMember[];
  /** Extra fields stored on every fanned-out row (e.g. the action + payload of an event-pass request). */
  extra?: Record<string, unknown>;
}

/**
 * Creates one ApprovalRequest per panel member, all addressed at the same
 * underlying entity. Idempotent — a second call while a fan-out for this
 * exact entity is already pending is a no-op, so re-saving a still-pending
 * record doesn't spam duplicate rows/emails.
 */
export async function fanOutAutoApproval(opts: FanOutOptions): Promise<ApprovalRequest[]> {
  const panel = opts.customPanel && opts.customPanel.length > 0
    ? opts.customPanel
    : await resolveApprovalPanel();
  if (panel.length === 0) return [];

  const now = new Date().toISOString();
  let createdRows: ApprovalRequest[] = [];

  await mutateCollection('approvalRequests', (current) => {
    const alreadyPending = (current || []).some(
      (r: any) => r.entityType === opts.entityType && r.entityId === opts.entityId && r.status === 'pending' && r.autoGenerated
    );
    if (alreadyPending) return current;

    createdRows = panel.map((p, i) => ({
      id: `appr_${opts.entityType}_${opts.entityId}_${p.id}_${Date.now()}_${i}`,
      entityType: opts.entityType,
      entityId: opts.entityId,
      entityTitle: opts.entityTitle,
      eventId: opts.eventId,
      requesterId: opts.requesterId,
      requesterName: opts.requesterName,
      requesterEmail: opts.requesterEmail,
      targetMemberId: p.id,
      targetMemberName: p.name,
      targetMemberEmail: p.email,
      message: opts.message,
      status: 'pending' as const,
      createdAt: now,
      autoGenerated: true,
      approverLabel: p.label,
      ...(opts.extra || {}),
    }));

    return [...createdRows, ...(current || [])];
  });

  for (const row of createdRows) {
    if (!row.targetMemberEmail) continue;
    try {
      const entityLabel = ENTITY_LABELS[opts.entityType];
      const { getAppBaseUrl } = await import('./app-url');
      const baseUrl = getAppBaseUrl();

      let targetLink = `${baseUrl}/dashboard/approvals?id=${row.id}&entityId=${row.entityId}`;
      if (opts.entityType === 'event') targetLink = `${baseUrl}/dashboard/events/${opts.entityId}`;
      else if (opts.entityType === 'task') targetLink = `${baseUrl}/dashboard/tasks?highlight=${opts.entityId}`;
      else if (opts.entityType === 'design') targetLink = `${baseUrl}/dashboard/designs?highlight=${opts.entityId}`;
      else if (opts.entityType === 'proposal') targetLink = `${baseUrl}/dashboard/proposals?highlight=${opts.entityId}`;
      else if (opts.entityType === 'form') targetLink = `${baseUrl}/dashboard/forms?highlight=${opts.entityId}`;
      else if (opts.entityType === 'event-pass') targetLink = `${baseUrl}/dashboard/approvals?id=${row.id}`;

      const bodyHtml = `
        <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Hello <strong>${row.targetMemberName || 'there'}</strong>,</p>
        <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">A new <strong>${entityLabel.toLowerCase()}</strong> needs your sign-off as <strong>${row.approverLabel}</strong>:</p>
        <div style="background: #FEF7F6; border: 1px solid #E9E2F0; border-left: 4px solid #d97706; padding: 14px 18px; border-radius: 8px; margin: 18px 0;">
          <p style="margin: 0; font-weight: 700; font-size: 15px; color: #1C0F2A;">${row.entityTitle}</p>
          ${row.message ? `<p style="margin: 8px 0 0 0; color: #574769; font-size: 13px;">"${row.message}"</p>` : ''}
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${targetLink}" target="_blank" style="display: inline-block; background: #CC3D19; color: #ffffff; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 10px; text-decoration: none;">
            Review & Sign Off ${entityLabel} &rarr;
          </a>
        </div>
        <p style="color: #76648B; font-size: 12px; line-height: 1.5; margin-bottom: 0;">If the button does not open, copy and paste this link into your browser:<br /><span style="word-break: break-all; color: #CC3D19;">${targetLink}</span></p>
      `;
      await dispatchEmail({
        to: row.targetMemberEmail,
        subject: `Approval requested: ${row.entityTitle}`,
        bodyText: `${entityLabel} "${row.entityTitle}" needs your sign-off as ${row.approverLabel}. Review here: ${targetLink}`,
        bodyHtml: wrapInMasterEmailTemplate({
          pageTitle: `Approval requested: ${row.entityTitle}`,
          headerTitle: 'Approval Requested',
          headerSubtitle: `${entityLabel} sign-off needed`,
          badgeText: 'ACTION NEEDED',
          badgeColor: '#d97706',
          bodyContentHtml: bodyHtml,
        }),
        badgeText: 'ACTION NEEDED',
        badgeColor: '#d97706',
        category: 'APPROVAL_REQUEST',
      });
    } catch (emailErr) {
      console.error('[approval-sync] Failed to send fan-out notification email:', emailErr);
    }
  }

  return createdRows;
}

/**
 * Once the underlying record (Event/Task/Design/Announcement)
 * is actually decided — by whichever approver acted, on whichever surface —
 * resolve every still-pending auto-generated ApprovalRequest row for that
 * entity so the Approvals inbox doesn't keep asking the other two panel
 * members for a sign-off that already happened.
 */
export async function cascadeCloseAutoApprovals(
  entityType: AutoApprovalEntityType,
  entityId: string,
  decision: 'approved' | 'rejected',
  decidedByName?: string
): Promise<void> {
  await mutateCollection('approvalRequests', (current) => {
    let changed = false;
    const next = (current || []).map((r: any) => {
      if (r.entityType === entityType && r.entityId === entityId && r.status === 'pending' && r.autoGenerated) {
        changed = true;
        return {
          ...r,
          status: decision,
          decidedBy: decidedByName,
          decidedAt: new Date().toISOString(),
          decisionNote: decidedByName ? `Resolved directly on the ${ENTITY_LABELS[entityType]} record by ${decidedByName}.` : `Resolved directly on the ${ENTITY_LABELS[entityType]} record.`,
        };
      }
      return r;
    });
    return changed ? next : current;
  });
}

/**
 * Purges any auto-generated or manual ApprovalRequest rows referencing an entity
 * that has just been deleted (e.g. Task, Design, Event, Announcement, Member),
 * ensuring no orphaned requests or broken links remain in the Approvals inbox.
 */
export async function deleteLinkedApprovalRequests(
  entityType: AutoApprovalEntityType | 'member',
  entityId: string
): Promise<void> {
  await mutateCollection('approvalRequests', (current) => {
    return (current || []).filter((r: any) => !(r.entityType === entityType && r.entityId === entityId));
  });
}

