import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { canManageStartupsServer, isInternalStaff } from '@/lib/permissions-server';
import { incubationAudit } from '@/lib/incubation/audit-server';
import { loadSettings } from '@/lib/incubation/records-server';
import { canSeeStartup } from '@/lib/incubation/startups-server';
import { ONBOARDING_ITEMS, FEE_BASES, activationGate, type OnboardingRecord } from '@/lib/incubation/onboarding';
import { storeOnboardingFile } from '@/lib/incubation/onboarding-files-server';
import { deleteStoredFile } from '@/lib/file-storage';
import type { Startup } from '@/lib/incubation/types';

async function load(startupId: string) {
  const [startups, recs, settings] = await Promise.all([readCollection<Startup>('startups'), readCollection<any>('incubationRecords'), loadSettings()]);
  const startup = startups.find(s => s.id === startupId);
  const ob = recs.find(r => r.kind === 'onboarding' && r.startupId === startupId) as (OnboardingRecord & { id: string; kind: string }) | undefined;
  const facts = {
    agreementExecuted: recs.some(r => r.kind === 'agreement' && r.startupId === startupId && r.state === 'Executed'),
    trlRequired: !!startup?.technology?.trim(),
    trlOpened: recs.some(r => r.kind === 'trl' && r.startupId === startupId),
    approvedFeeSchedule: settings.feeSchedules.some(f => f.status === 'approved'),
  };
  return { startup, ob, gate: activationGate(ob, facts) };
}

export async function GET(request: Request, { params }: { params: Promise<{ startupId: string }> }) {
  try {
    const actor = await requireSession(request);
    const { startupId } = await params;
    const { startup, ob, gate } = await load(startupId);
    if (!startup || !(await canSeeStartup(actor, startup))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ startup, onboarding: ob ?? { startupId, items: {}, updatedAt: '' }, gate });
  } catch (err) {
    return apiError(err, 'incubation-onboarding-get', 500);
  }
}

/** PUT { items?: {key: {done, evidenceRef, feeBasis, file?: {name,type,dataUrl}}}, conditionalApproval?: {ref, scope, endsOn} | null } */
export async function PUT(request: Request, { params }: { params: Promise<{ startupId: string }> }) {
  try {
    const actor = await requireSession(request);
    if (!isInternalStaff(actor)) throw new ForbiddenError();
    const isManager = await canManageStartupsServer(actor);
    const { startupId } = await params;
    const body = await request.json();
    const { startup, ob } = await load(startupId);
    if (!startup) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (startup.status === 'Graduated' || startup.status === 'Exited') return NextResponse.json({ error: 'This startup is closed.' }, { status: 400 });

    const now = new Date().toISOString();
    const items = { ...(ob?.items || {}) };
    const replacedFiles: string[] = [];
    for (const it of ONBOARDING_ITEMS) {
      const v = body.items?.[it.key];
      if (!v) continue;
      const prev = items[it.key];
      let done = !!v.done;
      // A newly uploaded file replaces the old one and must be re-verified; otherwise the stored file is kept untouched.
      const uploaded = await storeOnboardingFile(actor.id, startupId, it.key, v.file);
      if (uploaded) { done = false; if (prev?.file?.storageKey) replacedFiles.push(prev.file.storageKey); }
      const file = uploaded || prev?.file;
      const feeBasis = (FEE_BASES as readonly string[]).includes(v.feeBasis) ? v.feeBasis : undefined;
      items[it.key] = { done, evidenceRef: String(v.evidenceRef || '').trim().slice(0, 300) || undefined, file, feeBasis,
        doneAt: done ? (prev?.done ? prev.doneAt : now) : undefined, doneBy: done ? (prev?.done ? prev.doneBy : actor.id) : undefined };
    }
    let conditionalApproval = ob?.conditionalApproval;
    if (body.conditionalApproval !== undefined) {
      if (!isManager) throw new ForbiddenError('Only the CEO or Super User can attach a conditional approval.');
      const c = body.conditionalApproval;
      conditionalApproval = c && String(c.ref || '').trim() && String(c.scope || '').trim()
        ? { ref: String(c.ref).trim().slice(0, 300), scope: String(c.scope).trim().slice(0, 1000), endsOn: /^\d{4}-\d{2}-\d{2}$/.test(c.endsOn || '') ? c.endsOn : undefined, recordedBy: actor.id, recordedAt: now }
        : undefined;
    }
    const record = { ...(ob || { id: `onboarding_${startupId}`, kind: 'onboarding', createdAt: now, createdBy: actor.id, changeLog: [] }), startupId, items, conditionalApproval, updatedAt: now };
    await mutateCollection<any>('incubationRecords', cur => (cur.some(r => r.id === record.id) ? cur.map(r => (r.id === record.id ? record : r)) : [record, ...cur]));
    await Promise.all(replacedFiles.map(deleteStoredFile));
    await incubationAudit(actor, 'ONBOARDING_UPDATED', startupId, 'Onboarding checklist updated.');
    return NextResponse.json((await load(startupId)).gate);
  } catch (err) {
    return apiError(err, 'incubation-onboarding-put', 400);
  }
}
