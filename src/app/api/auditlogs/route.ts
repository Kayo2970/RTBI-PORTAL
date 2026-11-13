import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { getAccessLevelSettingsServer, isCentreHead } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

// The audit trail is sensitive (it can reveal who did what across the whole
// app), so reading it is restricted to leadership — but writing to it is not:
// logAuditEvent() is called from dozens of ordinary member actions throughout
// local-data.ts (submitting a claim, editing a task, ...), so POST only needs
// a valid session, matching every other write path's audit logging.
export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    requirePermission(
      isCentreHead(actor, settings) || actor.tier === 1,
      'You do not have permission to view the audit log.'
    );
    const items = await readCollection('auditLogs');
    return NextResponse.json(items);
  } catch (err: any) {
    return apiError(err, 'auditlogs-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession(request);
    const item = await request.json();
    const updated = await mutateCollection('auditLogs', (current) => {
      const next = [item, ...current];
      return next.slice(0, 1000); // Keep latest 1000 log entries
    });
    const created = updated.find((l: any) => l.id === item.id);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'auditlogs-api-post', 400);
  }
}
