import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { canManageStartupsServer } from '@/lib/permissions-server';
import { incubationAudit } from '@/lib/incubation/audit-server';
import { loadSettings } from '@/lib/incubation/records-server';
import { activationGate, type OnboardingRecord } from '@/lib/incubation/onboarding';
import type { Startup } from '@/lib/incubation/types';

/** The activation gate: 'Active' is set here and nowhere else. Needs all 10 onboarding items, or a written conditional approval. */
export async function POST(request: Request, { params }: { params: Promise<{ startupId: string }> }) {
  try {
    const actor = await requireSession(request);
    if (!(await canManageStartupsServer(actor))) throw new ForbiddenError('Only the CEO or Super User can activate a startup.');
    const { startupId } = await params;
    const [startups, recs, settings] = await Promise.all([readCollection<Startup>('startups'), readCollection<any>('incubationRecords'), loadSettings()]);
    const startup = startups.find(s => s.id === startupId);
    if (!startup) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (startup.status === 'Active') return NextResponse.json({ error: 'Already active.' }, { status: 400 });
    if (!['Selected', 'Onboarding'].includes(startup.status)) return NextResponse.json({ error: `A startup with status "${startup.status}" cannot be activated. Only a selected startup can.` }, { status: 400 });

    const ob = recs.find(r => r.kind === 'onboarding' && r.startupId === startupId) as OnboardingRecord | undefined;
    const gate = activationGate(ob, {
      agreementExecuted: recs.some(r => r.kind === 'agreement' && r.startupId === startupId && r.state === 'Executed'),
      trlRequired: !!startup.technology?.trim(), trlOpened: recs.some(r => r.kind === 'trl' && r.startupId === startupId),
      approvedFeeSchedule: settings.feeSchedules.some(f => f.status === 'approved'),
    });
    if (!gate.ok) return NextResponse.json({ error: 'Onboarding is incomplete.', missing: gate.missing }, { status: 400 });

    const now = new Date().toISOString();
    await mutateCollection<Startup>('startups', cur => cur.map(s => (s.id === startupId
      ? { ...s, status: 'Active', activatedAt: now, activationBasis: gate.basis, incubationStartDate: s.incubationStartDate || now.slice(0, 10), updatedAt: now,
          changeLog: [...(s.changeLog || []), { at: now, by: actor.id, field: 'status', from: s.status, to: `Active (${gate.basis})` }] }
      : s)));
    await incubationAudit(actor, 'STARTUP_ACTIVATED', startupId, `Activated on a ${gate.basis} basis.`);
    return NextResponse.json({ ok: true, basis: gate.basis });
  } catch (err) {
    return apiError(err, 'incubation-activate', 400);
  }
}
