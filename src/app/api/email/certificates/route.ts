import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { getAccessLevelSettingsServer, canManageEmailSettings } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { EventItem } from '@/lib/local-data';
import { cleanTypeId, getCertificateTypes } from '@/lib/certificate';
import { CertificateSchedule } from '@/lib/certificate-scheduler';
import { BUFFER_DELAY_MS } from '@/lib/email-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function authorise(request: Request) {
  const actor = await requireSession(request);
  const settings = await getAccessLevelSettingsServer();
  return canManageEmailSettings(actor, settings) ? actor : null;
}

/**
 * Every scheduled certificate send across all events, for the Mailroom's Scheduled Certificates tab. A batch is released at its
 * scheduled time and each email then waits the universal 10-minute buffer, so `deliverAfter` is send time + that buffer.
 */
export async function GET(request: Request) {
  try {
    if (!(await authorise(request))) return NextResponse.json({ error: 'You do not have permission to view scheduled certificates.' }, { status: 403 });
    const schedules = await readCollection<CertificateSchedule>('certificateSchedules');
    const events = await readCollection<EventItem>('events');
    const typeNames = new Map<string, Map<string, string>>();
    const rows = [];
    for (const s of schedules) {
      if (!typeNames.has(s.eventId)) typeNames.set(s.eventId, new Map((await getCertificateTypes(s.eventId)).map((t) => [t.id, t.name])));
      const base = s.status === 'Done' || s.status === 'Failed' ? s.finishedAt || s.sendAt : s.sendAt;
      rows.push({
        id: s.id,
        eventId: s.eventId,
        eventTitle: events.find((e) => e.id === s.eventId)?.title || 'Deleted event',
        typeName: typeNames.get(s.eventId)?.get(cleanTypeId(s.typeId)) || 'Participation',
        recipients: s.passIds.length,
        sendAt: s.sendAt,
        deliverAfter: new Date(new Date(base).getTime() + BUFFER_DELAY_MS).toISOString(),
        status: s.status,
        sent: s.sent,
        failed: s.failed,
        error: s.error,
        finishedAt: s.finishedAt,
        createdBy: s.createdBy,
        createdAt: s.createdAt,
      });
    }
    // Upcoming first (soonest), then the most recent finished ones.
    const active = rows.filter((r) => r.status === 'Scheduled' || r.status === 'Running').sort((a, b) => a.sendAt.localeCompare(b.sendAt));
    const past = rows.filter((r) => r.status !== 'Scheduled' && r.status !== 'Running').sort((a, b) => b.sendAt.localeCompare(a.sendAt)).slice(0, 30);
    return NextResponse.json({ schedules: [...active, ...past], bufferMinutes: BUFFER_DELAY_MS / 60000 });
  } catch (err) {
    return apiError(err, 'email-certificates:get');
  }
}

/** ?scheduleId=… cancels a batch that has not started yet. */
export async function DELETE(request: Request) {
  try {
    if (!(await authorise(request))) return NextResponse.json({ error: 'You do not have permission to cancel scheduled certificates.' }, { status: 403 });
    const scheduleId = new URL(request.url).searchParams.get('scheduleId') || '';
    let cancelled = false;
    await mutateCollection<CertificateSchedule>('certificateSchedules', (cur = []) =>
      cur.map((x) => {
        if (x.id === scheduleId && x.status === 'Scheduled') {
          cancelled = true;
          return { ...x, status: 'Cancelled' as const };
        }
        return x;
      })
    );
    return cancelled ? NextResponse.json({ cancelled: true }) : NextResponse.json({ error: 'That send already started or does not exist.' }, { status: 409 });
  } catch (err) {
    return apiError(err, 'email-certificates:cancel');
  }
}
