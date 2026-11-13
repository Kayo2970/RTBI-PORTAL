/**
 * permissions-server.ts — Server-side authorization checks for API routes.
 *
 * Mirrors src/lib/permissions.ts against the real server-side collections.
 * Tiers: 1 = Super User, 2 = CEO, 3 = Employee, 4 = Startup. Phase 1 is
 * blanket module access for every signed-in member; only account
 * administration is restricted to the Super User (see permissions.ts).
 * Group Policy grants are resolved per request (resolvePolicyGrants) and
 * attached to the member by session.ts, ready for the later scope work.
 */
import { readCollection } from './server-db';

// Below this point: additive ports of specific composite `can*` checks from
// permissions.ts (client) needed to gate the Events/Tasks/Ratings API routes.
// Same disclosed limitation as the rest of this file — Group Policy
// capability/moduleAccess overrides are NOT consulted here, only the
// hardcoded tier/role/keyword rule each function mirrors.

export interface AccessLevelSettings {
  headKeyword: string;
  sectorHeadKeywords: string;
  sectorHeadMaxTier: number;
  financeKeyword: string;
  baseLeadershipMaxTier: number;
  coreCommitteeTier: number;
}

const DEFAULT_ACCESS_LEVEL_SETTINGS: AccessLevelSettings = {
  headKeyword: 'head',
  sectorHeadKeywords: 'ceo,director,head,lead',
  sectorHeadMaxTier: 2,
  financeKeyword: 'finance',
  baseLeadershipMaxTier: 3,
  coreCommitteeTier: 5,
};




export async function getAccessLevelSettingsServer(): Promise<AccessLevelSettings> {
  const rows = await readCollection<any>('accessLevelSettings');
  const stored = rows?.[0];
  return stored ? { ...DEFAULT_ACCESS_LEVEL_SETTINGS, ...stored } : DEFAULT_ACCESS_LEVEL_SETTINGS;
}

export type ServerUser = { id?: string; tier?: number; role?: string; division?: string; department?: string; email?: string; name?: string } | null | undefined;

/** Same matching rules as permissions.ts memberMatchesPolicy, against a plain member/user record. */
function policyTargetsUser(p: any, user: NonNullable<ServerUser>): boolean {
  if (user.id && p.targetMemberIds?.includes(user.id)) return true;
  if (p.targetDivisions?.length && user.division && p.targetDivisions.includes(user.division)) return true;
  if (p.targetTiers?.length && typeof user.tier === 'number' && p.targetTiers.includes(user.tier)) return true;
  if (p.targetDesignationKeyword?.trim()) {
    const kw = p.targetDesignationKeyword.trim().toLowerCase();
    if ((user.role || '').toLowerCase().includes(kw)) return true;
  }
  return false;
}

export interface PolicyGrants {
  capabilities: string[];
  /** Per module key, the strongest Edit override from matching policies (ALL > OWN > NONE), like permissions.ts's resolveModuleEditOverride. */
  moduleEdit: Record<string, 'ALL' | 'OWN' | 'NONE'>;
}

/**
 * Resolve everything the member's enabled, unexpired Group Policies grant, once per request. session.ts attaches the
 * result to the signed-in member (non-enumerable, so it is never persisted or sent back), which lets every synchronous
 * can*() check below consult Group Policies exactly like the client's permissions.ts does.
 */
export async function resolvePolicyGrants(user: ServerUser): Promise<PolicyGrants> {
  const grants: PolicyGrants = { capabilities: [], moduleEdit: {} };
  if (!user || user.tier === 1) return grants; // Super User holds everything implicitly
  const policies = await readCollection<any>('groupPolicies');
  const now = new Date().toISOString();
  const caps = new Set<string>();
  const rank = { NONE: 0, OWN: 1, ALL: 2 } as const;
  for (const p of policies || []) {
    if (p.enabled === false) continue;
    if (p.expiresAt && p.expiresAt <= now) continue;
    if (!policyTargetsUser(p, user)) continue;
    (p.capabilities || []).forEach((c: string) => caps.add(c));
    for (const [moduleKey, access] of Object.entries<any>(p.moduleAccess || {})) {
      const edit = access?.edit as 'ALL' | 'OWN' | 'NONE' | undefined;
      if (!edit) continue;
      const current = grants.moduleEdit[moduleKey];
      if (!current || rank[edit] > rank[current]) grants.moduleEdit[moduleKey] = edit;
    }
  }
  grants.capabilities = Array.from(caps);
  return grants;
}

/** Synchronous capability check against the grants session.ts attached to the signed-in member. Super User always true. */
export function hasCap(user: ServerUser, capability: string): boolean {
  if (!user) return false;
  if (user.tier === 1) return true;
  return !!(user as any).__policyGrants?.capabilities?.includes(capability);
}

/** Explicit Edit override a Group Policy sets for `moduleKey` (undefined when none). Super User is always 'ALL'. */
export function moduleEditOverride(user: ServerUser, moduleKey: string): 'ALL' | 'OWN' | 'NONE' | undefined {
  if (!user) return undefined;
  if (user.tier === 1) return 'ALL';
  return (user as any).__policyGrants?.moduleEdit?.[moduleKey];
}

/**
 * Server-side port of permissions.ts's hasCapability/isPolicyActive/
 * memberMatchesPolicy — the "deliberate, disclosed limitation" this file's
 * header calls out (Group Policy capability grants weren't consulted by any
 * server route). Only wired into the small set of routes below that
 * actually need a specific capability to be enforceable end-to-end (a
 * client-visible grant that always 403s server-side is worse than no grant
 * at all); everywhere else in the app, a capability grant remains a
 * client-side-only UI gate exactly as it always has been — this function
 * does not change that for anything it isn't explicitly called from.
 */
export async function hasCapabilityServer(user: ServerUser, capability: string): Promise<boolean> {
  if (!user) return false;
  if (user.tier === 1) return true;
  if ((user as any).__policyGrants) return hasCap(user, capability);
  const policies = await readCollection<any>('groupPolicies');
  const now = new Date().toISOString();
  return (policies || []).some((p: any) => {
    if (p.enabled === false) return false;
    if (p.expiresAt && p.expiresAt <= now) return false;
    if (!p.capabilities?.includes(capability)) return false;
    if (user.id && p.targetMemberIds?.includes(user.id)) return true;
    if (p.targetDivisions?.length && user.division && p.targetDivisions.includes(user.division)) return true;
    if (p.targetTiers?.length && typeof user.tier === 'number' && p.targetTiers.includes(user.tier)) return true;
    if (p.targetDesignationKeyword?.trim()) {
      const kw = p.targetDesignationKeyword.trim().toLowerCase();
      if ((user.role || '').toLowerCase().includes(kw)) return true;
    }
    return false;
  });
}

export function isExecutiveRole(user: ServerUser): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isAlumniRole(user: ServerUser): boolean {
  return false;
}

export function isHeadRole(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isBaseLeadership(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isCoreCommitteeTier(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isSectorHead(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isFinanceHead(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isChiefAdvisor(user: ServerUser): boolean {
  return false;
}

export function isCentreHead(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 2;
}

export function isEventsHeadGgCampus(user: ServerUser): boolean {
  return false;
}

export function isDesignHead(user: ServerUser, settings: AccessLevelSettings): boolean {
  return false;
}

/** Load the resolved server-side permission context once per request. */
export async function loadPermissionContext() {
  const settings = await getAccessLevelSettingsServer();
  return { settings };
}

// --- Composite checks mirroring permissions.ts's built-in (non-policy) rules ---

export function canTerminateMember(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user && user.tier === 1;
}

export function canSetMemberPassword(user: ServerUser): boolean {
  return !!user && user.tier === 1;
}

export function canEditDirectory(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canAddMember(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user && user.tier === 1;
}

export function canApproveAsSectorHead(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canVerifyReimbursementCentreHead(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canApproveAsFinanceHead(user: ServerUser, settings: AccessLevelSettings, claim?: any): boolean {
  return !!user;
}

export function canVerifyBudgetCentreHead(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canDecideBudget(user: ServerUser, settings: AccessLevelSettings, budget?: any): boolean {
  return !!user;
}

export function canSubmitBudget(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canDecideProcurementRequest(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canViewProcurementRequest(user: ServerUser, settings: AccessLevelSettings, request: any): boolean {
  return !!user;
}

export function canApproveAnnouncement(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canRemoveGuestContact(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export async function canDeleteForms(user: ServerUser, settings: AccessLevelSettings): Promise<boolean> {
  return !!user;
}

export function canDeleteEvent(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canDeleteTask(user: ServerUser, settings: AccessLevelSettings, task?: any): boolean {
  return !!user;
}

export function canManageBackup(user: ServerUser): boolean {
  return !!user && user.tier === 1;
}

export function canManageEmailSettings(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user && user.tier === 1;
}

export function canManageGuestInvites(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user && user.tier === 1;
}

export function isChiefCoordinator(user: ServerUser): boolean {
  return false;
}

export function isGeneralSecretary(user: ServerUser): boolean {
  return false;
}

export function canSubmitEventReport(user: ServerUser): boolean {
  return !!user;
}

export function canReviewEventReports(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canScoreEventReports(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canViewEventReports(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canReviewDesignProofread(user: ServerUser, settings: AccessLevelSettings, design?: { assignedProofreaderIds?: string[]; assignedProofreaderEmail?: string; assignedProofreaderId?: string }): boolean {
  return !!user;
}

export function isSuperUser(user: ServerUser): boolean {
  return !!user && user.tier === 1;
}

export function isAdvisor(user: ServerUser): boolean {
  return false;
}

export function canAccessGroupPoliciesServer(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user && user.tier === 1;
}

// --- Events / Tasks / Ratings composite checks (ported from permissions.ts) ---

export type ServerTask = {
  id?: string;
  title?: string;
  assigneeType?: string;
  assignee?: string;
  assigneeEmail?: string;
  assigneeId?: string;
  assigneeIds?: string[];
  eventId?: string;
  eventCommitteeId?: string;
  creatorName?: string;
  approvalStatus?: string;
  approverType?: string;
  approverMemberId?: string;
  submittedByEmail?: string;
  workflowType?: string;
  taskCategory?: string;
  isSocialMediaPost?: boolean;
  platform?: string;
} | null | undefined;

export type ServerEvent = {
  id?: string;
  approvalStatus?: string;
  approverType?: string;
  approverMemberId?: string;
  submittedByEmail?: string;
} | null | undefined;

export type ServerRating = {
  id?: string;
  raterName?: string;
} | null | undefined;

export function isHeadOfEvents(user: ServerUser): boolean {
  return false;
}

export function isEventsHeadRtcCampus(user: ServerUser): boolean {
  return false;
}

/**
 * Whether `user` is the assignee of `task` — the individual assignee (by id,
 * email, or name), a member of the assigned group (`assigneeIds`), or, for a
 * committee-assigned task, a member/lead of the matching event committee.
 * Ported from local-data.ts's isTaskAssignee; the committee branch needs the
 * events collection, which is why this is async (the client version reads it
 * synchronously off localStorage via getEvents()).
 */
export async function isTaskAssignee(task: ServerTask, user: ServerUser): Promise<boolean> {
  if (!task || !user) return false;
  const memberId = user.id;

  if (task.assigneeType === 'committee') {
    if (!memberId) return false;
    const events = await readCollection<any>('events');
    const targetEvents = task.eventId ? events.filter((e: any) => e.id === task.eventId) : events;
    return targetEvents.some((e: any) =>
      (e.committees || []).some((c: any) =>
        (c.id === task.eventCommitteeId || (c.name || '').toLowerCase() === (task.assignee || '').toLowerCase()) &&
        ((c.memberIds || []).includes(memberId) || c.leadMemberId === memberId)
      )
    );
  }

  return Boolean(
    (task.assignee && user.name && task.assignee.toLowerCase() === user.name.toLowerCase()) ||
    (task.assigneeEmail && user.email && task.assigneeEmail.toLowerCase() === user.email.toLowerCase()) ||
    (task.assigneeId && task.assigneeId === memberId) ||
    (memberId && task.assigneeIds && task.assigneeIds.includes(memberId))
  );
}

export function canCreateEvent(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canEditEvent(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canCreateTask(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canEditTask(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export async function canChangeTaskStatus(task: ServerTask, user: ServerUser, settings: AccessLevelSettings): Promise<boolean> {
  return !!user;
}

export function canApprovePendingEvent(event: ServerEvent, user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canApprovePendingTask(task: ServerTask, user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export async function canEvaluateEventStudent(user: ServerUser, settings: AccessLevelSettings): Promise<boolean> {
  return !!user;
}

/**
 * Checks whether a task is eligible for ratings & evaluation on the server.
 * Procurement tasks and administrative approval requests are strictly excluded.
 */
export function isTaskRatable(task: { workflowType?: string; isProcurement?: boolean; procurementId?: string; title?: string } | null | undefined): boolean {
  if (!task) return false;
  if (task.workflowType === 'holiday_social_approval' || task.workflowType === 'procurement' || task.isProcurement || task.procurementId) return false;
  if (typeof task.title === 'string' && /procure items|procurement/i.test(task.title)) return false;
  return true;
}

export function canEditRating(rating: ServerRating, user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

// --- Designs / Forms / Announcements / Guests / Event Reports (ported from
// permissions.ts's built-in tier/role clauses; Group Policy capability and
// moduleAccess override clauses are intentionally NOT ported here, per this
// file's header). ---

export function isFaculty(user: ServerUser): boolean {
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

export function canViewAllDesigns(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canBuildForms(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function isTrainingAssociate(user: ServerUser): boolean {
  return false;
}

export function canCreateForms(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function seesOnlyOwnForms(user: ServerUser, settings: AccessLevelSettings): boolean {
  return false;
}

export function isOwnForm(form: { createdById?: string; submittedByEmail?: string }, user: ServerUser): boolean {
  if (!user) return false;
  if (form.createdById) return form.createdById === user.id;
  return !!form.submittedByEmail && !!user.email && form.submittedByEmail.toLowerCase() === user.email.toLowerCase();
}

export function canCreateAnnouncement(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export function canAccessGuestDirectory(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export type ServerGuest = { createdBy?: string; metBy?: string } | null | undefined;

/**
 * Whether `guest` was created/met by `user` themselves. Ported from
 * permissions.ts's isOwnCreatedGuest.
 */
export function isOwnCreatedGuest(guest: ServerGuest, user: ServerUser): boolean {
  if (!user || !guest) return false;
  const userEmail = (user.email || '').trim().toLowerCase();
  const userName = (user.name || '').trim().toLowerCase();
  const userId = (user.id || '').trim().toLowerCase();

  const createdBy = (guest.createdBy || '').trim().toLowerCase();
  const metBy = (guest.metBy || '').trim().toLowerCase();

  if (createdBy && (createdBy === userEmail || createdBy === userId || createdBy === userName)) return true;
  if (metBy && metBy === userName) return true;
  return false;
}

export function canEditGuestRecord(guest: ServerGuest, user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

export const canViewGuestRecord = canEditGuestRecord;

export function canApproveProposal(user: ServerUser, settings: AccessLevelSettings): boolean {
  return !!user;
}

// Bookings / Invoices & Payments / Inventory — mirrors permissions.ts.
export function isStaffTier(user: ServerUser): boolean {
  return !!user && typeof user.tier === 'number' && user.tier <= 3;
}
export const canManageBilling = isStaffTier;
export const canManageRooms = isStaffTier;
export const canManageInventory = isStaffTier;
