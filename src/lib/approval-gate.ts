/**
 * Server-side Group Policy approval gate.
 *
 * A Group Policy can grant a capability but require that the grantee's action is signed off by a designated approver
 * before it takes effect (GroupPolicy.requiresApproval). That requirement used to be evaluated ONLY in the browser
 * (permissions.ts getApprovalRequirement, from a cached copy of the policies) and the API routes simply trusted the
 * flag the browser sent — so a stale cache, another client or a direct call applied the action immediately and no
 * request ever reached the Approvals module. This module decides it where it can't be skipped: on the server, from the
 * stored policies, for the signed-in actor.
 */
import { readCollection } from './server-db';
import { getAccessLevelSettingsServer, isBaseLeadership, isHeadRole, ServerUser } from './permissions-server';

export interface GateDecision {
  /** The actor may do this at all (a built-in grant, or a policy that grants the capability). */
  allowed: boolean;
  /** …but the action must wait for the designated approver. */
  requiresApproval: boolean;
  approverType?: 'CENTER_HEAD' | 'SPECIFIC_MEMBER' | 'POLICY_TAG';
  approverMemberId?: string;
  approverPolicyTagId?: string;
  approverName?: string;
  policyName?: string;
}

const NOT_ALLOWED: GateDecision = { allowed: false, requiresApproval: false };

function policyIsActive(p: any, now: string): boolean {
  if (p.enabled === false) return false;
  if (p.expiresAt && p.expiresAt <= now) return false;
  return true;
}

/** Same matching rules as permissions.ts memberMatchesPolicy / permissions-server hasCapabilityServer. */
export function policyTargetsUser(p: any, user: ServerUser): boolean {
  if (!user) return false;
  if (user.id && p.targetMemberIds?.includes(user.id)) return true;
  if (p.targetDivisions?.length && user.division && p.targetDivisions.includes(user.division)) return true;
  if (p.targetTiers?.length && typeof user.tier === 'number' && p.targetTiers.includes(user.tier)) return true;
  if (p.targetDesignationKeyword?.trim()) {
    const kw = p.targetDesignationKeyword.trim().toLowerCase();
    if ((user.role || '').toLowerCase().includes(kw)) return true;
  }
  return false;
}

async function approverNameFor(p: any): Promise<string> {
  if (p.approverType === 'SPECIFIC_MEMBER' && p.approverMemberId) {
    const members = await readCollection<any>('members');
    return members.find((m: any) => m.id === p.approverMemberId)?.name || 'the designated approver';
  }
  if (p.approverType === 'POLICY_TAG' && p.approverPolicyTagId) {
    const policies = await readCollection<any>('groupPolicies');
    const tag = policies.find((x: any) => x.id === p.approverPolicyTagId);
    return tag ? `members tagged "${tag.name}"` : 'the designated approvers';
  }
  return 'the Centre Head or Advisor';
}

/**
 * Decide whether `user` may use any of `capabilities`, and whether that use must be approved first.
 * `builtInGranted` = the actor already holds this power through a hard-coded tier / role rule — approval then never
 * applies (it only ever gates access that comes SOLELY from a policy tag). When several policies grant the capability
 * and any one of them needs no approval, that more permissive path wins — same rule as the client.
 */
export async function evaluateCapabilityGate(user: ServerUser, capabilities: string[], builtInGranted: boolean): Promise<GateDecision> {
  if (!user) return NOT_ALLOWED;
  if (user.tier === 1 || builtInGranted) return { allowed: true, requiresApproval: false };

  const now = new Date().toISOString();
  const policies = (await readCollection<any>('groupPolicies') || []).filter(
    (p: any) => policyIsActive(p, now) && policyTargetsUser(p, user) && capabilities.some((c) => p.capabilities?.includes(c))
  );
  if (policies.length === 0) return NOT_ALLOWED;
  if (policies.some((p: any) => !p.requiresApproval)) return { allowed: true, requiresApproval: false };

  const p = policies[0];
  return {
    allowed: true,
    requiresApproval: true,
    approverType: p.approverType || 'CENTER_HEAD',
    approverMemberId: p.approverMemberId,
    approverPolicyTagId: p.approverPolicyTagId,
    approverName: await approverNameFor(p),
    policyName: p.name,
  };
}

/** A Group Policy "Module Access → Edit = All" override counts as an unconditional grant (no approval). */
export async function hasModuleEditAll(user: ServerUser, moduleKey: string): Promise<boolean> {
  if (!user) return false;
  const now = new Date().toISOString();
  const policies = await readCollection<any>('groupPolicies');
  return (policies || []).some((p: any) => policyIsActive(p, now) && policyTargetsUser(p, user) && p.moduleAccess?.[moduleKey]?.edit === 'ALL' && !p.requiresApproval);
}

export type PassAction = 'issue' | 'edit' | 'delete' | 'dispatch';

const PASS_CAPS: Record<PassAction, string[]> = {
  issue: ['MANAGE_EVENT_PASSES', 'EVENTS_EDIT'],
  edit: ['EVENT_PASSES_EDIT', 'MANAGE_EVENT_PASSES', 'EVENTS_EDIT'],
  delete: ['EVENT_PASSES_DELETE', 'MANAGE_EVENT_PASSES', 'EVENTS_EDIT'],
  dispatch: ['EVENT_PASSES_DISPATCH', 'MANAGE_EVENT_PASSES', 'EVENTS_EDIT'],
};

/** Gate for an Event Passes action. Leadership / Heads / Super User are trusted; everyone else needs a policy grant. */
export async function gateEventPassAction(user: ServerUser, action: PassAction): Promise<GateDecision> {
  if (!user) return NOT_ALLOWED;
  return evaluateCapabilityGate(user, PASS_CAPS[action], await passesBuiltInAccess(user));
}

async function passesBuiltInAccess(user: ServerUser): Promise<boolean> {
  const settings = await getAccessLevelSettingsServer();
  return user?.tier === 1 || isBaseLeadership(user, settings) || isHeadRole(user, settings) || user?.tier === 2.5 || (await hasModuleEditAll(user, 'EVENT_PASSES'));
}

export type CertificateAction = 'send' | 'design' | 'view' | 'ledger' | 'delete';

// Certificates have their own capabilities so they can be granted without the matching pass powers; anyone who already
// had the pass-dispatch / pass-edit power keeps the same certificate access they had before these existed.
const CERT_SEND_CAPS = ['CERTIFICATES_SEND', ...PASS_CAPS.dispatch];
const CERT_DESIGN_CAPS = ['CERTIFICATES_DESIGN', ...PASS_CAPS.edit];
const CERT_CAPS: Record<CertificateAction, string[]> = {
  send: CERT_SEND_CAPS,
  design: CERT_DESIGN_CAPS,
  view: [...CERT_SEND_CAPS, ...CERT_DESIGN_CAPS],
  // Read-only ledger of issued certificates: also open to the read-only guest-list grant.
  delete: ['CERTIFICATES_DELETE', ...PASS_CAPS.delete],
  ledger: [...CERT_SEND_CAPS, ...CERT_DESIGN_CAPS, 'EVENT_PASSES_VIEW'],
};

/** Gate for the attendance-certificate tools: send / preview / schedule ('send'), design + fonts ('design'), open the editor ('view'). */
export async function gateCertificateAction(user: ServerUser, action: CertificateAction): Promise<GateDecision> {
  if (!user) return NOT_ALLOWED;
  return evaluateCapabilityGate(user, CERT_CAPS[action], await passesBuiltInAccess(user));
}

/** Same rule as permissions.ts getEventApprovalRequirement, evaluated on the server. */
export async function gateEventAction(user: ServerUser, action: 'CREATE' | 'EDIT'): Promise<GateDecision> {
  if (!user) return NOT_ALLOWED;
  const settings = await getAccessLevelSettingsServer();
  const { isExecutiveRole, isCentreHead, isCoreCommitteeTier } = await import('./permissions-server');
  if (isExecutiveRole(user) && !isCentreHead(user, settings) && user.tier !== 1) {
    return { allowed: true, requiresApproval: true, approverType: 'CENTER_HEAD', approverName: 'the Centre Head or Advisor', policyName: 'Executive Event Sign-off Requirement' };
  }
  const builtIn = isBaseLeadership(user, settings) || user.tier === 2.5 || isCoreCommitteeTier(user, settings) || isHeadRole(user, settings);
  return evaluateCapabilityGate(user, [action === 'CREATE' ? 'EVENTS_CREATE' : 'EVENTS_EDIT'], builtIn);
}

/** Event fields that are approval bookkeeping or sub-records with their own workflow — never "an edit to the event". */
const EVENT_NON_EDIT_KEYS = new Set([
  'approvalStatus', 'pendingChange', 'submittedBy', 'submittedByEmail', 'approverType', 'approverMemberId', 'approverPolicyTagId',
  'approvalPolicyName', 'approverName', 'decidedBy', 'decidedAt', 'rejectionReason', 'committees',
]);
export function eventEditKeys(updates: Record<string, unknown>): string[] {
  return Object.keys(updates).filter((k) => !EVENT_NON_EDIT_KEYS.has(k));
}

// ───────────────────────────── shared helpers for Events / Tasks / Forms ─────────────────────────────

const PENDING = new Set(['pending_create', 'pending_edit', 'pending_delete']);
export function isPendingState(s: unknown): boolean { return typeof s === 'string' && PENDING.has(s); }

/**
 * A request only counts as a DECISION when the stored record is genuinely pending. Anything else that carries
 * approvalStatus "approved"/"rejected" is a client trying to self-approve (or a stale write) and is stripped.
 */
export function classifyApprovalUpdate(stored: any, updates: Record<string, any>): 'decision' | 'plain' {
  const wantsDecision = updates.approvalStatus === 'approved' || updates.approvalStatus === 'rejected';
  if (wantsDecision && stored && isPendingState(stored.approvalStatus)) return 'decision';
  if (wantsDecision) { delete updates.approvalStatus; delete updates.decidedBy; delete updates.decidedAt; }
  return 'plain';
}

/** Whether `actor` is the resolved approver for a pending record (Super User always; never the submitter). */
export async function canDecidePending(stored: any, actor: ServerUser, extraCentreHeadCheck?: (u: ServerUser) => boolean): Promise<boolean> {
  if (!actor || !stored) return false;
  if (actor.tier === 1) return true;
  if (!isPendingState(stored.approvalStatus)) return false;
  if (stored.submittedByEmail && actor.email && String(stored.submittedByEmail).toLowerCase() === String(actor.email).toLowerCase()) return false;
  if (stored.approverType === 'SPECIFIC_MEMBER') return actor.id === stored.approverMemberId;
  if (stored.approverType === 'POLICY_TAG' && stored.approverPolicyTagId) {
    const tag = (await readCollection<any>('groupPolicies')).find((p: any) => p.id === stored.approverPolicyTagId);
    return !!tag && policyTargetsUser(tag, actor);
  }
  const settings = await getAccessLevelSettingsServer();
  const { isCentreHead } = await import('./permissions-server');
  return isCentreHead(actor, settings) || !!extraCentreHeadCheck?.(actor);
}

/** Turn a direct edit into a held pending_edit: the proposed fields move into `pendingChange`, the rest of the record is untouched. */
export function holdEditForApproval(stored: any, updates: Record<string, any>, editKeys: string[], gate: GateDecision, actor: { name?: string; email?: string }) {
  const changes: Record<string, unknown> = {};
  for (const k of editKeys) { changes[k] = updates[k]; delete updates[k]; }
  updates.pendingChange = { ...(stored?.pendingChange || {}), ...changes };
  updates.approvalStatus = 'pending_edit';
  updates.approverType = gate.approverType;
  updates.approverMemberId = gate.approverMemberId;
  updates.approverPolicyTagId = gate.approverPolicyTagId;
  updates.approvalPolicyName = gate.policyName;
  updates.submittedBy = actor.name;
  updates.submittedByEmail = actor.email;
}

/** Stamp a brand-new record as pending_create with the approver info. */
export function stampPendingCreate(item: any, gate: GateDecision, actor: { name?: string; email?: string }) {
  item.approvalStatus = 'pending_create';
  item.approverType = gate.approverType;
  item.approverMemberId = gate.approverMemberId;
  item.approverPolicyTagId = gate.approverPolicyTagId;
  item.approvalPolicyName = gate.policyName;
  item.submittedBy = actor.name;
  item.submittedByEmail = actor.email;
}

/** Keys whose value differs between a stored record and a full replacement body (for POST-with-existing-id upserts). */
export function changedKeys(stored: any, incoming: Record<string, any>, ignore: Set<string>): string[] {
  return Object.keys(incoming).filter((k) => !ignore.has(k) && JSON.stringify(stored?.[k]) !== JSON.stringify(incoming[k]));
}

/** Policy-driven requirement only (no 403 when nobody granted anything: those legacy open paths are unchanged). */
async function policyOnlyGate(user: ServerUser, capabilities: string[], trusted: boolean): Promise<GateDecision> {
  const g = await evaluateCapabilityGate(user, capabilities, trusted);
  return g.allowed ? g : { allowed: true, requiresApproval: false };
}

const TASK_EDIT_KEYS = new Set([
  'title', 'event', 'eventName', 'eventId', 'eventCommitteeId', 'eventCommitteeName', 'assignee', 'assigneeId', 'assigneeEmail',
  'assigneeIds', 'assigneeType', 'dueDate', 'taskCategory', 'designCategory', 'briefDescription', 'canvaLink', 'isSocialMediaPost',
]);
export const taskEditKeys = (u: Record<string, unknown>) => Object.keys(u).filter((k) => TASK_EDIT_KEYS.has(k));
/** Tasks the app creates for itself (procurement etc.) are not "someone assigning a task". */
export const isSystemTask = (t: any) => !!(t && (t.workflowType || t.isProcurement || t.procurementId));

export async function gateTaskAction(user: ServerUser, action: 'CREATE' | 'EDIT'): Promise<GateDecision> {
  if (!user) return { allowed: true, requiresApproval: false };
  const settings = await getAccessLevelSettingsServer();
  const { isCoreCommitteeTier } = await import('./permissions-server');
  const builtIn = user.tier === 1 || isBaseLeadership(user, settings) || user.tier === 2.5 || isHeadRole(user, settings) || isCoreCommitteeTier(user, settings) || (await hasModuleEditAll(user, 'TASKS'));
  return policyOnlyGate(user, [action === 'CREATE' ? 'TASKS_CREATE' : 'TASKS_EDIT'], builtIn);
}

const FORM_EDIT_KEYS = new Set(['title', 'slug', 'description', 'headerText', 'headerImageUrl', 'headerPosX', 'headerPosY', 'headerZoom', 'headerHeight', 'backgroundImageUrl', 'backgroundBlur', 'backgroundDim', 'committee', 'fields', 'eventId', 'eventName', 'sourceTemplateId']);
export const formEditKeys = (u: Record<string, unknown>) => Object.keys(u).filter((k) => FORM_EDIT_KEYS.has(k));

/**
 * Forms are only ever created/edited/deleted from the Forms page, so the browser's rule is mirrored in full:
 * Super User / Centre Head / Finance / Design / Events heads act directly; everyone else with access — built-in or via a
 * policy — goes through sign-off. When the access comes only from an approval-required policy, that policy's approver
 * is used; otherwise the Centre Head.
 */
export async function gateFormAction(user: ServerUser, action: 'CREATE' | 'EDIT' | 'DELETE'): Promise<GateDecision> {
  if (!user) return { allowed: false, requiresApproval: false };
  const p = await import('./permissions-server');
  const settings = await getAccessLevelSettingsServer();
  const trusted = user.tier === 1 || p.isCentreHead(user, settings) || p.isFinanceHead(user, settings) || p.isDesignHead(user, settings) || p.isHeadOfEvents(user);
  if (trusted) return { allowed: true, requiresApproval: false };
  const caps = action === 'DELETE' ? ['FORMS_DELETE', 'BUILD_FORMS'] : ['BUILD_FORMS'];
  const builtInAccess = action === 'DELETE' ? await p.canDeleteForms(user, settings) || p.canCreateForms(user, settings) : p.canCreateForms(user, settings);
  const moduleAll = await hasModuleEditAll(user, 'FORMS');
  const policy = await evaluateCapabilityGate(user, caps, false);
  if (!builtInAccess && !moduleAll && !policy.allowed) return { allowed: false, requiresApproval: false };
  if (!builtInAccess && !moduleAll && policy.requiresApproval) return policy;
  return { allowed: true, requiresApproval: true, approverType: 'CENTER_HEAD', approverName: 'the Centre Head', policyName: 'Public Form Sign-off Requirement' };
}
