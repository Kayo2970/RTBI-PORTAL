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
    await mutateCollection<any>('incubationRecords', cur => cur.map(r => (r.id === id ? rec : r)));
    await applyStartupStatusEffects(rec);
    await incubationAudit(actor, `${kind.toUpperCase()}_UPDATED`, id, `${def.label} updated.`);
    return NextResponse.json(rec);
  } catch (err) {
    return apiError(err, 'incubation-records-patch', 400);
  }
}
