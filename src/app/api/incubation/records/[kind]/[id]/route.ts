import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { canManageStartupsServer } from '@/lib/permissions-server';
import { incubationAudit } from '@/lib/incubation/audit-server';
import { KINDS } from '@/lib/incubation/kinds';
import { buildRecord, canWriteKind, applyStartupStatusEffects } from '@/lib/incubation/records-server';

export const maxDuration = 60;

/** PATCH updates fields; every changed field is appended to the record's change log (no silent edits). Records are never deleted. */
export async function PATCH(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const actor = await requireSession(request);
    const { kind, id } = await params;
    const def = KINDS[kind];
    if (!def) return NextResponse.json({ error: 'Unknown register.' }, { status: 404 });
    if (!(await canWriteKind(def, actor))) throw new ForbiddenError(`You do not have permission to edit ${def.plural.toLowerCase()}.`);
    const isManager = await canManageStartupsServer(actor);
    const existing = (await readCollection<any>('incubationRecords')).find(r => r.id === id && r.kind === kind);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (def.restricted && !isManager && existing.createdBy !== actor.id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.finalised && !isManager) throw new ForbiddenError('A finalised decision can only be changed by a manager.');

    const { rec, error } = await buildRecord({ def, body: await request.json(), existing, actor, isManager });
    if (error || !rec) return NextResponse.json({ error: error || 'Invalid record.' }, { status: 400 });
    rec.updatedBy = actor.id;
    // Optimistic concurrency: refuse if someone saved this record after we read it (their change-log entries would be lost).
    let conflict = false;
    await mutateCollection<any>('incubationRecords', cur => {
      const live = cur.find(r => r.id === id);
      if (!live || (live.updatedAt ?? null) !== (existing.updatedAt ?? null) || (live.changeLog?.length ?? 0) !== (existing.changeLog?.length ?? 0)) { conflict = true; return cur; }
      return cur.map(r => (r.id === id ? rec : r));
    });
    if (conflict) return NextResponse.json({ error: 'Someone else changed this record a moment ago. Reload it and try again.' }, { status: 409 });
    await applyStartupStatusEffects(rec);
    await incubationAudit(actor, `${kind.toUpperCase()}_UPDATED`, id, `${def.label} updated.`);
    return NextResponse.json(rec);
  } catch (err) {
    return apiError(err, 'incubation-records-patch', 400);
  }
}
