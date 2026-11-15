import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { isPassArchived } from '@/lib/pass-retention';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import {
  EventPassItem,
  PassAttendanceRecord,
  isPassValidOn,
  mergeAttendance,
  getPassValidDays,
} from '@/lib/local-data';

/**
 * Server-side multi-day check-in. One pass / one QR; one attendance record per day.
 * Body: { passId, days: string[] (ISO dates or custom labels), allowOutOfWindow?: boolean }
 */
export async function POST(request: Request) {
  try {
    const sessionUser = await requireSession(request);
    const { passId, days, allowOutOfWindow } = (await request.json()) as {
      passId?: string;
      days?: string[];
      allowOutOfWindow?: boolean;
    };
    if (!passId || !Array.isArray(days) || days.length === 0) {
      return NextResponse.json({ error: 'passId and days are required' }, { status: 400 });
    }

    const eventRows = await readCollection<any>('events');
    let result: { pass?: EventPassItem; error?: string; alreadyChecked?: string[] } = {};
    await mutateCollection<EventPassItem>('event_passes', (current = []) => {
      const idx = current.findIndex((p) => p.id === passId || p.serialNumber === passId);
      if (idx === -1) {
        result = { error: 'Pass not found' };
        return current;
      }
      const existing = current[idx];
      if (isPassArchived(existing, eventRows.find((e: any) => e.id === existing.eventId))) {
        result = { error: 'This pass has expired.' };
        return current;
      }
      if (existing.status === 'Cancelled') {
        result = { error: 'This pass has been cancelled.' };
        return current;
      }

      const attendedKeys = new Set((existing.attendance || []).map((a) => a.day.toLowerCase()));
      const alreadyChecked = days.filter((d) => attendedKeys.has(d.toLowerCase()));
      const fresh = days.filter((d) => !attendedKeys.has(d.toLowerCase()));

      const isoDay = /^\d{4}-\d{2}-\d{2}$/;
      const outside = fresh.filter((d) => isoDay.test(d) && !isPassValidOn(existing, d));
      const knownDays = getPassValidDays(existing);
      if (outside.length > 0 && !allowOutOfWindow) {
        result = { error: `Pass is not valid on ${outside.join(', ')} (valid: ${knownDays.join(', ')}).` };
        return current;
      }

      const now = new Date().toISOString();
      const records: PassAttendanceRecord[] = fresh.map((d) => ({
        day: d,
        ...(isoDay.test(d) ? { date: d } : {}),
        timestamp: now,
        scannedBy: sessionUser.name,
        checkedInBy: sessionUser.name,
      }));

      const merged: EventPassItem = {
        ...existing,
        status: records.length > 0 || (existing.attendance || []).length > 0 ? 'Checked In' : existing.status,
        checkedInAt: existing.checkedInAt || (records.length > 0 ? now : undefined),
        checkedInBy: existing.checkedInBy || (records.length > 0 ? sessionUser.name : undefined),
        attendance: mergeAttendance(existing.attendance, records),
      };
      const copy = [...current];
      copy[idx] = merged;
      result = { pass: merged, alreadyChecked };
      return copy;
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.error === 'Pass not found' ? 404 : 409 });
    }
    return NextResponse.json({ pass: result.pass, alreadyChecked: result.alreadyChecked || [] });
  } catch (err: any) {
    return apiError(err, 'event-passes-checkin', 500);
  }
}
