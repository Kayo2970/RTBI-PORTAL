import { NextResponse } from 'next/server';
import { mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { isSuperUser } from '@/lib/permissions-server';
import { listActiveLocks, unlockRecord } from '@/lib/device-security';
import { apiError } from '@/lib/api-error';

/**
 * Super-User-only view of devices currently locked out of signing in (see lib/device-security.ts), with an
 * unlock action. Only masked IPs and a truncated user agent are returned — never the device id or its hash.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!isSuperUser(actor)) {
      return NextResponse.json({ error: 'Only a Super User can view locked devices.' }, { status: 403 });
    }
    return NextResponse.json({ locks: await listActiveLocks() });
  } catch (err: any) {
    return apiError(err, 'admin-device-locks-get');
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!isSuperUser(actor)) {
      return NextResponse.json({ error: 'Only a Super User can unlock devices.' }, { status: 403 });
    }
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!id || id.length > 200) {
      return NextResponse.json({ error: 'Lock id is required.' }, { status: 400 });
    }
    const result = await unlockRecord(id);
    if (!result.found) {
      return NextResponse.json({ error: 'That lock no longer exists.' }, { status: 404 });
    }
    await mutateCollection('auditLogs', (cur: any[]) => [{
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action: 'DEVICE_UNLOCKED',
      user: actor.name,
      actorName: actor.name,
      actorEmail: actor.email,
      details: result.account
        ? `${actor.name} unlocked a device that was locked out of ${result.account}.`
        : `${actor.name} unlocked a device that was locked out of all accounts.`,
      timestamp: new Date().toISOString(),
    }, ...(cur || [])]);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'admin-device-locks-delete');
  }
}
