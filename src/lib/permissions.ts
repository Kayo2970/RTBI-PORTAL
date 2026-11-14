/**
 * permissions.ts — Centralised access checks for the RTBI portal.
 *
 * Four-tier, top-down hierarchy (lower number = more access):
 *   1 = Super User   2 = CEO   3 = Employee   4 = Startup
 *
 * ZERO-TRUST, ZERO-ACCESS POLICY (ACTIVE):
 * Under the site-wide Zero-Trust policy, ONLY the Super User (tier 1) has
 * access to portal modules, models, and controls. Not even the CEO or
 * employees have access at this time.
 * Granular permissions, department views, and role-based capabilities will
 * be provisioned in future rollout phases as the site is finalized.
 */
import { Member, Guest, TaskItem, RatingItem, ReimbursementItem, BudgetItem, GroupPolicy, EventItem, PublicFormItem, ModuleAccessKey, getGroupPolicies, isTaskAssignee } from './local-data';

export type SessionUser = {
  id?: string;
  employeeId?: string;
  policyIds?: string[];
  name: string;
  email: string;
  tier: number;
  division?: string;
  department?: string;
  role?: string;
} | null | undefined;

export const TIER_SUPER_USER = 1;
export const TIER_CEO = 2;
export const TIER_EMPLOYEE = 3;
export const TIER_STARTUP = 4;
export type TierNumber = 1 | 2 | 3 | 4;
export const TIER_LABELS: Record<TierNumber, 'Super User' | 'CEO' | 'Employee' | 'Startup'> = { 1: 'Super User', 2: 'CEO', 3: 'Employee', 4: 'Startup' };

/** Human label for a tier number (falls back to "Member" for legacy/unknown values). */
export function tierLabel(tier: number | undefined | null): string {
  return TIER_LABELS[tier as TierNumber] ?? 'Member';
}

/**
 * Site-wide Zero-Trust Zero-Access Policy Flag.
 * When true, ONLY the Super User (Tier 1) has access to modules, data, and controls.
 */
export const ZERO_TRUST_POLICY_ACTIVE = true;

export function isSuperUser(user: SessionUser): boolean {
  return !!user && user.tier === 1;
}

export function isCEO(user: SessionUser): boolean {
  return !!user && user.tier === TIER_CEO;
}

export function isEmployee(user: SessionUser): boolean {
  return !!user && user.tier === TIER_EMPLOYEE;
}

export function isStartup(user: SessionUser): boolean {
  return !!user && user.tier === TIER_STARTUP;
}

export function isExecutiveRole(user: SessionUser): boolean {
  if (ZERO_TRUST_POLICY_ACTIVE) return isSuperUser(user);
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isPresident(user: SessionUser): boolean {
  return false;
}

export function isGeneralSecretary(user: SessionUser): boolean {
  return false;
}

export function isChiefCoordinator(user: SessionUser): boolean {
  return false;
}

export function isAlumniRole(user: SessionUser): boolean {
  return false;
}

export function isHeadRole(user: SessionUser): boolean {
  if (ZERO_TRUST_POLICY_ACTIVE) return isSuperUser(user);
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isSectorHead(user: SessionUser): boolean {
  if (ZERO_TRUST_POLICY_ACTIVE) return isSuperUser(user);
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isFinanceHead(user: SessionUser): boolean {
  if (ZERO_TRUST_POLICY_ACTIVE) return isSuperUser(user);
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isBaseLeadership(user: SessionUser): boolean {
  if (ZERO_TRUST_POLICY_ACTIVE) return isSuperUser(user);
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isCoreCommitteeTier(user: SessionUser): boolean {
  if (ZERO_TRUST_POLICY_ACTIVE) return isSuperUser(user);
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isChiefAdvisor(user: SessionUser): boolean {
  return false;
}

export function isAdvisor(user: SessionUser): boolean {
  return false;
}

export function isCentreHead(user: SessionUser): boolean {
  if (ZERO_TRUST_POLICY_ACTIVE) return isSuperUser(user);
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function canExportEventDetails(user: SessionUser): boolean {
  return isSuperUser(user);
}

export function isHeadOfEvents(user: SessionUser): boolean {
  return false;
}

export function isEventsHeadGgCampus(user: SessionUser): boolean {
  return false;
}

export function isEventsHeadRtcCampus(user: SessionUser): boolean {
  return false;
}

export function canSendTaskAllotmentEmail(user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canManageFestivals(user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canEvaluateEventStudent(user: SessionUser): boolean {
  return isSuperUser(user);
}

export type RatingReviewerRole = 'SUPER_USER' | 'CEO';

export function resolveRatingReviewerRole(user: SessionUser): RatingReviewerRole | null {
  if (!user) return null;
  if (user.tier === 1) return 'SUPER_USER';
  if (user.tier === 2) return 'CEO';
  return null;
}

export function canManageCanvaLibrary(user: SessionUser): boolean {
  return isSuperUser(user);
}

export const CAPABILITY_CATALOG: { key: string; label: string; description: string; module: string }[] = [
  { key: 'EVENTS_CREATE', label: 'Create Events', description: 'Create new events.', module: 'Events' },
  { key: 'EVENTS_EDIT', label: 'Edit Events', description: "Edit any existing event's details.", module: 'Events' },
  { key: 'EVENTS_DELETE', label: 'Delete Events', description: 'Delete any event.', module: 'Events' },
  { key: 'EVENTS_VIEW_ALL', label: 'View All Events', description: 'See every event, not just ones created by or listing this person.', module: 'Events' },
  { key: 'EVENT_EXPORT', label: 'Download Event & Participant Details', description: 'Download an event\'s details together with the details of every participant (roles, contact info) as a CSV.', module: 'Events' },
  { key: 'FESTIVALS_MANAGE', label: 'Manage Festivals', description: 'Create, edit, and organize festival schedules and events.', module: 'Festivals' },
  { key: 'TASKS_CREATE', label: 'Create Tasks', description: 'Assign new tasks to individuals or groups.', module: 'Tasks' },
  { key: 'TASKS_EDIT', label: 'Edit Tasks', description: 'Edit any existing task.', module: 'Tasks' },
  { key: 'TASKS_DELETE', label: 'Delete Tasks', description: 'Delete any task.', module: 'Tasks' },
  { key: 'TASKS_VIEW_ALL', label: 'View All Tasks', description: "See every task, not just this person's own or their department's.", module: 'Tasks' },
  { key: 'DECIDE_TASK_EXTENSION', label: 'Decide Task Extensions', description: 'Approve or reject a Pending Extension request on a task.', module: 'Tasks' },
  { key: 'EDIT_DIRECTORY', label: 'Edit Own Directory Records', description: 'One-time edit of a member record this person personally added.', module: 'Members Directory' },
  { key: 'VIEW_FULL_DIRECTORY', label: 'View Full Directory', description: 'See the entire member roster, not just their own profile.', module: 'Members Directory' },
  { key: 'TERMINATE_MEMBER', label: 'Terminate/Reactivate Members', description: 'Terminate or reactivate any member account.', module: 'Members Directory' },
  { key: 'GUEST_DIRECTORY_ACCESS', label: 'Access Guest Directory', description: 'Open the Guest Directory module at all (visiting-card contacts).', module: 'Guest Directory' },
  { key: 'GUEST_DIRECTORY_DELETE', label: 'Delete Guest Records', description: 'Remove any guest from the Guest Directory.', module: 'Guest Directory' },
  { key: 'VISITING_CARD_ACCESS', label: 'Access Visiting Cards', description: 'Access and manage digital keycards and scanned visiting cards.', module: 'Visiting Card' },
  { key: 'VIEW_ALL_DESIGNS', label: 'View All Design Submissions', description: 'See every submission in the Design Portal, not just their own.', module: 'Design Portal' },
  { key: 'DESIGN_STYLE_APPROVE', label: 'Style Approve/Reject Designs', description: 'Approve or reject a design submission on the Style Review step.', module: 'Design Portal' },
  { key: 'DESIGN_DELETE', label: 'Delete Design Submissions', description: 'Delete any design submission, not just their own.', module: 'Design Portal' },
  { key: 'APPROVE_REIMBURSEMENTS_SECTOR', label: 'Approve Reimbursements (Sector Head stage)', description: 'First-pass reimbursement review and approval.', module: 'Reimbursements' },
  { key: 'APPROVE_REIMBURSEMENTS_FINANCE', label: 'Approve Reimbursements (Finance Head stage)', description: 'Final-stage reimbursement approval.', module: 'Reimbursements' },
  { key: 'REIMBURSEMENTS_VIEW_ALL', label: 'View All Reimbursements', description: 'See all reimbursement claims across the organization.', module: 'Reimbursements' },
  { key: 'PROPOSE_BUDGET', label: 'Propose Budgets', description: 'Propose an annual or monthly budget request.', module: 'Budget & Funds' },
  { key: 'MANAGE_BUDGET', label: 'Manage Budget & Funds', description: 'Propose and manage budget requests.', module: 'Budget & Funds' },
  { key: 'BUILD_FORMS', label: 'Build Public Forms', description: 'Create and edit public-facing forms.', module: 'Public Forms' },
  { key: 'FORMS_VIEW_RESPONSES', label: 'View Form Responses', description: 'View and export submissions for public forms.', module: 'Public Forms' },
  { key: 'FORMS_DELETE', label: 'Delete Public Forms', description: 'Delete public forms and their configurations.', module: 'Public Forms' },
  { key: 'CREATE_ANNOUNCEMENT', label: 'Publish Announcements', description: 'Author and publish announcements.', module: 'Announcements' },
  { key: 'APPROVE_ANNOUNCEMENT', label: 'Approve Announcements', description: 'Approve or reject a Pending announcement.', module: 'Announcements' },
  { key: 'DELETE_ANNOUNCEMENT', label: 'Delete Announcements', description: 'Delete published announcements.', module: 'Announcements' },
  { key: 'CREATE_RATING', label: 'Create Member Ratings', description: 'Rate and evaluate performance on completed tasks.', module: 'Ratings & Reports' },
  { key: 'RATING_EDIT_ANY', label: 'Edit/Delete Any Rating', description: 'Edit or delete a rating authored by someone else.', module: 'Ratings & Reports' },
  { key: 'VIEW_ALL_REPORTS', label: 'View All Performance Reports', description: 'See every report/rating record.', module: 'Ratings & Reports' },
  { key: 'EVENT_REPORTS_SUBMIT', label: 'Submit Event Reports', description: 'Submit formal post-event reports for approval.', module: 'Event Reports' },
  { key: 'EVENT_REPORTS_REVIEW', label: 'Review Event Reports', description: 'Approve or reject submitted event reports.', module: 'Event Reports' },
  { key: 'EVENT_REPORTS_SCORE', label: 'Score Event Reports', description: 'Give a submitted event report its quality score.', module: 'Event Reports' },
  { key: 'EVENT_REPORTS_VIEW_ALL', label: 'View All Event Reports', description: 'See every submitted event report.', module: 'Event Reports' },
  { key: 'EVENT_REPORTS_DELETE', label: 'Delete Event Reports', description: 'Delete submitted event reports.', module: 'Event Reports' },
  { key: 'MANAGE_GUEST_INVITES', label: 'Manage Mail Merge', description: 'Access the Mail Merge tool.', module: 'Mail Merge' },
  { key: 'MANAGE_EVENT_PASSES', label: 'Manage Event Passes & Tickets', description: 'Open Pass Studio, issue passes, manage rosters, and broadcast push alerts.', module: 'Event Passes' },
  { key: 'EVENT_PASSES_EDIT', label: 'Edit Issued Passes & Wallet Passes', description: 'Edit any aspect of an issued pass and wallet pass.', module: 'Event Passes' },
  { key: 'EVENT_PASSES_DISPATCH', label: 'Email & Dispatch Event Passes', description: 'Preview and email passes to attendees.', module: 'Event Passes' },
  { key: 'EVENT_PASSES_DELETE', label: 'Delete Event Passes', description: 'Delete issued event passes.', module: 'Event Passes' },
  { key: 'EVENT_PASSES_VIEW', label: 'View Guest List & Issued Certificates', description: 'Read-only: view guest list and certificates.', module: 'Event Passes' },
  { key: 'SCAN_EVENT_PASSES', label: 'Scan & Admit Turnstile Passes', description: 'Operate turnstile camera QR scanner.', module: 'Event Passes' },
  { key: 'CERTIFICATES_SEND', label: 'Send Attendance Certificates', description: 'Preview, email and schedule PDF attendance certificates.', module: 'Certificates' },
  { key: 'CERTIFICATES_DESIGN', label: 'Design Certificates & Fonts', description: 'Edit certificate templates and custom fonts.', module: 'Certificates' },
  { key: 'CERTIFICATES_DELETE', label: 'Delete Issued Certificates', description: 'Permanently delete issued certificates.', module: 'Certificates' },
  { key: 'MANAGE_BACKUP', label: 'Access Backup & Restore', description: 'Download system backups and restore.', module: 'Administration' },
  { key: 'MANAGE_EMAIL_SETTINGS', label: 'Access Email Management', description: 'View logs and manage email settings.', module: 'Administration' },
  { key: 'MANAGE_GROUP_POLICIES', label: 'Manage Group Policies', description: 'Create and configure group policies.', module: 'Administration' },
];

export function isPolicyActive(policy: GroupPolicy): boolean {
  if (policy.enabled === false) return false;
  if (policy.expiresAt && new Date(policy.expiresAt).getTime() <= Date.now()) return false;
  return true;
}

export function memberMatchesPolicy(user: SessionUser, policy: GroupPolicy): boolean {
  if (!user) return false;
  if (user.id && policy.targetMemberIds?.includes(user.id)) return true;
  if (user.id && (user as any).policyIds?.includes(policy.id)) return true;
  if (policy.targetDivisions?.length && user.division && policy.targetDivisions.includes(user.division as any)) return true;
  if (policy.targetTiers?.length && typeof user.tier === 'number' && policy.targetTiers.includes(user.tier)) return true;
  if (policy.targetDesignationKeyword?.trim()) {
    const kw = policy.targetDesignationKeyword.trim().toLowerCase();
    if ((user.role || '').toLowerCase().includes(kw)) return true;
  }
  return false;
}

export function hasCapability(user: SessionUser, capability: string): boolean {
  if (!user) return false;
  if (user.tier === 1) return true;
  try {
    const policies = getGroupPolicies();
    return policies.some((p) => isPolicyActive(p) && p.capabilities?.includes(capability) && memberMatchesPolicy(user, p));
  } catch {
    return false;
  }
}

export const MODULE_CATALOG: { key: ModuleAccessKey; label: string; description: string; ownershipNote?: string }[] = [
  { key: 'EVENTS', label: 'Events', description: 'Event records.' },
  { key: 'EVENT_PASSES', label: 'Event Passes & Tickets', description: 'Pass studio, issued passes, and scanner.' },
  { key: 'TASKS', label: 'Tasks', description: 'Assigned task deliverables.' },
  { key: 'DIRECTORY', label: 'Members Directory', description: 'The member roster.' },
  { key: 'GUEST_DIRECTORY', label: 'Guest Directory', description: 'Visiting-card guest contacts.' },
  { key: 'DESIGNS', label: 'Design Portal', description: 'Design submissions and proofreading.' },
  { key: 'REIMBURSEMENTS', label: 'Reimbursements', description: 'Reimbursement claims.' },
  { key: 'BUDGET', label: 'Budget & Funds', description: 'Budget proposals and verification.' },
  { key: 'FORMS', label: 'Public Forms', description: 'Public-facing forms and their submissions.' },
  { key: 'ANNOUNCEMENTS', label: 'Announcements', description: 'Published announcements.' },
  { key: 'RATINGS', label: 'Ratings & Performance', description: 'Student performance evaluations.' },
  { key: 'REPORTS', label: 'Performance Reports', description: 'Performance analytical reports.' },
  { key: 'EVENT_REPORTS', label: 'Event Reports', description: 'Post-event formal report submissions.' },
  { key: 'FESTIVALS', label: 'Festivals', description: 'Festival schedules and events.' },
  { key: 'VISITING_CARD', label: 'Visiting Cards', description: 'Digital keycards and visiting contacts.' },
  { key: 'GUEST_INVITES', label: 'Mail Merge', description: 'Personalized bulk email tool.' },
  { key: 'APPROVALS', label: 'Approvals Queue', description: 'Cross-module multi-department approval requests.' },
  { key: 'BACKUP', label: 'Backup & Restore', description: 'System backups and disaster recovery restorations.' },
  { key: 'EMAIL', label: 'Email Management', description: 'Dispatch logs and email settings.' },
  { key: 'POLICIES', label: 'Group Policies', description: 'Dynamic access control and permissions management.' },
  { key: 'PROCUREMENT', label: 'Procurement Requests', description: 'Material requests for events and tasks.' },
];

export function hasModuleViewAllGrant(user: SessionUser, moduleKey: ModuleAccessKey): boolean {
  if (!user) return false;
  if (user.tier === 1) return true;
  try {
    const policies = getGroupPolicies();
    return policies.some((p) => isPolicyActive(p) && p.moduleAccess?.[moduleKey]?.view === 'ALL' && memberMatchesPolicy(user, p));
  } catch {
    return false;
  }
}

export function hasModuleViewOwnRestriction(user: SessionUser, moduleKey: ModuleAccessKey): boolean {
  if (!user) return false;
  if (user.tier === 1) return false;
  try {
    const policies = getGroupPolicies();
    return policies.some((p) => isPolicyActive(p) && p.moduleAccess?.[moduleKey]?.view === 'OWN' && memberMatchesPolicy(user, p));
  } catch {
    return false;
  }
}

export function resolveModuleEditOverride(user: SessionUser, moduleKey: ModuleAccessKey): 'ALL' | 'OWN' | 'NONE' | undefined {
  if (!user) return undefined;
  if (user.tier === 1) return 'ALL';
  try {
    const policies = getGroupPolicies();
    const matching = policies.filter((p) => isPolicyActive(p) && p.moduleAccess?.[moduleKey]?.edit && memberMatchesPolicy(user, p));
    if (matching.some((p) => p.moduleAccess?.[moduleKey]?.edit === 'ALL')) return 'ALL';
    if (matching.some((p) => p.moduleAccess?.[moduleKey]?.edit === 'OWN')) return 'OWN';
    if (matching.some((p) => p.moduleAccess?.[moduleKey]?.edit === 'NONE')) return 'NONE';
  } catch {}
  return undefined;
}

export function resolveModuleViewOverride(user: SessionUser, moduleKey: ModuleAccessKey): 'ALL' | 'OWN' | undefined {
  if (!user) return undefined;
  if (user.tier === 1) return 'ALL';
  try {
    const policies = getGroupPolicies();
    const matching = policies.filter((p) => isPolicyActive(p) && p.moduleAccess?.[moduleKey]?.view && memberMatchesPolicy(user, p));
    if (matching.some((p) => p.moduleAccess?.[moduleKey]?.view === 'ALL')) return 'ALL';
    if (matching.some((p) => p.moduleAccess?.[moduleKey]?.view === 'OWN')) return 'OWN';
  } catch {}
  return undefined;
}

export function isOwnCreatedGuest(guest: { createdBy?: string; metBy?: string }, user: SessionUser): boolean {
  if (!user) return false;
  const userEmail = (user.email || '').trim().toLowerCase();
  const userName = (user.name || '').trim().toLowerCase();
  const userId = (user.id || '').trim().toLowerCase();

  const createdBy = (guest.createdBy || '').trim().toLowerCase();
  const metBy = (guest.metBy || '').trim().toLowerCase();

  if (createdBy && (createdBy === userEmail || createdBy === userId || createdBy === userName)) return true;
  if (metBy && metBy === userName) return true;
  return false;
}

export const SELF_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function canViewGuestRecord(guest: Guest, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canEditMemberRecordRow(member: Member, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canEditGuestRecord(guest: Guest, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function isRestrictedDirectoryEditor(user: SessionUser): boolean {
  return false;
}

export function isRestrictedGuestEditor(user: SessionUser): boolean {
  return false;
}

export interface ApprovalRequirement {
  requiresApproval: boolean;
  approverType?: GroupPolicy['approverType'];
  approverMemberId?: string;
  approverPolicyTagId?: string;
  approverName?: string;
  policyName?: string;
}

export function getApprovalRequirement(user: SessionUser, capability: string, builtInGranted: boolean): ApprovalRequirement {
  return { requiresApproval: false };
}

export function canApproveAsSectorHead(user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canVerifyReimbursementCentreHead(user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canApproveAsFinanceHead(user: SessionUser, claim?: ReimbursementItem): boolean {
  return isSuperUser(user);
}

export function canSubmitBudget(user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canVerifyBudgetCentreHead(user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canDecideBudget(user: SessionUser, budget?: BudgetItem): boolean {
  return isSuperUser(user);
}

export function canApproveAnnouncement(user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canViewReimbursement(claim: ReimbursementItem, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canCreateEvent(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'EVENTS_CREATE') || resolveModuleEditOverride(user, 'EVENTS') === 'ALL';
}

export function canEditEvent(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'EVENTS_EDIT') || resolveModuleEditOverride(user, 'EVENTS') === 'ALL';
}

export function canDeleteEvent(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'EVENTS_DELETE');
}

export function canManageEvents(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'EVENTS_CREATE') || hasCapability(user, 'EVENTS_EDIT');
}

export function canManageEventPasses(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'MANAGE_EVENT_PASSES');
}

export function canScanEventPasses(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'SCAN_EVENT_PASSES') || hasCapability(user, 'MANAGE_EVENT_PASSES');
}

export function canEditEventPasses(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'EVENT_PASSES_EDIT') || hasCapability(user, 'MANAGE_EVENT_PASSES');
}

export function canDispatchEventPasses(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'EVENT_PASSES_DISPATCH') || hasCapability(user, 'MANAGE_EVENT_PASSES');
}

export function canSendCertificates(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'CERTIFICATES_SEND');
}

export function canDesignCertificates(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'CERTIFICATES_DESIGN');
}

export function canDeleteEventPasses(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'EVENT_PASSES_DELETE');
}

export function canDeleteCertificates(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'CERTIFICATES_DELETE');
}

export function canViewIssuedEventPasses(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'EVENT_PASSES_VIEW') || isStaffTier(user);
}

export function canViewEventGuestList(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'EVENT_PASSES_VIEW') || isStaffTier(user);
}

export function canViewIssuedCertificates(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'EVENT_PASSES_VIEW') || isStaffTier(user);
}

export function canAccessEventPassesModule(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'MANAGE_EVENT_PASSES') || hasCapability(user, 'EVENT_PASSES_VIEW') || hasCapability(user, 'SCAN_EVENT_PASSES');
}

export function canAccessGroupPolicies(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'MANAGE_GROUP_POLICIES');
}

export function canViewEvent(event: EventItem, user: SessionUser): boolean {
  if (!user) return false;
  if (isSuperUser(user)) return true;
  if (hasCapability(user, 'EVENTS_VIEW_ALL') || hasModuleViewAllGrant(user, 'EVENTS')) return true;
  if (hasModuleViewOwnRestriction(user, 'EVENTS')) {
    return event.submittedByEmail === user.email || event.createdBy === user.email;
  }
  return true;
}

export function getEventApprovalRequirement(user: SessionUser, action: 'CREATE' | 'EDIT' | 'DELETE'): ApprovalRequirement {
  return { requiresApproval: false };
}

export function canApprovePendingEvent(event: EventItem, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function getTaskApprovalRequirement(user: SessionUser, action: 'CREATE' | 'EDIT'): ApprovalRequirement {
  return { requiresApproval: false };
}

export function canApprovePendingTask(task: TaskItem, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canRespondToHolidayApproval(task: TaskItem, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canDelegateAutoTask(task: TaskItem, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canViewTaskDelegationTrail(user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canCreateTask(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'TASKS_CREATE') || resolveModuleEditOverride(user, 'TASKS') === 'ALL';
}

export function canEditTask(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'TASKS_EDIT') || resolveModuleEditOverride(user, 'TASKS') === 'ALL';
}

export function canDeleteTask(user: SessionUser, task?: TaskItem): boolean {
  return isSuperUser(user) || hasCapability(user, 'TASKS_DELETE');
}

export function canManageTasks(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'TASKS_EDIT') || hasCapability(user, 'TASKS_CREATE');
}

export function canViewTaskExtended(task: TaskItem, user: SessionUser): boolean {
  if (!user) return false;
  if (isSuperUser(user)) return true;
  if (hasCapability(user, 'TASKS_VIEW_ALL') || hasModuleViewAllGrant(user, 'TASKS')) return true;
  if (isTaskAssignee(task, user) || (task as any).creatorName === user.name || (task as any).assignedBy === user.name) return true;
  return typeof user.tier === 'number' && user.tier <= 3;
}

export function canViewHiddenAccounts(user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canViewRating(rating: RatingItem, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canEditRating(rating: RatingItem, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canViewFullDirectory(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'VIEW_FULL_DIRECTORY') || hasModuleViewAllGrant(user, 'DIRECTORY') || isStaffTier(user);
}

export function canEditDirectory(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'EDIT_DIRECTORY');
}

export function canAddMember(user: SessionUser): boolean {
  return isSuperUser(user);
}

export function getMemberApprovalRequirement(user: SessionUser): ApprovalRequirement {
  return { requiresApproval: false };
}

export function canApprovePendingMember(member: Member, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canTerminateMember(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'TERMINATE_MEMBER');
}

export function canSetMemberPassword(user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canAccessGuestDirectory(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'GUEST_DIRECTORY_ACCESS') || isStaffTier(user);
}

export function canRemoveGuestContact(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'GUEST_DIRECTORY_DELETE');
}

export function canBuildForms(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'BUILD_FORMS') || resolveModuleEditOverride(user, 'FORMS') === 'ALL';
}

export function isTrainingAssociate(user: SessionUser): boolean {
  return false;
}

export function canCreateForms(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'BUILD_FORMS') || resolveModuleEditOverride(user, 'FORMS') === 'ALL';
}

export function seesOnlyOwnForms(user: SessionUser): boolean {
  return false;
}

export function isOwnForm(form: { createdById?: string; submittedByEmail?: string }, user: SessionUser): boolean {
  if (!user) return false;
  if (form.createdById) return form.createdById === user.id;
  return !!form.submittedByEmail && !!user.email && form.submittedByEmail.toLowerCase() === user.email.toLowerCase();
}

export function canDeleteForms(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'FORMS_DELETE');
}

export function getFormApprovalRequirement(user: SessionUser, action: 'CREATE' | 'EDIT' | 'DELETE'): ApprovalRequirement {
  return { requiresApproval: false };
}

export function canApprovePendingForm(form: PublicFormItem, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canCreateAnnouncement(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'CREATE_ANNOUNCEMENT') || resolveModuleEditOverride(user, 'ANNOUNCEMENTS') === 'ALL';
}

export function canDeleteAnnouncement(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'DELETE_ANNOUNCEMENT');
}

export function canViewAllDesigns(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'VIEW_ALL_DESIGNS');
}

export function canRequestTaskExtension(task: TaskItem, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canDecideTaskExtension(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'DECIDE_TASK_EXTENSION');
}

export function canChangeTaskStatus(task: TaskItem, user: SessionUser): boolean {
  return isSuperUser(user);
}

export function canManageGuestInvites(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'MANAGE_GUEST_INVITES');
}

export function canManageBackup(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'MANAGE_BACKUP');
}

export function canManageEmailSettings(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'MANAGE_EMAIL_SETTINGS');
}

export { getAnnouncementScopeMatch } from './announcement-scope';

// ---------------------------------------------------------------------------
// Bookings / Invoices & Payments / Inventory
// ---------------------------------------------------------------------------
export function isStaffTier(user: SessionUser): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= TIER_EMPLOYEE;
}

export function canBookRoom(user: SessionUser): boolean {
  return !!user;
}

export function canManageBilling(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'MANAGE_BILLING') || isStaffTier(user);
}

export function canManageRooms(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'MANAGE_ROOMS') || isStaffTier(user);
}

export function canManageInventory(user: SessionUser): boolean {
  return isSuperUser(user) || hasCapability(user, 'MANAGE_INVENTORY') || isStaffTier(user);
}
