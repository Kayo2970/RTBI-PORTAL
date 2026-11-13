/**
 * permissions.ts — Centralised access checks for the RTBI portal.
 *
 * Four-tier, top-down hierarchy (lower number = more access):
 *   1 = Super User   2 = CEO   3 = Employee   4 = Startup
 *
 * PHASE 1 (current): module permissions are deliberately BLANKET — every
 * signed-in user may use every ported module. Only account administration
 * (adding/terminating members, password overrides, email settings, group
 * policies, backup) is kept to the Super User. Scope and Group Policy
 * restrictions will be layered on later by tightening the can*() functions
 * below, without touching the pages that call them.
 *
 * Every function takes the user explicitly so it works the same in pages,
 * modals and background sync code. The export surface mirrors the ERP's
 * permissions.ts so ported modules compile unchanged.
 */
import { Member, Guest, TaskItem, RatingItem, ReimbursementItem, BudgetItem, ProcurementRequestItem, GroupPolicy, EventItem, PublicFormItem, ModuleAccessKey, getMembers, getGroupPolicies, getAccessLevelSettings, canViewTask, isTaskAssignee } from './local-data';

export type SessionUser = {
  id?: string;
  name: string;
  email: string;
  tier: number;
  division?: string;
  committee?: string;
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

export function canSubmitEventReport(user: SessionUser): boolean {
  return !!user;
}

export function canReviewEventReports(user: SessionUser): boolean {
  return !!user;
}

export function canScoreEventReports(user: SessionUser): boolean {
  return !!user;
}

export function canReviewDesignProofread(user: SessionUser, design?: { assignedProofreaderIds?: string[]; assignedProofreaderEmail?: string; assignedProofreaderId?: string }): boolean {
  return !!user;
}

export function canViewEventReports(user: SessionUser): boolean {
  return !!user;
}

export function isAlumniRole(user: SessionUser): boolean {
  return false;
}



export function isHeadRole(user: SessionUser): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isSectorHead(user: SessionUser): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isFinanceHead(user: SessionUser): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isBaseLeadership(user: SessionUser): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isCoreCommitteeTier(user: SessionUser): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isSuperUser(user: SessionUser): boolean {
  return !!user && user.tier === 1;
}

export function isChiefAdvisor(user: SessionUser): boolean {
  return false;
}

export function isAdvisor(user: SessionUser): boolean {
  return false;
}

export function isCentreHead(user: SessionUser): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function canExportEventDetails(user: SessionUser): boolean {
  return !!user;
}

export function isHeadOfEvents(user: SessionUser): boolean {
  return false;
}

export function isEventsHeadGgCampus(user: SessionUser): boolean {
  return false;
}

export function isCommitteeApprover(user: SessionUser): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isEventsHeadRtcCampus(user: SessionUser): boolean {
  return false;
}

export function canSendTaskAllotmentEmail(user: SessionUser): boolean {
  return !!user;
}

export function canManageFestivals(user: SessionUser): boolean {
  return !!user;
}

export function canEvaluateEventStudent(user: SessionUser, eventCampus?: string, isDesignDeliverable?: boolean): boolean {
  return !!user;
}

/**
 * Checks whether a task is eligible for ratings & evaluation.
 * Procurement tasks and administrative approval requests are strictly excluded
 * from ratings and reviews.
 */
export function isTaskRatable(task: { workflowType?: string; isProcurement?: boolean; procurementId?: string; title?: string } | null | undefined): boolean {
  if (!task) return false;
  if (task.workflowType === 'holiday_social_approval' || task.workflowType === 'procurement' || task.isProcurement || task.procurementId) return false;
  if (typeof task.title === 'string' && /procure items|procurement/i.test(task.title)) return false;
  return true;
}

/** The fixed reviewer slots a rating submission fills. */
export type RatingReviewerRole = 'SUPER_USER' | 'CENTRE_HEAD' | 'ADVISOR' | 'GG_HEAD' | 'DESIGN_HEAD';

export function resolveRatingReviewerRole(user: SessionUser, isDesignDeliverable?: boolean): RatingReviewerRole | null {
  if (!user) return null;
  if (user.tier === 1) return 'SUPER_USER';
  if (user.tier === 2) return 'CENTRE_HEAD';
  if (user.tier === 3) return 'ADVISOR';
  return null;
}

export function isDesignHead(user: SessionUser): boolean {
  return false;
}

export function canManageCanvaLibrary(user: SessionUser): boolean {
  return !!user;
}


/**
 * Group Policy Management — dynamic, Super User-managed access control.
 *
 * A fixed catalog of grantable capabilities, split at resource+action grain
 * (Events and Tasks each get CREATE/EDIT/DELETE/VIEW_ALL) so a policy can grant
 * exactly one slice of access — e.g. "create events" without also granting
 * "delete events" or "view everyone's events." Every capability key here maps
 * to an existing `can*` check below via `hasCapability()`, so a Group Policy
 * grant has the exact same effect as the hardcoded tier/role rules already
 * covering that action — it's an additional grant path, never a replacement.
 */
export const CAPABILITY_CATALOG: { key: string; label: string; description: string; module: string }[] = [
  { key: 'EVENTS_CREATE', label: 'Create Events', description: 'Create new events and their sub-committees.', module: 'Events' },
  { key: 'EVENTS_EDIT', label: 'Edit Events', description: "Edit any existing event's details.", module: 'Events' },
  { key: 'EVENTS_DELETE', label: 'Delete Events', description: 'Delete any event.', module: 'Events' },
  { key: 'EVENTS_VIEW_ALL', label: 'View All Events', description: 'See every event, not just ones created by or listing this person.', module: 'Events' },
  { key: 'EVENT_EXPORT', label: 'Download Event & Participant Details', description: 'Download an event\'s details together with the details of every participant (committees, roles, contact info) as a CSV — from the Events page and the Members Directory. CEO and Super User always have this.', module: 'Events' },
  { key: 'FESTIVALS_MANAGE', label: 'Manage Festivals', description: 'Create, edit, and organize festival schedules and events.', module: 'Festivals' },
  { key: 'TASKS_CREATE', label: 'Create Tasks', description: 'Assign new tasks to individuals or committees.', module: 'Tasks' },
  { key: 'TASKS_EDIT', label: 'Edit Tasks', description: 'Edit any existing task.', module: 'Tasks' },
  { key: 'TASKS_DELETE', label: 'Delete Tasks', description: 'Delete any task.', module: 'Tasks' },
  { key: 'TASKS_VIEW_ALL', label: 'View All Tasks', description: "See every task, not just this person's own or their department's.", module: 'Tasks' },
  { key: 'DECIDE_TASK_EXTENSION', label: 'Decide Task Extensions', description: 'Approve or reject a Pending Extension request on a task.', module: 'Tasks' },
  { key: 'EDIT_DIRECTORY', label: 'Edit Own Directory Records', description: 'One-time edit of a member record this person personally added — never adding, removing, or bulk-managing the roster. That stays locked to CEO and Super User and cannot be delegated here.', module: 'Members Directory' },
  { key: 'VIEW_FULL_DIRECTORY', label: 'View Full Directory', description: 'See the entire member roster, not just their own profile.', module: 'Members Directory' },
  { key: 'TERMINATE_MEMBER', label: 'Terminate/Reactivate Members', description: 'Terminate or reactivate any member account.', module: 'Members Directory' },
  { key: 'GUEST_DIRECTORY_ACCESS', label: 'Access Guest Directory', description: 'Open the Guest Directory module at all (visiting-card contacts) — same baseline as CEO/Super User get by default.', module: 'Guest Directory' },
  { key: 'GUEST_DIRECTORY_DELETE', label: 'Delete Guest Records', description: 'Remove any guest from the Guest Directory, not just ones they added.', module: 'Guest Directory' },
  { key: 'VISITING_CARD_ACCESS', label: 'Access Visiting Cards', description: 'Access and manage digital keycards and scanned visiting cards.', module: 'Visiting Card' },
  { key: 'VIEW_ALL_DESIGNS', label: 'View All Design Submissions', description: 'See every submission in the Design Portal, not just their own.', module: 'Design Portal' },
  { key: 'DESIGN_STYLE_APPROVE', label: 'Style Approve/Reject Designs', description: 'Approve or reject a design submission on the Style Review step.', module: 'Design Portal' },
  { key: 'DESIGN_DELETE', label: 'Delete Design Submissions', description: 'Delete any design submission, not just their own.', module: 'Design Portal' },
  { key: 'APPROVE_REIMBURSEMENTS_SECTOR', label: 'Approve Reimbursements (Sector Head stage)', description: 'First-pass reimbursement review and approval.', module: 'Reimbursements' },
  { key: 'APPROVE_REIMBURSEMENTS_FINANCE', label: 'Approve Reimbursements (Finance Head stage)', description: 'Final-stage reimbursement approval.', module: 'Reimbursements' },
  { key: 'REIMBURSEMENTS_VIEW_ALL', label: 'View All Reimbursements', description: 'See all reimbursement claims across the organization.', module: 'Reimbursements' },
  { key: 'PROPOSE_BUDGET', label: 'Propose Budgets', description: 'Propose an annual or monthly budget request.', module: 'Budget & Funds' },
  { key: 'MANAGE_BUDGET', label: 'Manage Budget & Funds', description: 'Propose and manage budget requests beyond the built-in CEO/Finance Head roles.', module: 'Budget & Funds' },
  { key: 'BUILD_FORMS', label: 'Build Public Forms', description: 'Create and edit public-facing forms.', module: 'Public Forms' },
  { key: 'FORMS_VIEW_RESPONSES', label: 'View Form Responses', description: 'View and export submissions for public forms.', module: 'Public Forms' },
  { key: 'FORMS_DELETE', label: 'Delete Public Forms', description: 'Delete public forms and their configurations.', module: 'Public Forms' },
  { key: 'CREATE_ANNOUNCEMENT', label: 'Publish Announcements', description: 'Author and publish announcements to a chosen scope.', module: 'Announcements' },
  { key: 'APPROVE_ANNOUNCEMENT', label: 'Approve Announcements', description: 'Approve or reject a Pending announcement before it circulates.', module: 'Announcements' },
  { key: 'DELETE_ANNOUNCEMENT', label: 'Delete Announcements', description: 'Delete published announcements.', module: 'Announcements' },
  { key: 'CREATE_RATING', label: 'Create Member Ratings', description: 'Rate and evaluate performance on completed tasks.', module: 'Ratings & Reports' },
  { key: 'RATING_EDIT_ANY', label: 'Edit/Delete Any Rating', description: 'Edit or delete a rating authored by someone else.', module: 'Ratings & Reports' },
  { key: 'VIEW_ALL_REPORTS', label: 'View All Performance Reports', description: 'See every report/rating record, not just their own or their department’s.', module: 'Ratings & Reports' },
  { key: 'EVENT_REPORTS_SUBMIT', label: 'Submit Event Reports', description: 'Submit formal post-event reports for approval.', module: 'Event Reports' },
  { key: 'EVENT_REPORTS_REVIEW', label: 'Review Event Reports', description: 'Approve or reject submitted event reports.', module: 'Event Reports' },
  { key: 'EVENT_REPORTS_SCORE', label: 'Score Event Reports', description: 'Give a submitted event report its quality score (clarity, flow, timeliness, errors, geotagged photos) from Event Reports or the Ratings page — without being able to approve or reject it.', module: 'Event Reports' },
  { key: 'EVENT_REPORTS_VIEW_ALL', label: 'View All Event Reports', description: 'See every submitted event report, not just ones this person submitted or is reviewing.', module: 'Event Reports' },
  { key: 'EVENT_REPORTS_DELETE', label: 'Delete Event Reports', description: 'Delete submitted event reports.', module: 'Event Reports' },
  { key: 'MANAGE_GUEST_INVITES', label: 'Manage Mail Merge', description: 'Access the Mail Merge tool (personalized bulk email — formerly "Guest Invites").', module: 'Mail Merge' },
  { key: 'MANAGE_EVENT_PASSES', label: 'Manage Event Passes & Tickets', description: 'Open the Pass Studio: issue passes (single and bulk CSV), design each event\'s pass look (artwork, logo, colours, QR style, event-title options for the wallet pass and the 3D card), manage rosters and broadcast push alerts. Includes editing, dispatching and deleting passes.', module: 'Event Passes' },
  { key: 'EVENT_PASSES_EDIT', label: 'Edit Issued Passes & Wallet Passes', description: 'Edit any aspect of an issued pass (details, event, valid days, colours, text size, QR style, event-title options) and re-issue its Apple / Google Wallet pass — without full Event Passes management.', module: 'Event Passes' },
  { key: 'EVENT_PASSES_DISPATCH', label: 'Email & Dispatch Event Passes', description: 'Preview and email passes to attendees: single send, bulk "Preview & dispatch", and "Email Unsent Passes".', module: 'Event Passes' },
  { key: 'EVENT_PASSES_DELETE', label: 'Delete Event Passes', description: 'Delete issued event passes (also removes their stored files and revokes the wallet pass).', module: 'Event Passes' },
  { key: 'EVENT_PASSES_VIEW', label: 'View Guest List & Issued Certificates', description: 'Read-only: open Event Passes to see the guest list (issued passes per event) and the certificates issued/sent for each event — without being able to issue, edit, email or delete passes or change the certificate design. Also shows passes and certificates on the event page.', module: 'Event Passes' },
  { key: 'SCAN_EVENT_PASSES', label: 'Scan & Admit Turnstile Passes', description: 'Operate turnstile camera QR scanner and check in attendees at venue gates.', module: 'Event Passes' },
  { key: 'CERTIFICATES_SEND', label: 'Send Attendance Certificates', description: 'Preview, email and schedule PDF attendance certificates to checked-in attendees of a finished event ("Send Certificates" in Event Passes) — without being able to email passes or change the certificate design.', module: 'Certificates' },
  { key: 'CERTIFICATES_DESIGN', label: 'Design Certificates & Fonts', description: 'Edit the certificate design for an event (artwork, text boxes, which details are printed) and upload / import / delete custom certificate fonts.', module: 'Certificates' },
  { key: 'CERTIFICATES_DELETE', label: 'Delete Issued Certificates', description: 'Permanently delete issued certificates from the Issued Certificates box (their verify links stop working).', module: 'Certificates' },
  { key: 'MANAGE_BACKUP', label: 'Access Backup & Restore', description: 'Download system backups and restore from an archive.', module: 'Administration' },
  { key: 'MANAGE_EMAIL_SETTINGS', label: 'Access Email Management', description: 'View dispatch logs and manage email settings.', module: 'Administration' },
  { key: 'MANAGE_GROUP_POLICIES', label: 'Manage Group Policies', description: 'Create, edit, and configure group policies and dynamic RBAC tags.', module: 'Administration' },
];



export function hasCapability(user: SessionUser, capability: string): boolean {
  return !!user;
}

/**
 * Module View/Edit Access — the generalized, every-module version of the
 * eventVisibilityScope pattern (GroupPolicy.moduleAccess). Each module gets a
 * canonical key + label here for the Group Policies UI; the actual grant/
 * restriction resolution lives in the functions below and is threaded into
 * each module's existing can*() checks as an additional path, never a
 * replacement — a policy with no moduleAccess entry for a module changes
 * nothing about that module's built-in behavior.
 */
export const MODULE_CATALOG: { key: ModuleAccessKey; label: string; description: string; ownershipNote?: string }[] = [
  { key: 'EVENTS', label: 'Events', description: 'Event records and their committees.', ownershipNote: 'Ownership = the event’s creator or a listed committee member.' },
  { key: 'EVENT_PASSES', label: 'Event Passes & Tickets', description: 'Pass studio (issue, design look, QR style, event-title options), issued-pass roster, editing, email dispatch, Apple / Google Wallet credentials, and turnstile gate scanner.', ownershipNote: 'Ownership = passes issued by the member or for events they manage.' },
  { key: 'TASKS', label: 'Tasks', description: 'Assigned task deliverables.', ownershipNote: 'Ownership = the task’s creator or assignee.' },
  { key: 'DIRECTORY', label: 'Members Directory', description: 'The member roster.', ownershipNote: 'Ownership = whoever added the member record. Edit ‘Own’ is one-time, within 24 hours of adding. Edit here only ever affects editing an existing record’s fields — adding a new member or removing one is locked to CEO and Super User and cannot be granted through this Edit column.' },
  { key: 'GUEST_DIRECTORY', label: 'Guest Directory', description: 'Visiting-card guest contacts.', ownershipNote: 'Ownership = whoever added the guest record. Edit ‘Own’ is one-time, within 24 hours of adding.' },
  { key: 'DESIGNS', label: 'Design Portal', description: 'Design submissions and proofreading.' },
  { key: 'REIMBURSEMENTS', label: 'Reimbursements', description: 'Reimbursement claims.', ownershipNote: 'Ownership = the claimant.' },
  { key: 'BUDGET', label: 'Budget & Funds', description: 'Budget proposals and verification.' },
  { key: 'FORMS', label: 'Public Forms', description: 'Public-facing forms and their submissions.' },
  { key: 'ANNOUNCEMENTS', label: 'Announcements', description: 'Published announcements.' },
  { key: 'RATINGS', label: 'Ratings & Performance', description: 'Student performance evaluations and ratings.', ownershipNote: 'Ownership = the rating’s author.' },
  { key: 'REPORTS', label: 'Performance Reports', description: 'Performance and task deliverable analytical reports.', ownershipNote: 'Ownership = the rating’s author.' },
  { key: 'EVENT_REPORTS', label: 'Event Reports', description: 'Post-event formal report submissions, review, and dual approvals.', ownershipNote: 'Ownership = the report’s submitter.' },
  { key: 'FESTIVALS', label: 'Festivals', description: 'Festival schedules, committees, and events.' },
  { key: 'VISITING_CARD', label: 'Visiting Cards', description: 'Digital keycards and visiting contacts.' },
  { key: 'GUEST_INVITES', label: 'Mail Merge', description: 'Personalized bulk email tool (formerly "Guest Invites").' },
  { key: 'APPROVALS', label: 'Approvals Queue', description: 'Cross-module multi-department approval requests.' },
  { key: 'BACKUP', label: 'Backup & Restore', description: 'System backups and disaster recovery restorations.' },
  { key: 'EMAIL', label: 'Email Management', description: 'Dispatch logs and email settings.' },
  { key: 'POLICIES', label: 'Group Policies', description: 'Dynamic access control and permissions management.' },
  { key: 'PROCUREMENT', label: 'Procurement Requests', description: 'Material requests for events and tasks.', ownershipNote: 'Ownership = the request’s submitter. Approving/rejecting is always restricted to the CEO and Super User, regardless of any policy grant here.' },
];


export function hasModuleViewAllGrant(user: SessionUser, moduleKey: ModuleAccessKey): boolean {
  return !!user;
}

export function hasModuleViewOwnRestriction(user: SessionUser, moduleKey: ModuleAccessKey): boolean {
  return false;
}

export function resolveModuleEditOverride(user: SessionUser, moduleKey: ModuleAccessKey): 'ALL' | 'OWN' | 'NONE' | undefined {
  return undefined;
}

export function resolveModuleViewOverride(user: SessionUser, moduleKey: ModuleAccessKey): 'ALL' | 'OWN' | undefined {
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

/** One-time self-edit window for records that track a creator (Members, Guests) — 24 hours from creation. */
export const SELF_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;


/** Check if user can view a specific guest record (strictly filtered when moduleAccess.GUEST_DIRECTORY.view === 'OWN' or edit === 'OWN'). */
export function canViewGuestRecord(guest: Guest, user: SessionUser): boolean {
  return !!user;
}

export function canEditMemberRecordRow(member: Member, user: SessionUser): boolean {
  return !!user;
}

export function canEditGuestRecord(guest: Guest, user: SessionUser): boolean {
  return !!user;
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
  approverName?: string; // human-readable, for the "submitted for approval from X" toast
  policyName?: string;
}


export function getApprovalRequirement(user: SessionUser, capability: string, builtInGranted: boolean): ApprovalRequirement {
  return { requiresApproval: false };
}

export function canApproveAsSectorHead(user: SessionUser): boolean {
  return !!user;
}

export function canVerifyReimbursementCentreHead(user: SessionUser): boolean {
  return !!user;
}

export function canApproveAsFinanceHead(user: SessionUser, claim?: ReimbursementItem): boolean {
  return !!user;
}

export function canSubmitBudget(user: SessionUser): boolean {
  return !!user;
}

export function canVerifyBudgetCentreHead(user: SessionUser): boolean {
  return !!user;
}

export function canDecideBudget(user: SessionUser, budget?: BudgetItem): boolean {
  return !!user;
}

export function canDecideProcurementRequest(user: SessionUser): boolean {
  return !!user;
}

export function canViewProcurementRequest(user: SessionUser, request: ProcurementRequestItem): boolean {
  return !!user;
}

export function canApproveAnnouncement(user: SessionUser): boolean {
  return !!user;
}

export function canViewReimbursement(claim: ReimbursementItem, user: SessionUser): boolean {
  return !!user;
}

export function canCreateEvent(user: SessionUser): boolean {
  return !!user;
}

export function canEditEvent(user: SessionUser): boolean {
  return !!user;
}

export function canDeleteEvent(user: SessionUser): boolean {
  return !!user;
}

export function canManageEvents(user: SessionUser): boolean {
  return !!user;
}

export function canManageEventPasses(user: SessionUser): boolean {
  return !!user;
}

export function canScanEventPasses(user: SessionUser): boolean {
  return !!user;
}

export function canEditEventPasses(user: SessionUser): boolean {
  return !!user;
}

export function canDispatchEventPasses(user: SessionUser): boolean {
  return !!user;
}

export function canSendCertificates(user: SessionUser): boolean {
  return !!user;
}

export function canDesignCertificates(user: SessionUser): boolean {
  return !!user;
}

export function canDeleteEventPasses(user: SessionUser): boolean {
  return !!user;
}

export function canDeleteCertificates(user: SessionUser): boolean {
  return !!user;
}

export function canViewIssuedEventPasses(user: SessionUser): boolean {
  return !!user;
}

export function canViewEventGuestList(user: SessionUser): boolean {
  return !!user;
}

export function canViewIssuedCertificates(user: SessionUser): boolean {
  return !!user;
}

export function canAccessEventPassesModule(user: SessionUser): boolean {
  return !!user;
}

export function canAccessGroupPolicies(user: SessionUser): boolean {
  return !!user && user.tier === 1;
}

export function canViewEvent(event: EventItem, user: SessionUser): boolean {
  return !!user;
}

export function getEventApprovalRequirement(user: SessionUser, action: 'CREATE' | 'EDIT' | 'DELETE'): ApprovalRequirement {
  return { requiresApproval: false };
}

export function canApprovePendingEvent(event: EventItem, user: SessionUser): boolean {
  return !!user;
}

export function getTaskApprovalRequirement(user: SessionUser, action: 'CREATE' | 'EDIT'): ApprovalRequirement {
  return { requiresApproval: false };
}

export function canApprovePendingTask(task: TaskItem, user: SessionUser): boolean {
  return !!user;
}

export function canRespondToHolidayApproval(task: TaskItem, user: SessionUser): boolean {
  return !!user;
}

export function canDelegateAutoTask(task: TaskItem, user: SessionUser): boolean {
  return !!user;
}

export function canViewTaskDelegationTrail(user: SessionUser): boolean {
  return !!user;
}

export function canCreateTask(user: SessionUser): boolean {
  return !!user;
}

export function canEditTask(user: SessionUser): boolean {
  return !!user;
}

export function canDeleteTask(user: SessionUser, task?: TaskItem): boolean {
  return !!user;
}

export function canManageTasks(user: SessionUser): boolean {
  return !!user;
}

export function canViewTaskExtended(task: TaskItem, user: SessionUser): boolean {
  return !!user;
}

export function canViewHiddenAccounts(user: SessionUser): boolean {
  return !!user && user.tier === 1;
}

export function canViewRating(rating: RatingItem, user: SessionUser): boolean {
  return !!user;
}

export function canEditRating(rating: RatingItem, user: SessionUser): boolean {
  return !!user;
}

export function canViewFullDirectory(user: SessionUser): boolean {
  return !!user;
}

export function canEditDirectory(user: SessionUser): boolean {
  return !!user;
}

export function canAddMember(user: SessionUser): boolean {
  return !!user && user.tier === 1;
}

export function getMemberApprovalRequirement(user: SessionUser): ApprovalRequirement {
  return { requiresApproval: false };
}

export function canApprovePendingMember(member: Member, user: SessionUser): boolean {
  return !!user && user.tier === 1;
}

export function canTerminateMember(user: SessionUser): boolean {
  return !!user && user.tier === 1;
}

export function canSetMemberPassword(user: SessionUser): boolean {
  return !!user && user.tier === 1;
}

export function isFaculty(user: SessionUser): boolean {
  return false;
}

export function isSocialMediaTeamMember(member: { division?: string; department?: string; committee?: string; role?: string; status?: string } | null | undefined): boolean {
  return false;
}

export function isSocialMediaHeadOrSrHead(member: { division?: string; department?: string; committee?: string; role?: string; status?: string } | null | undefined): boolean {
  return false;
}

export function isSocialMediaHead(member: { division?: string; department?: string; committee?: string; role?: string; status?: string } | null | undefined): boolean {
  return false;
}

export function isSocialMediaSrHead(member: { division?: string; department?: string; committee?: string; role?: string; status?: string } | null | undefined): boolean {
  return false;
}

/** Check if a task is a social media posting/design deliverable task. */
export function isSocialMediaPostTask(task: {
  title?: string;
  workflowType?: string;
  taskCategory?: string;
  isSocialMediaPost?: boolean;
  platform?: string;
} | null | undefined): boolean {
  if (!task) return false;
  if (task.workflowType === 'design_social_posting' || task.workflowType === 'holiday_design_social' || task.workflowType === 'event_social_post') {
    return true;
  }
  if (task.isSocialMediaPost === true) return true;
  if (task.platform === 'instagram' || task.platform === 'linkedin') return true;
  const title = (task.title || '').toLowerCase();
  return title.includes('social media') || title.includes('[social media posting]');
}

export function canAccessGuestDirectory(user: SessionUser): boolean {
  return !!user;
}

export function canRemoveGuestContact(user: SessionUser): boolean {
  return !!user;
}

export function canBuildForms(user: SessionUser): boolean {
  return !!user;
}

export function isTrainingAssociate(user: SessionUser): boolean {
  return false;
}

export function canCreateForms(user: SessionUser): boolean {
  return !!user;
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
  return !!user;
}

export function getFormApprovalRequirement(user: SessionUser, action: 'CREATE' | 'EDIT' | 'DELETE'): ApprovalRequirement {
  return { requiresApproval: false };
}

export function canApprovePendingForm(form: PublicFormItem, user: SessionUser): boolean {
  return !!user;
}

export function canCreateAnnouncement(user: SessionUser): boolean {
  return !!user;
}

export function canDeleteAnnouncement(user: SessionUser): boolean {
  return !!user;
}

export function canViewAllDesigns(user: SessionUser): boolean {
  return !!user;
}

export function canRequestTaskExtension(task: TaskItem, user: SessionUser): boolean {
  return !!user;
}

export function canDecideTaskExtension(user: SessionUser): boolean {
  return !!user;
}

export function canChangeTaskStatus(task: TaskItem, user: SessionUser): boolean {
  return !!user;
}

export function canManageGuestInvites(user: SessionUser): boolean {
  return !!user && user.tier === 1;
}

export function canManageBackup(user: SessionUser): boolean {
  return !!user && user.tier === 1;
}

export function canManageEmailSettings(user: SessionUser): boolean {
  return !!user && user.tier === 1;
}

/**
 * Whether an announcement's target `scope` matches a given viewer — the canonical
 * implementation (and the recipient-set builder it shares logic with) lives in
 * announcement-scope.ts so both real email dispatch (server) and this per-viewer
 * relevance check can use the exact same scope-matching rules.
 */
export { getAnnouncementScopeMatch } from './announcement-scope';

// ---------------------------------------------------------------------------
// Bookings / Invoices & Payments / Inventory
// Staff = Super User, CEO and Employee (tiers 1–3). Startups (tier 4) can book
// rooms and see/pay only their own invoices.
// ---------------------------------------------------------------------------
export function isStaffTier(user: SessionUser): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= TIER_EMPLOYEE;
}
export function canBookRoom(user: SessionUser): boolean {
  return !!user;
}
/** Rooms setup, invoices/due amounts/breakups, payment verification, billing settings. */
export function canManageBilling(user: SessionUser): boolean {
  return isStaffTier(user);
}
export function canManageRooms(user: SessionUser): boolean {
  return isStaffTier(user);
}
export function canManageInventory(user: SessionUser): boolean {
  return isStaffTier(user);
}
