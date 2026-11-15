import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { isCentreHead, isAdvisor, isSuperUser, getAccessLevelSettingsServer } from '@/lib/permissions-server';
import { resolveTaskEmailRecipients } from '@/lib/task-email-queue';
import { dispatchEmail, generateTaskEmailTemplate } from '@/lib/email-service';
import { apiError } from '@/lib/api-error';

/**
 * Manually (re-)send the "this task has been allotted to you" assignment
 * notice on demand — separate from the normal auto-assignment flow (which
 * only fires once, debounced, at creation/reassignment time via
 * enqueueTaskEmailNotification). Sends immediately, right away, to
 * everyone currently allotted to the task (individual/group —
 * see resolveTaskEmailRecipients).
 *
 * Restricted to Centre Head, Advisor, and Super User — deliberately not
 * extended via a Group Policy capability grant like most other actions in
 * this app: the request that added this explicitly named exactly these
 * three roles as the ones who should ever be able to trigger it, so unlike
 * most CAPABILITY_CATALOG entries this one has no dynamic-grant escape
 * hatch, by design.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const settings = await getAccessLevelSettingsServer();
    requirePermission(
      isCentreHead(actor, settings) || isAdvisor(actor) || isSuperUser(actor),
      'Only the CEO or Super User can manually send a task-allotment email.'
    );

    const tasks = await readCollection<any>('tasks');
    const task = tasks.find((t: any) => t.id === id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const members = await readCollection<any>('members');
    const events = await readCollection<any>('events');
    const recipients = resolveTaskEmailRecipients(task, members, events);
    if (recipients.length === 0) {
      return NextResponse.json({ error: 'No emailable assignee found on this task.' }, { status: 400 });
    }

    let sent = 0;
    const failed: string[] = [];
    for (const recipient of recipients) {
      const template = generateTaskEmailTemplate(
        recipient.name,
        task.title,
        task.event || '',
        task.dueDate,
        task.creatorName || actor.name || 'RTBI Portal'
      );
      const log = await dispatchEmail({
        to: recipient.email,
        subject: template.subject,
        bodyText: template.bodyText,
        bodyHtml: template.bodyHtml,
        badgeText: 'Task Assignment',
        badgeColor: '#CC3D19',
        category: 'TASK_ASSIGNMENT',
      });
      if (log.status === 'SENT' || log.status === 'BUFFERED') sent++; else failed.push(recipient.email);
    }

    return NextResponse.json({ success: sent > 0, sent, total: recipients.length, failed });
  } catch (err: any) {
    return apiError(err, 'tasks-id-notify-post', 400);
  }
}
