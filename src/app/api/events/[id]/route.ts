import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { gateEventAction, eventEditKeys, holdEditForApproval, classifyApprovalUpdate, canDecidePending } from '@/lib/approval-gate';
import { cascadeDeleteEvent } from '@/lib/cascade-delete';
import { fanOutAutoApproval, cascadeCloseAutoApprovals, deleteLinkedApprovalRequests, resolveCustomApprovalPanel } from '@/lib/approval-sync';
import { requireSession, requirePermission, ForbiddenError } from '@/lib/session';
import { canDeleteEvent, getAccessLevelSettingsServer, isEventsHeadGgCampus } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

const PENDING_APPROVAL_MESSAGE: Record<string, string> = {
  pending_create: 'This event was created and needs sign-off from the CEO or Administrator before it goes live.',
  pending_edit: 'An edit to this event needs sign-off from the CEO or Administrator.',
  pending_delete: 'A request to delete this event needs sign-off from the CEO or Administrator.',
};
const PENDING_STATES = new Set(['pending_create', 'pending_edit', 'pending_delete']);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Existing approval-routing logic (approvalStatus/approverType fan-out
    // below) already handles the "not fully trusted, route to pending" case,
    // so the gate here is just "must be a real signed-in member" — EXCEPT
    // for the specific transition that actually decides a pending item
    // (pending_* -> approved/rejected), which requires the real resolved
    // approver (see canApprovePendingEvent below) and never just any
    // signed-in member.
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    const { id } = await params;
    const updates = await request.json();
    delete updates.committees; // events no longer have committees

    // Chain of command. Only a record that is genuinely pending can be decided (and only by its approver); a client that
    // sends approvalStatus "approved" on a record that isn't pending is trying to skip sign-off, so that is stripped.
    const storedEvent = (await readCollection<any>('events')).find((e: any) => e.id === id);
    const kind = classifyApprovalUpdate(storedEvent, updates);
    if (kind === 'decision') {
      if (!(await canDecidePending(storedEvent, actor, isEventsHeadGgCampus))) {
        throw new ForbiddenError('You are not authorized to decide this event — it needs sign-off from the designated approver.');
      }
    } else {
      const editKeys = eventEditKeys(updates);
      if (editKeys.length > 0 && storedEvent) {
        const gate = await gateEventAction(actor, 'EDIT');
        if (!gate.allowed) {
          return NextResponse.json({ error: "You don't have permission to edit events." }, { status: 403 });
        }
        if (gate.requiresApproval && !PENDING_STATES.has(storedEvent.approvalStatus)) {
          holdEditForApproval(storedEvent, updates, editKeys, gate, actor);
        }
      }
    }
    // Upsert: if this id isn't in the server's collection yet (e.g. client-bundled
    // sample/seed data never POSTed), create it instead of 404ing and silently
    // dropping the edit.
    let previous: any = null;
    const updated = await mutateCollection('events', (current) => {
      const idx = current.findIndex((item: any) => item.id === id);
      if (idx === -1) return [...current, { id, ...updates }];
      previous = current[idx];

      const next = [...current];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });
    const result = updated.find((e: any) => e.id === id);

    if (result) {
      const wasPending = previous && PENDING_STATES.has(previous.approvalStatus);
      const isPending = PENDING_STATES.has(result.approvalStatus);

      if (isPending && (!wasPending || previous.approvalStatus !== result.approvalStatus)) {
        try {
          const customPanel = result.approverType && result.approverType !== 'CENTER_HEAD'
            ? await resolveCustomApprovalPanel(result.approverType, result.approverMemberId, result.approverPolicyTagId)
            : undefined;
          await fanOutAutoApproval({
            entityType: 'event',
            entityId: result.id,
            entityTitle: result.title,
            requesterId: result.submittedBy || '',
            requesterName: result.submittedBy || 'A member',
            requesterEmail: result.submittedByEmail,
            message: PENDING_APPROVAL_MESSAGE[result.approvalStatus],
            customPanel,
          });
        } catch (approvalErr) {
          console.error('[events-api] Approval fan-out failed:', approvalErr);
        }
      } else if (wasPending && (result.approvalStatus === 'approved' || result.approvalStatus === 'rejected')) {
        try {
          await cascadeCloseAutoApprovals('event', result.id, result.approvalStatus, result.decidedBy);
        } catch (approvalErr) {
          console.error('[events-api] Approval cascade-close failed:', approvalErr);
        }
      }
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return apiError(err, 'events-id-api-patch', 400);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    requirePermission(canDeleteEvent(actor, settings), 'You do not have permission to delete events.');
    const { id } = await params;
    let found = false;
    await mutateCollection('events', (current) => {
      const filtered = current.filter((e: any) => e.id !== id);
      found = filtered.length < current.length;
      return filtered;
    });
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await deleteLinkedApprovalRequests('event', id);
    await cascadeDeleteEvent(id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'events-id-api-delete', 500);
  }
}
