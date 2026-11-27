import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { canManageStartupsServer } from '@/lib/permissions-server';
import { incubationAudit } from '@/lib/incubation/audit-server';
import { KINDS } from '@/lib/incubation/kinds';
import { buildRecord, canWriteRecord, readableRecords, applyStartupStatusEffects } from '@/lib/incubation/records-server';

export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const actor = await requireSession(request);
    const { kind } = await params;
    if (!KINDS[kind]) return NextResponse.json({ error: 'Unknown register.' }, { status: 404 });
    return NextResponse.json(await readableRecords(kind, actor));
  } catch (err) {
    return apiError(err, 'incubation-records-get', 500);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const actor = await requireSession(request);
    const { kind } = await params;
    const def = KINDS[kind];
    if (!def) return NextResponse.json({ error: 'Unknown register.' }, { status: 404 });
    const body = await request.json();
    if (!(await canWriteRecord(def, actor, body?.startupId))) throw new ForbiddenError(`You do not have permission to add ${def.plural.toLowerCase()}.`);
    const isManager = await canManageStartupsServer(actor);
    const { rec, error } = await buildRecord({ def, body, actor, isManager });
    if (error || !rec) return NextResponse.json({ error: error || 'Invalid record.' }, { status: 400 });
    // Closed startups only accept their exit paperwork and evidence — no new reviews, sessions or agreements.
    if (rec.startupId && !['exit', 'evidence', 'incident'].includes(kind)) {
      const st = (await readCollection<any>('startups')).find(x => x.id === rec.startupId);
      if (st && ['Graduated', 'Exited'].includes(st.status)) return NextResponse.json({ error: `${st.name} is ${st.status}. New ${def.plural.toLowerCase()} cannot be added.` }, { status: 400 });
    }
    await mutateCollection<any>('incubationRecords', cur => [rec, ...cur]);
    await applyStartupStatusEffects(rec);
    await incubationAudit(actor, `${kind.toUpperCase()}_CREATED`, rec.id, `${def.label} created${rec.startupId ? ` for ${rec.startupId}` : ''}.`);
    return NextResponse.json(rec, { status: 201 });
  } catch (err) {
    return apiError(err, 'incubation-records-post', 400);
  }
}
