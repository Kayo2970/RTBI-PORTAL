import { NextResponse } from 'next/server';
import {
  getPendingTaskQueues,
  flushTaskEmailDigest,
  cancelTaskEmailQueue,
  cancelAllTaskEmailQueues
} from '@/lib/task-email-queue';
import {
  getBufferedEmails,
  flushBufferedEmail,
  cancelBufferedEmail,
  flushAllBufferedEmails,
  cancelAllBufferedEmails
} from '@/lib/email-service';
import { requireSession } from '@/lib/session';
import { getAccessLevelSettingsServer, canManageEmailSettings } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canManageEmailSettings(actor, settings)) {
      return NextResponse.json({ error: 'You do not have permission to view the email queue.' }, { status: 403 });
    }
    const [bufferedEmails, taskQueues] = await Promise.all([
      getBufferedEmails(),
      getPendingTaskQueues(),
    ]);
    return NextResponse.json({
      count: bufferedEmails.length + taskQueues.length,
      bufferedEmails,
      queues: taskQueues,
    });
  } catch (err: any) {
    return apiError(err, 'email-queue-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canManageEmailSettings(actor, settings)) {
      return NextResponse.json({ error: 'You do not have permission to manage the email queue.' }, { status: 403 });
    }
    const body = await request.json();
    const { id, email, all, only, except } = body;
    const scope = { only: only === 'CERTIFICATE' ? ('CERTIFICATE' as const) : undefined, except: except === 'CERTIFICATE' ? ('CERTIFICATE' as const) : undefined };

    if (all) {
      const [bufferedCount] = await Promise.all([
        flushAllBufferedEmails(scope),
      ]);
      return NextResponse.json({ success: true, message: `Successfully flushed all ${bufferedCount} buffered emails` });
    }

    if (id) {
      const dispatched = await flushBufferedEmail(id);
      if (dispatched) {
        return NextResponse.json({ success: true, message: `Successfully flushed and dispatched buffered email ${id}` });
      }
      return NextResponse.json({ error: `Buffered email ${id} was not found, is already being sent, or has already been sent/cancelled. Refresh the queue.` }, { status: 404 });
    }

    if (email) {
      await flushTaskEmailDigest(email);
      return NextResponse.json({ success: true, message: `Successfully flushed task queue for ${email}` });
    }

    return NextResponse.json({ error: 'id or email parameter is required' }, { status: 400 });
  } catch (err: any) {
    return apiError(err, 'email-queue-api-post', 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canManageEmailSettings(actor, settings)) {
      return NextResponse.json({ error: 'You do not have permission to manage the email queue.' }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const email = searchParams.get('email');
    const all = searchParams.get('all');
    const scopeParam = searchParams.get('scope'); // 'certificates' = only certificate emails; 'general' = everything except them
    const scope = scopeParam === 'certificates' ? { only: 'CERTIFICATE' as const } : scopeParam === 'general' ? { except: 'CERTIFICATE' as const } : undefined;

    if (all === 'true') {
      const [bufferedCount, taskCount] = await Promise.all([
        cancelAllBufferedEmails(scope),
        scopeParam === 'certificates' ? Promise.resolve(0) : cancelAllTaskEmailQueues(),
      ]);
      return NextResponse.json({ success: true, count: bufferedCount + taskCount, message: `Cancelled all ${bufferedCount + taskCount} queued emails` });
    }

    if (id) {
      const cancelled = await cancelBufferedEmail(id);
      if (cancelled) {
        return NextResponse.json({ success: true, message: `Cancelled buffered email ${id}` });
      }
      return NextResponse.json({ error: `Buffered email ${id} not found` }, { status: 404 });
    }

    if (email) {
      const cancelled = cancelTaskEmailQueue(email);
      if (cancelled) {
        return NextResponse.json({ success: true, message: `Cancelled queued email buffer for ${email}` });
      }
      return NextResponse.json({ error: `No active queue found for ${email}` }, { status: 404 });
    }

    return NextResponse.json({ error: 'id, email or all=true parameter is required' }, { status: 400 });
  } catch (err: any) {
    return apiError(err, 'email-queue-api-delete', 500);
  }
}
