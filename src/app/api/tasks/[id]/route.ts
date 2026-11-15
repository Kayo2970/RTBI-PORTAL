import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { purgeRemovedAttachments, purgeAttachmentFiles } from '@/lib/cascade-delete';
import { enqueueTaskEmailNotification } from '@/lib/task-email-queue';
import { deleteStoredFilesForRecord } from '@/lib/file-storage';
import { fanOutAutoApproval, cascadeCloseAutoApprovals, deleteLinkedApprovalRequests, resolveCustomApprovalPanel } from '@/lib/approval-sync';
import { requireSession, requirePermission, ForbiddenError } from '@/lib/session';
import { canDeleteTask, getAccessLevelSettingsServer, isEventsHeadGgCampus } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { gateTaskAction, taskEditKeys, holdEditForApproval, classifyApprovalUpdate, canDecidePending } from '@/lib/approval-gate';

const PENDING_APPROVAL_MESSAGE: Record<string, string> = {
  pending_create: 'This task needs sign-off from the CEO or Administrator before it is allotted.',
  pending_edit: 'An edit to this task needs sign-off from the CEO or Administrator.',
};
const PENDING_STATES = new Set(['pending_create', 'pending_edit']);

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
    // approver (see canApprovePendingTask below) and never just any
    // signed-in member.
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    const { id } = await params;
    const updates = await request.json();

    // Chain of command: only a genuinely pending task can be decided (by its approver); a content edit by someone whose
    // access comes from an approval-required Group Policy is held as pending_edit instead of applying.
    const storedTask = (await readCollection<any>('tasks')).find((t: any) => t.id === id);
    if (classifyApprovalUpdate(storedTask, updates) === 'decision') {
      if (!(await canDecidePending(storedTask, actor, isEventsHeadGgCampus))) {
        throw new ForbiddenError('You are not authorized to decide this task — it needs sign-off from the designated approver.');
      }
    } else {
      const editKeys = taskEditKeys(updates);
      if (editKeys.length > 0 && storedTask && !PENDING_STATES.has(storedTask.approvalStatus)) {
        const gate = await gateTaskAction(actor, 'EDIT');
        if (gate.requiresApproval) holdEditForApproval(storedTask, updates, editKeys, gate, actor);
      }
    }
    // Upsert: if this id isn't in the server's collection yet (e.g. client-bundled
    // sample/seed data never POSTed), create it instead of 404ing and silently
    // dropping the edit.
    let previous: any = null;
    const updated = await mutateCollection('tasks', (current) => {
      const idx = current.findIndex((item: any) => item.id === id);
      if (idx === -1) return [...current, { id, ...updates }];
      previous = current[idx];

      const next = [...current];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });
    const result = updated.find((t: any) => t.id === id);

    // Attachments removed in this edit must also go from disk, not just from the record
    if (previous && Array.isArray(updates.attachments)) {
      await purgeRemovedAttachments(previous.attachments, updates.attachments);
    }

    if (result) {
      const wasPending = previous && PENDING_STATES.has(previous.approvalStatus);
      const isPending = PENDING_STATES.has(result.approvalStatus);

      if (isPending && (!wasPending || previous.approvalStatus !== result.approvalStatus)) {
        try {
          const customPanel = result.approverType && result.approverType !== 'CENTER_HEAD'
            ? await resolveCustomApprovalPanel(result.approverType, result.approverMemberId, result.approverPolicyTagId)
            : undefined;
          await fanOutAutoApproval({
            entityType: 'task',
            entityId: result.id,
            entityTitle: result.title,
            eventId: result.eventId,
            requesterId: result.submittedBy || '',
            requesterName: result.submittedBy || 'A member',
            requesterEmail: result.submittedByEmail,
            message: PENDING_APPROVAL_MESSAGE[result.approvalStatus],
            customPanel,
          });
        } catch (approvalErr) {
          console.error('[tasks-api] Approval fan-out failed:', approvalErr);
        }
      } else if (wasPending && (result.approvalStatus === 'approved' || result.approvalStatus === 'rejected')) {
        try {
          await cascadeCloseAutoApprovals('task', result.id, result.approvalStatus, result.decidedBy);
        } catch (approvalErr) {
          console.error('[tasks-api] Approval cascade-close failed:', approvalErr);
        }
      }
    }

    // A pending edit (e.g. a delegated task — see delegateAutoTask in
    // local-data.ts) just got approved and changed who it's assigned to —
    // let the new assignee know, mirroring the notification a brand-new
    // task gets on creation (see the tasks POST route).
    if (
      result &&
      previous?.approvalStatus === 'pending_edit' &&
      result.approvalStatus === 'approved' &&
      result.assigneeEmail &&
      result.assigneeEmail !== previous.assigneeEmail
    ) {
      try {
        await enqueueTaskEmailNotification({
          id: result.id,
          title: result.title,
          event: result.event || result.eventName,
          dueDate: result.dueDate,
          creatorName: result.creatorName || result.assignerName,
          assigneeEmail: result.assigneeEmail,
          assigneeName: result.assignee || 'Member',
        });
      } catch (emailErr) {
        console.error('[tasks-api] Failed to enqueue reassignment notification:', emailErr);
      }
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return apiError(err, 'tasks-id-api-patch', 400);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const settings = await getAccessLevelSettingsServer();
    const existing = await readCollection<any>('tasks');
    const target = existing.find((t: any) => t.id === id);
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requirePermission(canDeleteTask(actor, settings, target), 'You do not have permission to delete this task.');
    let found = false;
    let deleted: any = null;
    await mutateCollection('tasks', (current) => {
      const filtered = current.filter((t: any) => t.id !== id);
      found = filtered.length < current.length;
      if (found) deleted = current.find((t: any) => t.id === id);
      return filtered;
    });
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Attachments may sit under a temporary upload id (task_att_*) rather than the task id
    await deleteStoredFilesForRecord('tasks', id);
    await purgeAttachmentFiles(deleted?.attachments);

    // Purge any pending/tracked approval requests for this deleted task
    await deleteLinkedApprovalRequests('task', id);

    // Direct correlation check: if a task is deleted, purge any correlated ratings —
    // if there is not any task, then it makes no sense that there would be a rating for said task.
    await mutateCollection('ratings', (current) => current.filter((r: any) => r.taskId !== id));

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'tasks-id-api-delete', 500);
  }
}
