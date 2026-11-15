import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { canManageStartupsServer } from '@/lib/permissions-server';
import { incubationAudit } from '@/lib/incubation/audit-server';
import { canSeeStartup, validFounderIds } from '@/lib/incubation/startups-server';
import { STARTUP_PATHWAYS, STARTUP_MODES, type Startup, type StartupChange } from '@/lib/incubation/types';

const TEXT_FIELDS = ['name', 'sector', 'stage', 'technology', 'legalStatus', 'website', 'cohort', 'notes', 'incubationStartDate'] as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const s = (await readCollection<Startup>('startups')).find(x => x.id === id);
    if (!s || !(await canSeeStartup(actor, s))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(s);
  } catch (err) {
    return apiError(err, 'incubation-startup-get', 500);
  }
}

/**
 * PATCH edits a startup. Every changed field is appended to `changeLog` (no silent edits).
 * `status` changes here are limited to administrative ones — Active is reserved for the onboarding
 * activation gate (Phase 3) and cannot be set directly.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSession(request);
    if (!(await canManageStartupsServer(actor))) throw new ForbiddenError('Only the CEO or Super User can edit startups.');
    const { id } = await params;
    const body = await request.json();
    const founders = body.founderMemberIds !== undefined ? await validFounderIds(body.founderMemberIds) : undefined;
    const now = new Date().toISOString();
    let updated: Startup | undefined;

    await mutateCollection<Startup>('startups', (cur) => cur.map(s => {
      if (s.id !== id) return s;
      const next: Startup = { ...s };
      const changes: StartupChange[] = [];
      const set = (field: string, to: unknown) => {
        const from = (s as any)[field];
        if (JSON.stringify(from) !== JSON.stringify(to)) { (next as any)[field] = to; changes.push({ at: now, by: actor.id, field, from, to }); }
      };
      for (const f of TEXT_FIELDS) {
        if (typeof body[f] === 'string') {
          const v = body[f].trim().slice(0, f === 'notes' ? 2000 : 300);
          if (f === 'name' && !v) continue;
          set(f, v || undefined);
        }
      }
      if ((STARTUP_PATHWAYS as readonly string[]).includes(body.pathway)) set('pathway', body.pathway);
      if ((STARTUP_MODES as readonly string[]).includes(body.mode)) set('mode', body.mode);
      if (founders) set('founderMemberIds', founders);
      if (body.status === 'Waitlisted' || body.status === 'Applicant' || body.status === 'Selected') set('status', body.status);
      if (body.consent && typeof body.consent === 'object') {
        const c = { externalDisclosure: !!body.consent.externalDisclosure, photos: !!body.consent.photos, caseStudies: !!body.consent.caseStudies, recordedAt: now, recordedBy: actor.id };
        set('consent', c);
      }
      next.updatedAt = changes.length ? now : s.updatedAt;
      next.changeLog = [...(s.changeLog || []), ...changes];
      updated = next;
      return next;
    }));
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await incubationAudit(actor, 'STARTUP_UPDATED', id, `Startup ${id} updated.`);
    return NextResponse.json(updated);
  } catch (err) {
    return apiError(err, 'incubation-startup-patch', 400);
  }
}
