import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canEvaluateEventStudent, getAccessLevelSettingsServer, isFaculty, isSocialMediaTeamMember, isSocialMediaPostTask, isTaskRatable } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

export async function GET(request: Request) {
  try {
    await requireSession(request);
    const [items, tasks] = await Promise.all([
      readCollection<any>('ratings'),
      readCollection<any>('tasks'),
    ]);
    const validTaskIds = new Set(tasks.map((t: any) => t.id));
    // Direct correlation check: only return ratings correlated to an existing task
    const correlated = items.filter((r: any) => r.taskId && validTaskIds.has(r.taskId));
    return NextResponse.json(correlated);
  } catch (err: any) {
    return apiError(err, 'ratings-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    requirePermission(await canEvaluateEventStudent(actor, settings), 'You do not have permission to submit ratings.');
    const item = await request.json();

    // Direct correlation check: every rating MUST correlate directly to an existing task
    if (!item.taskId || typeof item.taskId !== 'string' || !item.taskId.trim()) {
      return NextResponse.json({ error: 'Direct correlation check failed: a rating must directly correlate to an existing task.' }, { status: 400 });
    }
    const tasks = await readCollection<any>('tasks');
    const task = tasks.find((t: any) => t.id === item.taskId);
    if (!task) {
      return NextResponse.json({ error: 'Direct correlation check failed: no corresponding task found for this rating.' }, { status: 400 });
    }

    if (!isTaskRatable(task)) {
      return NextResponse.json({ error: 'Procurement tasks are administrative operations and are not subject to performance ratings or review.' }, { status: 400 });
    }

    const members = await readCollection<any>('members');
    const targetMember = members.find((m: any) => m.id === item.targetId || (m.name && m.name.toLowerCase() === (item.targetName || '').toLowerCase()));
    if ((targetMember && isFaculty(targetMember)) || /prof\.|professor|faculty/i.test(item.targetName || '')) {
      return NextResponse.json({ error: 'Professors and faculty members cannot receive performance ratings.' }, { status: 400 });
    }

    if (isSocialMediaPostTask(task)) {
      if (!targetMember || !isSocialMediaTeamMember(targetMember)) {
        return NextResponse.json({ error: 'Only student members of the Social Media team can be evaluated for social media posts.' }, { status: 400 });
      }
    }

    const updated = await mutateCollection('ratings', (current) => [item, ...current]);
    const created = updated.find((r: any) => r.id === item.id);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'ratings-api-post', 400);
  }
}
