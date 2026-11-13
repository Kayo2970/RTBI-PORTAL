import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { enqueueTaskEmailNotification, resolveTaskEmailRecipients } from '@/lib/task-email-queue';
import { fanOutAutoApproval, resolveCustomApprovalPanel } from '@/lib/approval-sync';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { gateTaskAction, taskEditKeys, holdEditForApproval, stampPendingCreate, isSystemTask, isPendingState } from '@/lib/approval-gate';

const PENDING_APPROVAL_MESSAGE: Record<string, string> = {
  pending_create: 'This task needs sign-off from the Centre Head, Advisor, or GG Campus Events Head before it is allotted.',
  pending_edit: 'An edit to this task needs sign-off from the Centre Head, Advisor, or GG Campus Events Head.',
};

export async function GET(request: Request) {
  try {
    await requireSession(request);
    const items = await readCollection('tasks');
    return NextResponse.json(items);
  } catch (err: any) {
    return apiError(err, 'tasks-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    // Route already branches into a pending-approval path (approvalStatus /
    // approverType computed by the client) when the actor isn't fully
    // trusted — see the fan-out block below — so the gate here is just
    // "must be a real signed-in member," not a hard canCreateTask check.
    const actor = await requireSession(request);
    const item = await request.json();
    // Chain of command: decided on the server from the stored Group Policies, not from the flags the browser sent.
    const stored = (await readCollection<any>('tasks')).find((t: any) => t.id === item.id);
    if (!stored) {
      if (!isSystemTask(item)) {
        const gate = await gateTaskAction(actor, 'CREATE');
        if (gate.requiresApproval) stampPendingCreate(item, gate, actor);
      }
    } else {
      // POST with an existing id replaces the record: it cannot decide a pending task, and content changes go through the edit gate
      const bookkeeping = ['approvalStatus', 'pendingChange', 'submittedBy', 'submittedByEmail', 'approverType', 'approverMemberId', 'approverPolicyTagId', 'approvalPolicyName', 'approverName', 'decidedBy', 'decidedAt', 'rejectionReason'];
      const keys = taskEditKeys(item).filter((k) => JSON.stringify(stored[k]) !== JSON.stringify(item[k]));
      for (const k of bookkeeping) { if (k in stored) item[k] = stored[k]; else delete item[k]; }
      if (keys.length > 0 && !isPendingState(stored.approvalStatus)) {
        const gate = await gateTaskAction(actor, 'EDIT');
        if (gate.requiresApproval) {
          const upd: Record<string, any> = {};
          for (const k of keys) upd[k] = item[k];
          holdEditForApproval(stored, upd, keys, gate, actor);
          const base = { ...stored };
          for (const k of Object.keys(item)) delete item[k];
          Object.assign(item, base, upd);
        }
      }
    }
    const updated = await mutateCollection('tasks', (current) => {
      const idx = current.findIndex((t: any) => t.id === item.id);
      if (idx >= 0) {
        const copy = [...current];
        copy[idx] = item;
        return copy;
      }
      return [item, ...current];
    });
    const created = updated.find((t: any) => t.id === item.id);

    // Route the built-in Group Policy approval gate on this task (see
    // getTaskApprovalRequirement in permissions.ts) into the Approvals
    // module, mirroring the same treatment given to Events. A
    // SPECIFIC_MEMBER/POLICY_TAG approver is resolved to its own custom
    // panel instead of the default trio, so a named faculty/advisor
    // approver actually gets notified.
    if (
      created &&
      (created.approvalStatus === 'pending_create' || created.approvalStatus === 'pending_edit')
    ) {
      try {
        const customPanel = created.approverType && created.approverType !== 'CENTER_HEAD'
          ? await resolveCustomApprovalPanel(created.approverType, created.approverMemberId, created.approverPolicyTagId)
          : undefined;
        await fanOutAutoApproval({
          entityType: 'task',
          entityId: created.id,
          entityTitle: created.title,
          eventId: created.eventId,
          requesterId: created.submittedBy || '',
          requesterName: created.submittedBy || 'A member',
          requesterEmail: created.submittedByEmail,
          message: PENDING_APPROVAL_MESSAGE[created.approvalStatus],
          customPanel,
        });
      } catch (approvalErr) {
        console.error('[tasks-api] Approval fan-out failed:', approvalErr);
      }
    }

    // Queue task email notification(s) with 10-minute quiet buffer — resolved
    // per assigneeType so committee/group tasks reach every member on them,
    // not just a single-assignee 'individual' task.
    if (created) {
      try {
        const members = await readCollection('members');
        const events = await readCollection('events');
        const recipients = resolveTaskEmailRecipients(created, members as any, events as any);

        for (const recipient of recipients) {
          await enqueueTaskEmailNotification({
            id: created.id,
            title: created.title,
            event: created.event || created.eventName,
            dueDate: created.dueDate,
            creatorName: created.creatorName || created.assignerName,
            assigneeEmail: recipient.email,
            assigneeName: recipient.name,
          });
        }
      } catch (emailErr) {
        console.error('[tasks-api] Failed to enqueue task notification:', emailErr);
      }
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'tasks-api-post', 400);
  }
}
