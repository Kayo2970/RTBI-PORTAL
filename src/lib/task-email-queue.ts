import { dispatchEmail, wrapInMasterEmailTemplate } from './email-service';
import { readCollection, mutateCollection } from './server-db';
import { getAppBaseUrl } from './app-url';

export interface TaskEmailRecipient {
  email: string;
  name: string;
}

/**
 * Resolves who should actually be emailed for a task, across every
 * assigneeType — not just 'individual'. Before this, the tasks API only ever
 * looked at task.assigneeEmail / task.assigneeId / a name match against
 * task.assignee, none of which are ever set on a 'committee' or 'group'
 * task (those carry eventCommitteeId or assigneeIds instead), so assigning a
 * task to a committee or a group of students silently never emailed anyone.
 */
export function resolveTaskEmailRecipients(
  task: {
    assigneeType?: 'individual' | 'committee' | 'group';
    assignee?: string;
    assigneeId?: string;
    assigneeEmail?: string;
    assigneeIds?: string[];
    eventId?: string;
    eventCommitteeId?: string;
  },
  members: Array<{ id: string; name: string; email?: string; status?: string }>,
  events: Array<{ id: string; committees?: Array<{ id: string; memberIds: string[] }> }>
): TaskEmailRecipient[] {
  const activeMembers = members.filter(m => m.status !== 'Terminated' && m.email);
  const byId = new Map(activeMembers.map(m => [m.id, m]));

  if (task.assigneeType === 'group' && Array.isArray(task.assigneeIds) && task.assigneeIds.length > 0) {
    return task.assigneeIds
      .map(id => byId.get(id))
      .filter((m): m is typeof activeMembers[number] => Boolean(m))
      .map(m => ({ email: m.email!, name: m.name }));
  }

  if (task.assigneeType === 'committee' && task.eventId && task.eventCommitteeId) {
    const event = events.find(e => e.id === task.eventId);
    const committee = event?.committees?.find(c => c.id === task.eventCommitteeId);
    return (committee?.memberIds || [])
      .map(id => byId.get(id))
      .filter((m): m is typeof activeMembers[number] => Boolean(m))
      .map(m => ({ email: m.email!, name: m.name }));
  }

  // Individual, and the fallback for any legacy/unknown shape.
  let email = task.assigneeEmail;
  let name = task.assignee;
  if (!email && task.assigneeId) {
    const match = byId.get(task.assigneeId);
    if (match) {
      email = match.email;
      name = match.name;
    }
  } else if (!email && task.assignee) {
    const match = activeMembers.find(m => m.name.toLowerCase() === String(task.assignee).toLowerCase());
    if (match) {
      email = match.email;
      name = match.name;
    }
  }
  return email ? [{ email, name: name || 'Member' }] : [];
}

interface PendingTaskItem {
  id: string;
  title: string;
  event?: string;
  dueDate?: string;
  creatorName?: string;
  assigneeName: string;
  assignedAt: string;
}

interface RecipientQueue {
  timer: NodeJS.Timeout | null;
  items: PendingTaskItem[];
}

const DEBOUNCE_MS = 10 * 60 * 1000; // 10 minutes quiet period
const pendingQueues: Map<string, RecipientQueue> = new Map();

/**
 * Enqueue a task assignment for debounced email dispatch (10-minute quiet buffer).
 * If multiple tasks are assigned to the same student within 10 minutes, they are
 * aggregated into a single digest email rather than triggering multiple individual emails.
 */
export async function enqueueTaskEmailNotification(task: {
  id: string;
  title: string;
  event?: string;
  eventName?: string;
  dueDate?: string;
  creatorName?: string;
  assigneeEmail: string;
  assigneeName?: string;
}) {
  const email = (task.assigneeEmail || '').toLowerCase().trim();
  if (!email) return;

  const item: PendingTaskItem = {
    id: task.id,
    title: task.title,
    event: task.event || task.eventName || 'RTBI Operations',
    dueDate: task.dueDate || 'Flexible',
    creatorName: task.creatorName || 'Committee Lead',
    assigneeName: task.assigneeName || 'Member',
    assignedAt: new Date().toISOString(),
  };

  let queue = pendingQueues.get(email);
  if (!queue) {
    queue = { timer: null, items: [] };
    pendingQueues.set(email, queue);
  }

  // Clear existing timer to extend the 10-minute buffer window
  if (queue.timer) {
    clearTimeout(queue.timer);
  }

  // Deduplicate item by ID
  const existingIdx = queue.items.findIndex(i => i.id === item.id);
  if (existingIdx >= 0) {
    queue.items[existingIdx] = item;
  } else {
    queue.items.push(item);
  }

  // Set 10-minute debounce timer to flush digest
  queue.timer = setTimeout(() => {
    flushTaskEmailDigest(email).catch(err => {
      console.error(`[task-email-queue] Error flushing digest for ${email}:`, err);
    });
  }, DEBOUNCE_MS);
}

/**
 * Immediately flush and send any queued task email digest for the given email address.
 */
export async function flushTaskEmailDigest(recipientEmail: string) {
  const queue = pendingQueues.get(recipientEmail.toLowerCase());
  if (!queue || queue.items.length === 0) return;

  if (queue.timer) {
    clearTimeout(queue.timer);
    queue.timer = null;
  }

  const itemsToSend = [...queue.items];
  queue.items = [];
  pendingQueues.delete(recipientEmail.toLowerCase());

  const firstItem = itemsToSend[0];
  const assigneeName = firstItem?.assigneeName || 'Member';
  const taskCount = itemsToSend.length;
  const taskIds = itemsToSend.map(i => i.id).join(',');

  const baseUrl = getAppBaseUrl();
  const ackUrl = `${baseUrl}/dashboard/tasks?ack=${encodeURIComponent(taskIds)}&email=${encodeURIComponent(recipientEmail)}`;

  const subject = taskCount === 1
    ? `Task Assignment: ${firstItem?.title || 'New Task'}`
    : `Committee Assignment Digest: ${taskCount} New Tasks Assigned`;

  // Build HTML list of tasks
  const taskListHtml = itemsToSend
    .map(
      (item, idx) => `
      <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 16px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong style="color: #6366f1; font-size: 15px;">#${idx + 1} ${escapeHtml(item.title)}</strong>
          <span style="font-size: 11px; background: rgba(99, 102, 241, 0.15); color: #818cf8; padding: 3px 8px; border-radius: 99px; border: 1px solid rgba(99, 102, 241, 0.3);">
            Due: ${escapeHtml(item.dueDate || 'Flexible')}
          </span>
        </div>
        <div style="font-size: 12px; color: #a1a1aa; line-height: 1.5;">
          <span>📌 <strong>Context:</strong> ${escapeHtml(item.event || 'RTBI Operations')}</span><br/>
          <span>👤 <strong>Assigned By:</strong> ${escapeHtml(item.creatorName || 'Committee Lead')}</span>
        </div>
      </div>
    `
    )
    .join('');

  const bodyText = `Dear ${assigneeName},\n\nYou have been assigned ${taskCount} task(s) / committee role(s) in RTBI Portal:\n\n` +
    itemsToSend.map(i => `- ${i.title} (Context: ${i.event}, Due: ${i.dueDate})`).join('\n') +
    `\n\nPlease view and acknowledge your tasks using this link:\n${ackUrl}\n\nRegards,\nRTBI Portal Management`;

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    badgeText: `ASSIGNMENT DIGEST (${taskCount} TASK${taskCount === 1 ? '' : 'S'})`,
    badgeColor: '#6366f1',
    headerTitle: `Task & Committee Assignments`,
    bodyContentHtml: `
    <p style="margin: 0 0 20px; font-size: 14px; color: #475569; line-height: 1.6;">
      Dear <strong>${escapeHtml(assigneeName)}</strong>,<br/>
      You are assigned to the following ${taskCount} task(s) / committee responsibility(ies) in RTBI Portal:
    </p>

    <div style="margin-bottom: 24px;">
      ${taskListHtml}
    </div>

    <div style="text-align: center; margin: 28px 0 16px;">
      <a href="${ackUrl}" target="_blank" style="display: inline-block; background: #6366f1; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 600; font-size: 14px; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);">
        ✔ View & Acknowledge Tasks
      </a>
    </div>

    <p style="margin: 16px 0 0; font-size: 11px; color: #64748b; text-align: center;">
      Opening the link above automatically records your acknowledgment that you have reviewed your tasks.
    </p>
    `,
  });

  await dispatchEmail({
    to: recipientEmail,
    subject,
    bodyText,
    bodyHtml,
    category: 'TASK_ASSIGNMENT',
    immediate: true,
  });

  // Mark task records in DB with emailNotifiedAt timestamp
  try {
    await mutateCollection('tasks', (current: any[]) => {
      const idSet = new Set(itemsToSend.map(i => i.id));
      return current.map(t => {
        if (idSet.has(t.id)) {
          return {
            ...t,
            emailNotifiedAt: new Date().toISOString(),
          };
        }
        return t;
      });
    });
  } catch (err) {
    console.error('[task-email-queue] Failed to mark emailNotifiedAt in tasks collection:', err);
  }
}

function escapeHtml(str: string): string {
  return (str || '').replace(/[&<>"']/g, match => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return map[match] || match;
  });
}

export function getPendingTaskQueues() {
  const result: { email: string; assigneeName: string; taskCount: number; tasks: PendingTaskItem[] }[] = [];
  pendingQueues.forEach((queue, email) => {
    if (queue.items.length > 0) {
      result.push({
        email,
        assigneeName: queue.items[0]?.assigneeName || 'Member',
        taskCount: queue.items.length,
        tasks: queue.items,
      });
    }
  });
  return result;
}

export function cancelTaskEmailQueue(recipientEmail: string): boolean {
  const key = recipientEmail.toLowerCase();
  const queue = pendingQueues.get(key);
  if (queue) {
    if (queue.timer) clearTimeout(queue.timer);
    pendingQueues.delete(key);
    return true;
  }
  return false;
}

export function cancelAllTaskEmailQueues(): number {
  let count = 0;
  pendingQueues.forEach(queue => {
    if (queue.timer) clearTimeout(queue.timer);
    count++;
  });
  pendingQueues.clear();
  return count;
}
