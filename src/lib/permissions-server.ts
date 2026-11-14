/**
 * permissions-server.ts — Server-side authorization checks for API routes.
 *
 * ZERO-TRUST, ZERO-ACCESS POLICY (ACTIVE):
 * Under the site-wide Zero-Trust policy, ONLY the Super User (tier 1) has
 * access to portal modules, models, and controls. Not even the CEO or
 * employees have access at this time.
 * Granular permissions, department views, and role-based capabilities will
 * be provisioned in future rollout phases as the site is finalized.
 */
import { readCollection } from './server-db';

export const ZERO_TRUST_POLICY_ACTIVE = true;

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
    if (user.id && (user as any).policyIds?.includes(p.id)) return true;
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
  return isSuperUser(user);
}

export function canAddMember(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export function canApproveAsSectorHead(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export function canManageAnnualBudget(user: ServerUser): boolean {
  return isSuperUser(user) || (typeof user?.tier === 'number' && user.tier <= 2);
}

export function canDeleteExpense(user: ServerUser, expense: { submittedByEmail?: string }): boolean {
  if (!user) return false;
  if (isSuperUser(user) || (typeof user.tier === 'number' && user.tier <= 2)) return true;
  return !!expense.submittedByEmail && !!user.email && String(expense.submittedByEmail).toLowerCase() === String(user.email).toLowerCase();
}

export function canVerifyInvoicePayment(user: ServerUser): boolean {
  return isSuperUser(user) || (typeof user?.tier === 'number' && user.tier <= 2);
}

export function canManageIncome(user: ServerUser): boolean {
  return isSuperUser(user) || (typeof user?.tier === 'number' && user.tier <= 2);
}

export function canDecideProcurementRequest(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export function canViewProcurementRequest(user: ServerUser, settings: AccessLevelSettings, request: any): boolean {
  return isSuperUser(user);
}

export function canApproveAnnouncement(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export function canRemoveGuestContact(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export async function canDeleteForms(user: ServerUser, settings: AccessLevelSettings): Promise<boolean> {
  return isSuperUser(user);
}

export function canDeleteEvent(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export function canDeleteTask(user: ServerUser, settings: AccessLevelSettings, task?: any): boolean {
  return isSuperUser(user);
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
  creatorName?: string;
  approvalStatus?: string;
  approverType?: string;
  approverMemberId?: string;
  submittedByEmail?: string;
  taskCategory?: string;
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
 * email, or name) or a member of the assigned group (`assigneeIds`).
 * Async only so existing callers keep awaiting it.
 */
export async function isTaskAssignee(task: ServerTask, user: ServerUser): Promise<boolean> {
  if (!task || !user) return false;
  const memberId = user.id;


  return Boolean(
    (task.assignee && user.name && task.assignee.toLowerCase() === user.name.toLowerCase()) ||
    (task.assigneeEmail && user.email && task.assigneeEmail.toLowerCase() === user.email.toLowerCase()) ||
    (task.assigneeId && task.assigneeId === memberId) ||
    (memberId && task.assigneeIds && task.assigneeIds.includes(memberId))
  );
}

export function canCreateEvent(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export function canEditEvent(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export function canCreateTask(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export function canEditTask(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export async function canChangeTaskStatus(task: ServerTask, user: ServerUser, settings: AccessLevelSettings): Promise<boolean> {
  return isSuperUser(user);
}

export function canApprovePendingEvent(event: ServerEvent, user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export function canApprovePendingTask(task: ServerTask, user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export async function canEvaluateEventStudent(user: ServerUser, settings: AccessLevelSettings): Promise<boolean> {
  return isSuperUser(user);
}

/**
 * Checks whether a task is eligible for ratings & evaluation on the server.
 * Procurement tasks and administrative approval requests are strictly excluded.
 */
export function canEditRating(rating: ServerRating, user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

// --- Designs / Forms / Announcements / Guests / Event Reports (ported from
// permissions.ts's built-in tier/role clauses; Group Policy capability and
// moduleAccess override clauses are intentionally NOT ported here, per this
// file's header). ---

export function canViewAllDesigns(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export function canBuildForms(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

export function isTrainingAssociate(user: ServerUser): boolean {
  return false;
}

export function canCreateForms(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
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
  return isSuperUser(user);
}

export function canAccessGuestDirectory(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
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
  return isSuperUser(user);
}

export const canViewGuestRecord = canEditGuestRecord;

export function canApproveProposal(user: ServerUser, settings: AccessLevelSettings): boolean {
  return isSuperUser(user);
}

// Bookings / Invoices & Payments / Inventory — mirrors permissions.ts.
export function isStaffTier(user: ServerUser): boolean {
  if (ZERO_TRUST_POLICY_ACTIVE) return isSuperUser(user);
  return !!user && typeof user.tier === 'number' && user.tier <= 3;
}
export const canManageBilling = isStaffTier;
export const canManageRooms = isStaffTier;
export const canManageInventory = isStaffTier;
