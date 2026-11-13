import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { isTaskAssignee } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

/**
 * Records `actor`'s own acknowledgment against every requested task id
 * they are actually allotted to — never anyone else's. isTaskAssignee
 * (unlike canChangeTaskStatus) grants no leadership override, so a Centre
 * Head/Head of Events/Super User acting on this same route only ever
 * acknowledges a task they are themselves assigned to, same as any other
 * member. For a 'group'/'committee' task, each assignee calling this
 * independently only ever appends their own id to acknowledgedByIds —
 * one member acknowledging never marks it acknowledged for the others.
 * A requested id the actor isn't allotted to is silently skipped rather
 * than failing the whole batch, so a stale/shared email link never lets
 * one recipient acknowledge a task meant for someone else on the same
 * digest.
 */
async function acknowledgeTasksForActor(
  taskIds: string[],
  actor: { id?: string; name?: string; email?: string }
): Promise<any[]> {
  const now = new Date().toISOString();
  const idSet = new Set(taskIds);
  const existingTasks = await readCollection<any>('tasks');

  // mutateCollection's mutator must be synchronous, but isTaskAssignee's
  // committee branch needs an async events lookup — resolve the allow-set
  // first, then apply it inside the synchronous mutator.
  const allowedIds = new Set<string>();
  for (const task of existingTasks) {
    if (
      idSet.has(task.id) &&
      task.approvalStatus !== 'pending_create' &&
      task.approvalStatus !== 'pending_edit' &&
      task.approvalStatus !== 'rejected' &&
      (await isTaskAssignee(task, actor))
    ) {
      allowedIds.add(task.id);
    }
  }

  const updatedTasks: any[] = [];
  await mutateCollection('tasks', (current: any[]) => {
    return current.map(task => {
      if (!allowedIds.has(task.id)) return task;
      const acknowledgedByIds = Array.from(
        new Set([...(task.acknowledgedByIds || []), actor.id].filter(Boolean))
      );
      const updated = {
        ...task,
        acknowledgedByIds,
        acknowledged: true,
        acknowledgedAt: task.acknowledgedAt || now,
        acknowledgedByEmail: task.acknowledgedByEmail || actor.email,
        // The shared status only ever advances on the very first
        // acknowledgment — later assignees on the same group/committee
        // task acknowledging for themselves shouldn't revert or otherwise
        // disturb whatever the task has already moved on to.
        status: task.status === 'Assigned' ? 'In Progress' : task.status,
      };
      updatedTasks.push(updated);
      return updated;
    });
  });

  return updatedTasks;
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const { taskIds } = await request.json();

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return NextResponse.json({ error: 'taskIds array is required.' }, { status: 400 });
    }

    const updatedTasks = await acknowledgeTasksForActor(
      taskIds.map((id: unknown) => String(id).trim()),
      actor
    );

    return NextResponse.json({
      message: `Successfully acknowledged ${updatedTasks.length} task(s).`,
      acknowledgedCount: updatedTasks.length,
      tasks: updatedTasks,
    });
  } catch (err: any) {
    return apiError(err, 'tasks-ack-api-post', 500);
  }
}

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const { searchParams } = new URL(request.url);
    const ack = searchParams.get('ack') || searchParams.get('id');

    if (!ack) {
      return NextResponse.json({ error: 'No task IDs provided in ack query parameter.' }, { status: 400 });
    }

    const taskIds = ack.split(',').map(id => id.trim()).filter(Boolean);
    const updatedTasks = await acknowledgeTasksForActor(taskIds, actor);

    return NextResponse.json({
      message: `Successfully acknowledged ${updatedTasks.length} task(s).`,
      acknowledgedCount: updatedTasks.length,
      tasks: updatedTasks,
    });
  } catch (err: any) {
    return apiError(err, 'tasks-ack-api-get', 500);
  }
}
