import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { canManageIncubationSettingsServer } from '@/lib/permissions-server';
import { defaultIncubationSettings } from '@/lib/incubation/defaults';
import { validateSettings } from '@/lib/incubation/rules';
import { incubationAudit } from '@/lib/incubation/audit-server';
import type { IncubationSettings } from '@/lib/incubation/types';

async function loadCurrent(): Promise<IncubationSettings> {
  const rows = await readCollection<any>('incubationSettings');
  return (rows.find(r => r.id === 'default') as IncubationSettings | undefined) ?? defaultIncubationSettings();
}

export async function GET(request: Request) {
  try {
    await requireSession(request);
    return NextResponse.json(await loadCurrent());
  } catch (err) {
    return apiError(err, 'incubation-settings-get', 500);
  }
}

/** Replace the settings document. Stamps approvedBy/At on blocks newly marked approved; keeps the prior version as history. */
export async function PUT(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!(await canManageIncubationSettingsServer(actor))) throw new ForbiddenError('Only the CEO or Super User can change incubation settings.');
    const body = (await request.json()) as IncubationSettings;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid settings.' }, { status: 400 });

    const prev = await loadCurrent();
    const now = new Date().toISOString();
    const stamp = <T extends { status: string; approvalRef?: string; approvedBy?: string; approvedAt?: string }>(next: T, old: T | undefined): T => {
      if (next.status === 'approved') {
        const unchanged = old?.status === 'approved' && old.approvalRef === next.approvalRef;
        return unchanged ? { ...next, approvedBy: old!.approvedBy, approvedAt: old!.approvedAt } : { ...next, approvedBy: actor.name, approvedAt: now };
      }
      const { approvedBy: _a, approvedAt: _b, ...rest } = next as any;
      return rest as T;
    };

    const merged: IncubationSettings = {
      ...body,
      id: 'default',
      version: (prev.version ?? 0) + 1,
      scorecard: stamp(body.scorecard, prev.scorecard),
      graduation: stamp(body.graduation, prev.graduation),
      timers: stamp(body.timers, prev.timers),
      kpis: stamp(body.kpis, prev.kpis),
      feeSchedules: (body.feeSchedules || []).map(f => stamp(f, prev.feeSchedules?.find(p => p.id === f.id))),
      updatedAt: now,
      updatedBy: actor.id,
    };
    const err = validateSettings(merged);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    await mutateCollection<any>('incubationSettings', (cur) => {
      const history = cur.filter(r => r.id !== 'default').slice(-49);
      const prevRow = cur.find(r => r.id === 'default');
      return [merged, ...history, ...(prevRow ? [{ ...prevRow, id: `v${prevRow.version}` }] : [])];
    });
    await incubationAudit(actor, 'INCUBATION_SETTINGS_UPDATED', 'incubationSettings', `Settings saved as version ${merged.version}.`);
    return NextResponse.json(merged);
  } catch (err) {
    return apiError(err, 'incubation-settings-put', 400);
  }
}
