import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { gateEventPassAction } from '@/lib/approval-gate';
import { getAccessLevelSettingsServer, canManageEmailSettings } from '@/lib/permissions-server';
import { EventPassItem } from '@/lib/local-data';
import { PassEmailSchedule, PassEmailScheduleItem } from '@/lib/pass-email-scheduler';
import { cleanBackgroundChoice } from '@/lib/email-background';
import { getAppBaseUrl } from '@/lib/app-url';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** Schedules the caller created (or all of them, for people who manage the Mailroom). Optional ?passIds=a,b filters to those passes. */
export async function GET(request: Request) {
  try {
    const user = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    const all = canManageEmailSettings(user, settings);
    const passIds = (new URL(request.url).searchParams.get('passIds') || '').split(',').filter(Boolean);
    let rows = await readCollection<PassEmailSchedule>('passEmailSchedules');
    if (!all) rows = rows.filter((s) => s.createdByEmail && s.createdByEmail === user?.email);
    if (passIds.length) rows = rows.filter((s) => s.items.some((i) => passIds.includes(i.passId)));
    const active = rows.filter((s) => s.status === 'Scheduled' || s.status === 'Running').sort((a, b) => a.sendAt.localeCompare(b.sendAt));
    const past = rows.filter((s) => s.status !== 'Scheduled' && s.status !== 'Running').sort((a, b) => b.sendAt.localeCompare(a.sendAt)).slice(0, 30);
    return NextResponse.json({ schedules: [...active, ...past].map(({ items, ...rest }) => ({ ...rest, count: items.length, passIds: items.map((i) => i.passId) })) });
  } catch (err) {
    return apiError(err, 'pass-email-schedules:get');
  }
}

/**
 * Body: { sendAt, origin?, template?, items: [{ passId, email, subjectTemplate?, bodyTemplate? }] }
 * Hands a batch of pass emails to the server to send at `sendAt`.
 */
export async function POST(request: Request) {
  try {
    const user = await requireSession(request);
    const gate = await gateEventPassAction(user, 'dispatch');
    if (!gate.allowed) return NextResponse.json({ error: "You don't have permission to email event passes." }, { status: 403 });
    if (gate.requiresApproval) {
      return NextResponse.json({ error: 'Emailing passes needs an approver for your role, so it cannot be scheduled — send them now and the approver will be asked.' }, { status: 403 });
    }
    const body = await request.json();
    const when = new Date(body.sendAt);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 30_000) return NextResponse.json({ error: 'Pick a send time in the future.' }, { status: 400 });
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) return NextResponse.json({ error: 'Choose at least one pass.' }, { status: 400 });
    if (rawItems.length > 500) return NextResponse.json({ error: 'Schedule at most 500 pass emails at a time.' }, { status: 400 });

    const passes = await readCollection<EventPassItem>('event_passes');
    const items: PassEmailScheduleItem[] = [];
    const eventNames = new Set<string>();
    for (const r of rawItems) {
      const pass = passes.find((p) => p.id === r?.passId);
      const email = String(r?.email || '').trim();
      if (!pass || pass.status === 'Cancelled' || !EMAIL.test(email)) continue;
      eventNames.add(pass.eventName);
      items.push({
        passId: pass.id,
        email,
        ...(typeof r.subjectTemplate === 'string' ? { subjectTemplate: clip(r.subjectTemplate, 300) } : {}),
        ...(typeof r.bodyTemplate === 'string' ? { bodyTemplate: clip(r.bodyTemplate, 20000) } : {}),
      });
    }
    if (items.length === 0) return NextResponse.json({ error: 'None of the chosen passes can be emailed (missing a valid email, or cancelled).' }, { status: 400 });

    const t = body.template || {};
    const schedule: PassEmailSchedule = {
      id: `passsch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      items,
      template: {
        subjectTemplate: clip(t.subjectTemplate, 300),
        bodyTemplate: clip(t.bodyTemplate, 20000),
        includeMap: !!t.includeMap,
        mapUrl: clip(t.mapUrl, 500),
        includeWhatsapp: !!t.includeWhatsapp,
        whatsappUrl: clip(t.whatsappUrl, 500),
      },
      background: cleanBackgroundChoice(body.background),
      sendAt: when.toISOString(),
      origin: getAppBaseUrl(request),
      eventNames: Array.from(eventNames),
      createdBy: user?.name || 'Staff',
      createdByEmail: user?.email,
      createdAt: new Date().toISOString(),
      status: 'Scheduled',
    };
    await mutateCollection<PassEmailSchedule>('passEmailSchedules', (cur = []) => [...cur, schedule]);
    const { items: _i, ...rest } = schedule;
    return NextResponse.json({ scheduled: true, schedule: { ...rest, count: items.length }, skipped: rawItems.length - items.length });
  } catch (err) {
    return apiError(err, 'pass-email-schedules:create');
  }
}

/** ?id=… cancels a schedule that has not started. Its creator, or anyone managing the Mailroom, may cancel it. */
export async function DELETE(request: Request) {
  try {
    const user = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    const all = canManageEmailSettings(user, settings);
    const id = new URL(request.url).searchParams.get('id') || '';
    let cancelled = false;
    await mutateCollection<PassEmailSchedule>('passEmailSchedules', (cur = []) =>
      cur.map((x) => {
        if (x.id === id && x.status === 'Scheduled' && (all || (x.createdByEmail && x.createdByEmail === user?.email))) {
          cancelled = true;
          return { ...x, status: 'Cancelled' as const };
        }
        return x;
      })
    );
    return cancelled ? NextResponse.json({ cancelled: true }) : NextResponse.json({ error: 'That send already started, does not exist, or is not yours to cancel.' }, { status: 409 });
  } catch (err) {
    return apiError(err, 'pass-email-schedules:cancel');
  }
}
