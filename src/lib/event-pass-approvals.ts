/**
 * Event Pass actions that need sign-off (Group Policy "requires approval"): submit the request into the Approvals
 * module, and carry the action out — or discard it — when the approver decides.
 */
import { mutateCollection, readCollection } from './server-db';
import { fanOutAutoApproval, cascadeCloseAutoApprovals, resolveCustomApprovalPanel } from './approval-sync';
import { purgeEventPassArtifacts } from './cascade-delete';
import type { GateDecision } from './approval-gate';
import type { ApprovalRequest, EventPassItem } from './local-data';

export const PASS_SYSTEM_KEYS = new Set([
  // check-in / tracking / wallet bookkeeping: written by the scanner, the email pipeline and the wallet code, never "edits"
  'status', 'attendance', 'checkedInAt', 'checkedInBy', 'emailStatus', 'emailSentAt', 'emailReceivedAt', 'passViewed',
  'passViewedAt', 'lastPassViewedAt', 'passViewCount', 'archivedAt', 'walletAppleUrl', 'walletGoogleSaveUrl',
  'walletSerialNumber', 'walletInstalledAt', 'walletSyncedAt', 'walletLastError', 'walletStale',
  // approval bookkeeping
  'approvalStatus', 'pendingChanges', 'submittedBy', 'submittedByEmail', 'approvalPolicyName', 'approverName', 'qrPayload',
]);

const ACTION_LABEL: Record<string, string> = {
  issue: 'Issue event pass',
  edit: 'Edit event pass',
  delete: 'Delete event pass',
  dispatch: 'Email event pass',
  reissue: 'Re-issue wallet pass',
};

/** Puts one pass action into the Approvals inbox of the designated approver(s). Idempotent per (pass, action). */
export async function submitPassApproval(opts: {
  action: 'issue' | 'edit' | 'delete' | 'dispatch' | 'reissue';
  pass: Pick<EventPassItem, 'id' | 'serialNumber' | 'attendeeName' | 'eventName' | 'eventId'>;
  actor: { id?: string; name?: string; email?: string };
  gate: GateDecision;
  message: string;
  payload?: Record<string, unknown>;
  /** Several dispatch requests for one pass are separate; others are one-at-a-time per pass. */
  uniqueSuffix?: string;
}): Promise<void> {
  const customPanel =
    opts.gate.approverType && opts.gate.approverType !== 'CENTER_HEAD'
      ? await resolveCustomApprovalPanel(opts.gate.approverType, opts.gate.approverMemberId, opts.gate.approverPolicyTagId)
      : undefined;
  await fanOutAutoApproval({
    entityType: 'event-pass',
    entityId: `${opts.pass.id}::${opts.action}${opts.uniqueSuffix ? `::${opts.uniqueSuffix}` : ''}`,
    entityTitle: `${ACTION_LABEL[opts.action]} — ${opts.pass.attendeeName} (${opts.pass.eventName})`,
    eventId: opts.pass.eventId,
    requesterId: opts.actor.id || '',
    requesterName: opts.actor.name || 'A member',
    requesterEmail: opts.actor.email,
    message: opts.message,
    customPanel,
    extra: { action: opts.action, payload: { passId: opts.pass.id, serial: opts.pass.serialNumber, ...(opts.payload || {}) } },
  });
}

/** Marks the pass with the pending state + who it is waiting on. */
export async function markPassPending(passId: string, state: 'pending_create' | 'pending_edit' | 'pending_delete', actor: { name?: string; email?: string }, gate: GateDecision, pendingChanges?: Record<string, unknown>): Promise<EventPassItem | null> {
  let out: EventPassItem | null = null;
  await mutateCollection<EventPassItem>('event_passes', (current = []) => {
    const idx = current.findIndex((p) => p.id === passId);
    if (idx === -1) return current;
    const copy = [...current];
    copy[idx] = {
      ...copy[idx],
      approvalStatus: state,
      ...(pendingChanges ? { pendingChanges: { ...(copy[idx].pendingChanges || {}), ...pendingChanges } } : {}),
      submittedBy: actor.name,
      submittedByEmail: actor.email,
      approvalPolicyName: gate.policyName,
      approverName: gate.approverName,
    };
    out = copy[idx];
    return copy;
  });
  return out;
}

function clearPending(p: EventPassItem): EventPassItem {
  const { approvalStatus: _a, pendingChanges: _c, submittedBy: _s, submittedByEmail: _e, approvalPolicyName: _p, approverName: _n, ...rest } = p;
  return rest as EventPassItem;
}

/** Carry out (or discard) a decided event-pass request. Called by PATCH /api/approval-requests/[id]. */
export async function applyPassDecision(
  row: ApprovalRequest,
  decision: 'approved' | 'rejected',
  decidedByName: string,
  origin: string
): Promise<void> {
  const action = row.action;
  const passId = String((row.payload as any)?.passId || String(row.entityId).split('::')[0]);
  const passes = await readCollection<EventPassItem>('event_passes');
  const pass = passes.find((p) => p.id === passId);

  if (action === 'issue') {
    if (!pass) return;
    if (decision === 'approved') {
      await mutateCollection<EventPassItem>('event_passes', (cur = []) => cur.map((p) => (p.id === passId ? clearPending(p) : p)));
    } else {
      await mutateCollection<EventPassItem>('event_passes', (cur = []) => cur.filter((p) => p.id !== passId));
      await purgeEventPassArtifacts(pass);
    }
  } else if (action === 'edit' || action === 'reissue') {
    if (!pass) return;
    if (decision === 'approved') {
      const changes = (pass.pendingChanges || {}) as Record<string, unknown>;
      await mutateCollection<EventPassItem>('event_passes', (cur = []) =>
        cur.map((p) => {
          if (p.id !== passId) return p;
          const merged = { ...p, ...changes } as EventPassItem;
          for (const [k, v] of Object.entries(changes)) if (v === null) delete (merged as any)[k];
          return clearPending(merged);
        })
      );
      try {
        const { syncEditedWalletPass, reissueWalletPass } = await import('./wallet/pass-cache');
        if (action === 'reissue') await reissueWalletPass(passId, origin);
        else await syncEditedWalletPass(passId, origin);
      } catch (err) {
        console.warn('[event-pass-approvals] wallet sync after approved edit failed:', (err as Error)?.message);
      }
    } else {
      await mutateCollection<EventPassItem>('event_passes', (cur = []) => cur.map((p) => (p.id === passId ? clearPending(p) : p)));
    }
  } else if (action === 'delete') {
    if (!pass) return;
    if (decision === 'approved') {
      await mutateCollection<EventPassItem>('event_passes', (cur = []) => cur.filter((p) => p.id !== passId));
      await purgeEventPassArtifacts(pass);
    } else {
      await mutateCollection<EventPassItem>('event_passes', (cur = []) => cur.map((p) => (p.id === passId ? clearPending(p) : p)));
    }
  } else if (action === 'dispatch') {
    if (decision === 'approved') {
      const { sendPassEmailFromPayload } = await import('./pass-email-send');
      await sendPassEmailFromPayload((row.payload as any)?.email, origin);
    }
  }

  // Whichever approver acted first resolves the sibling rows for the same action
  await cascadeCloseAutoApprovals('event-pass', row.entityId, decision, decidedByName);
}
