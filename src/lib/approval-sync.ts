// Server-side bridge that feeds the Approvals module (the `approvalRequests`
// collection / src/app/dashboard/approvals) from the module-specific approval
// gates that already live on Events, Tasks, Designs, Event Reports, and
// Announcements. Each of those keeps its own approval state on its own
// record (see local-data.ts's doc comments on EventItem/TaskItem's
// approvalStatus, DesignSubmissionItem.styleStatus, EventReportItem's dual
// sign-off, AnnouncementItem.status) — this module does not replace any of
// that. It fans a tracked ApprovalRequest row out to every eligible approver
// (Centre Head, Advisor, GG Campus Events Head) whenever one of those gates
// opens, so the request is visible in the Approvals inbox too, and closes
// the sibling rows out again once the underlying record is actually decided
// — whichever approver acts first on either surface resolves it everywhere.
import { readCollection, mutateCollection } from './server-db';
import { dispatchEmail, wrapInMasterEmailTemplate, findApprovalRecipients } from './email-service';
import type { ApprovalRequest } from './local-data';

type AutoApprovalEntityType = 'event' | 'task' | 'design' | 'event-report' | 'announcement' | 'procurement' | 'form' | 'committee' | 'event-pass' | 'proposal';

const ENTITY_LABELS: Record<AutoApprovalEntityType, string> = {
  event: 'Event',
  task: 'Task',
  design: 'Design',
  'event-report': 'Event Report',
  announcement: 'Announcement',
  procurement: 'Procurement Request',
  form: 'Form',
  committee: 'Event Committee',
  'event-pass': 'Event Pass Action',
  proposal: 'Proposal',
};

export interface ApprovalPanelMember {
  id: string;
  name: string;
  email?: string;
  label: string;
}

/**
 * Resolves the up-to-three-member panel this whole integration routes
 * through: Centre Head, Advisor, and the GG Campus Head of Events. Any one
 * of them acting is sufficient — see cascadeCloseAutoApprovals below.
 */
export async function resolveApprovalPanel(): Promise<ApprovalPanelMember[]> {
  const members = await readCollection('members');
  const recipients = findApprovalRecipients(members as any[]);
  const panel: ApprovalPanelMember[] = [];
  const seen = new Set<string>();
  const active = (members as any[]).filter(m => m.status !== 'Terminated');

  const push = (match: { name: string; email: string } | undefined, label: string) => {
    if (!match) return;
    const member = active.find(m => m.email === match.email) || { id: match.email, name: match.name, email: match.email };
    if (seen.has(member.id)) return;
    seen.add(member.id);
    panel.push({ id: member.id, name: member.name, email: member.email, label });
  };

  push(recipients.centreHead, 'Centre Head');
  push(recipients.advisor, 'Advisor');
  push(recipients.eventsHeadGg, 'GG Campus Events Head');

  return panel;
}

/**
 * Same idea as resolveApprovalPanel, but Centre Head + Advisor only — used
 * by Procurement Requests, whose approve/reject gate (permissions.ts's
 * canDecideProcurementRequest) deliberately excludes the GG Campus Events
 * Head that the default three-member panel includes.
 */
export async function resolveCentreHeadAdvisorPanel(): Promise<ApprovalPanelMember[]> {
  const members = await readCollection('members');
  const recipients = findApprovalRecipients(members as any[]);
  const panel: ApprovalPanelMember[] = [];
  const seen = new Set<string>();
  const active = (members as any[]).filter(m => m.status !== 'Terminated');

  const push = (match: { name: string; email: string } | undefined, label: string) => {
    if (!match) return;
    const member = active.find(m => m.email === match.email) || { id: match.email, name: match.name, email: match.email };
    if (seen.has(member.id)) return;
    seen.add(member.id);
    panel.push({ id: member.id, name: member.name, email: member.email, label });
  };

  push(recipients.centreHead, 'Centre Head');
  push(recipients.advisor, 'Advisor');

  return panel;
}

/**
 * Resolves the panel for an entity whose Group Policy approval gate names a
 * specific person or a policy-tag audience rather than the default Centre
 * Head/Advisor/GG Campus Events Head trio — e.g. a Faculty member configured
 * as a named advisor for a given capability. Mirrors the matching logic in
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

/**
 * Panel for a form built by a Training Associate: the default panel (Centre Head, Advisor, GG Campus Events Head) plus
 * the Super User(s), so every approver named for those forms is asked.
 */
export async function resolveTraineeFormPanel(): Promise<ApprovalPanelMember[]> {
  const panel = await resolveApprovalPanel();
  const seen = new Set(panel.map(p => p.id));
  const members = await readCollection<any>('members');
  for (const m of members) {
    if (m.tier === 1 && m.status !== 'Terminated' && m.email && !seen.has(m.id)) {
      seen.add(m.id);
      panel.push({ id: m.id, name: m.name, email: m.email, label: 'Super User' });
    }
  }
  return panel;
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
      else if (opts.entityType === 'event-report') targetLink = `${baseUrl}/dashboard/event-reports?highlight=${opts.entityId}`;
      else if (opts.entityType === 'procurement') targetLink = `${baseUrl}/dashboard/procurement?highlight=${opts.entityId}`;
      else if (opts.entityType === 'proposal') targetLink = `${baseUrl}/dashboard/proposals?highlight=${opts.entityId}`;
      else if (opts.entityType === 'form') targetLink = `${baseUrl}/dashboard/forms?highlight=${opts.entityId}`;
      else if (opts.entityType === 'event-pass') targetLink = `${baseUrl}/dashboard/approvals?id=${row.id}`;
      else if (opts.entityType === 'committee' && opts.eventId) targetLink = `${baseUrl}/dashboard/events/${opts.eventId}`;

      const bodyHtml = `
        <p style="margin-top: 0; color: #0f172a; font-size: 14px;">Hello <strong>${row.targetMemberName || 'there'}</strong>,</p>
        <p style="color: #334155; font-size: 14px; line-height: 1.6;">A new <strong>${entityLabel.toLowerCase()}</strong> needs your sign-off as <strong>${row.approverLabel}</strong>:</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #d97706; padding: 14px 18px; border-radius: 8px; margin: 18px 0;">
          <p style="margin: 0; font-weight: 700; font-size: 15px; color: #0f172a;">${row.entityTitle}</p>
          ${row.message ? `<p style="margin: 8px 0 0 0; color: #475569; font-size: 13px;">"${row.message}"</p>` : ''}
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${targetLink}" target="_blank" style="display: inline-block; background: #0284c7; color: #ffffff; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 10px; text-decoration: none;">
            Review & Sign Off ${entityLabel} &rarr;
          </a>
        </div>
        <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin-bottom: 0;">If the button does not open, copy and paste this link into your browser:<br /><span style="word-break: break-all; color: #0284c7;">${targetLink}</span></p>
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
 * Once the underlying record (Event/Task/Design/Event Report/Announcement)
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
 * that has just been deleted (e.g. Task, Design, Event, Event Report, Announcement, Member),
 * ensuring no orphaned requests or broken links remain in the Approvals inbox.
 */
export async function deleteLinkedApprovalRequests(
  entityType: AutoApprovalEntityType | 'member' | 'committee',
  entityId: string
): Promise<void> {
  await mutateCollection('approvalRequests', (current) => {
    return (current || []).filter((r: any) => !(r.entityType === entityType && r.entityId === entityId));
  });
}

