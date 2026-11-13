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
  pending_create: 'This task needs sign-off from the Centre Head, Advisor, or GG Campus Events Head before it is allotted.',
  pending_edit: 'An edit to this task needs sign-off from the Centre Head, Advisor, or GG Campus Events Head.',
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
    // An Event Report Request task can only be completed by actually uploading the report for its event
    if (updates?.status === 'Completed' && storedTask?.status !== 'Completed' && storedTask?.workflowType === 'event_report_request') {
      const reports = await readCollection<any>('eventReports');
      const uploaded = !!storedTask.eventId && reports.some((r: any) => r.eventId === storedTask.eventId && r.status !== 'rejected');
      if (!uploaded) {
        return NextResponse.json(
          { error: "Upload the event report (Event Reports module) to complete this task — it can't be marked completed any other way." },
          { status: 400 }
        );
      }
    }
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

    // Bi-directional completion: if a procurement task is marked Completed, mark the corresponding procurement request Completed
    if (result && updates.status === 'Completed' && (result.workflowType === 'procurement' || result.procurementId || result.isProcurement)) {
      const procId = result.procurementId || result.id.replace(/^task_procurement_/, '');
      try {
        await mutateCollection('procurementRequests', (current) =>
          (current || []).map((r: any) =>
            (r.id === procId || r.procurementTaskId === result.id) && r.status !== 'Completed'
              ? { ...r, status: 'Completed', completedBy: actor.name, completedAt: new Date().toISOString() }
              : r
          )
        );
      } catch (procErr) {
        console.error('[tasks-api] Failed to sync procurement request completion:', procErr);
      }
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return apiError(err, 'tasks-id-api-patch', 400);
  }
}

// Scheduler-generated workflows (see holiday-scheduler.ts / event-social-scheduler.ts)
// that recreate a deterministic-id task for an event on every boot/weekly/daily
// catch-up run as long as the event still exists and no such task is present.
const AUTO_RECREATED_WORKFLOWS = new Set([
  'holiday_social_approval',
  'holiday_design_social',
  'event_social_post',
  'event_poster_request',
  'event_report_request',
  'event_report_assignment',
  'procurement',
]);

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

    // Deleting an auto-generated task is a deliberate "no, don't ask about
    // this one" — without this, the next scheduler run sees the event still
    // there and no task for it, and recreates the exact task the user just
    // deleted (it comes back like a zombie). Flag the event and persist the
    // task id in systemSettings so schedulers never recreate it going forward.
    const isAutoTask =
      (deleted?.workflowType && AUTO_RECREATED_WORKFLOWS.has(deleted.workflowType)) ||
      id.startsWith('task_event_') ||
      id.startsWith('task_holiday_');

    // Gated strictly on isAutoTask: this bookkeeping exists only so scheduler-
    // generated tasks don't resurrect themselves. It must never fire for a
    // manually created task that merely happens to reference an eventId (e.g.
    // a Design Portal brief with a Canva link) — the boot-time cleanup below
    // purges every task whose eventId is dismissed here, so treating a manual
    // task's eventId as "dismissed" would wipe out unrelated, unsubmitted
    // design tasks for the same event on the next server restart.
    if (isAutoTask) {
      // 1. Record in systemSettings.dismissedAutoTaskIds
      await mutateCollection<any>('systemSettings', (current) => {
        const currentSettings = current[0] || { id: 'default', lockdownEnabled: false };
        const dismissed = new Set<string>(currentSettings.dismissedAutoTaskIds || []);
        dismissed.add(id);
        if (deleted?.eventId) {
          dismissed.add(deleted.eventId);
          if (deleted?.workflowType) {
            dismissed.add(`${deleted.workflowType}_${deleted.eventId}`);
          }
        }
        return [{ ...currentSettings, dismissedAutoTaskIds: Array.from(dismissed) }];
      });

      // 2. Mark event as dismissed
      if (deleted?.eventId || deleted?.event) {
        await mutateCollection<any>('events', (current) => {
          return current.map((e: any) => {
            const match =
              (deleted?.eventId && (e.id === deleted.eventId || e.id.includes(deleted.eventId) || deleted.eventId.includes(e.id))) ||
              (deleted?.event && e.title?.toLowerCase() === deleted.event.toLowerCase());
            if (!match) return e;
            const dismissedTypes = new Set(e.dismissedAutoTaskTypes || []);
            if (deleted?.workflowType) dismissedTypes.add(deleted.workflowType);
            const isPoster = deleted?.workflowType === 'event_poster_request' || id.startsWith('task_event_poster_');
            const isSocial =
              deleted?.workflowType === 'event_social_post' ||
              deleted?.workflowType === 'holiday_social_approval' ||
              deleted?.workflowType === 'holiday_design_social' ||
              id.startsWith('task_event_social_') ||
              id.startsWith('task_holiday_');
            return {
              ...e,
              posterTaskDismissed: isPoster ? true : e.posterTaskDismissed,
              socialTaskDismissed: isSocial ? true : e.socialTaskDismissed,
              dismissedAutoTaskTypes: Array.from(dismissedTypes),
            };
          });
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'tasks-id-api-delete', 500);
  }
}
