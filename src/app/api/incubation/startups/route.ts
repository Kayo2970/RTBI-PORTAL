import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { canManageStartupsServer } from '@/lib/permissions-server';
import { nextStartupId } from '@/lib/incubation/rules';
import { incubationAudit } from '@/lib/incubation/audit-server';
import { visibleStartupsFor, validFounderIds } from '@/lib/incubation/startups-server';
import { attachOnboardingDocs } from '@/lib/incubation/onboarding-files-server';
import { STARTUP_PATHWAYS, STARTUP_MODES, type Startup, type StartupPathway, type StartupMode } from '@/lib/incubation/types';

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    return NextResponse.json(await visibleStartupsFor(actor));
  } catch (err) {
    return apiError(err, 'incubation-startups-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!(await canManageStartupsServer(actor))) throw new ForbiddenError('Only the CEO or Super User can add startups.');
    const body = await request.json();
    const name = str(body.name);
    if (!name) return NextResponse.json({ error: 'Startup name is required.' }, { status: 400 });

    const pathway: StartupPathway = (STARTUP_PATHWAYS as readonly string[]).includes(body.pathway) ? body.pathway : STARTUP_PATHWAYS[1];
    const mode: StartupMode | undefined = (STARTUP_MODES as readonly string[]).includes(body.mode) ? body.mode : undefined;
    const founderMemberIds = await validFounderIds(body.founderMemberIds);
    const now = new Date().toISOString();

    let created!: Startup;
    await mutateCollection<Startup>('startups', (cur) => {
      created = {
        id: nextStartupId(cur.map(s => s.id)),
        name,
        sector: str(body.sector) || undefined,
        stage: str(body.stage) || undefined,
        technology: str(body.technology) || undefined,
        legalStatus: str(body.legalStatus) || undefined,
        website: str(body.website, 300) || undefined,
        status: 'Applicant',
        pathway,
        mode,
        cohort: str(body.cohort) || undefined,
        founderMemberIds,
        consent: { externalDisclosure: false, photos: false, caseStudies: false },
        notes: str(body.notes, 2000) || undefined,
        createdAt: now,
        createdBy: actor.id,
        updatedAt: now,
        changeLog: [],
      };
      return [created, ...cur];
    });

    // Synchronize linked founder member accounts with the new startup
    if (founderMemberIds.length > 0) {
      await mutateCollection('members', (cur) =>
        (cur || []).map((m: any) => {
          if (founderMemberIds.includes(m.id)) {
            return { ...m, startupId: created.id, tier: 4, role: 'Startup', division: 'Startup' };
          }
          return m;
        })
      );
    }

    // Documents uploaded at creation are saved to disk and queued for verification; the rest can be uploaded later.
    let documentsUploaded = 0;
    try { documentsUploaded = await attachOnboardingDocs(actor.id, created.id, body.documents); }
    catch (e: any) { return NextResponse.json({ ...created, documentError: e?.message || 'A document could not be saved.' }, { status: 201 }); }

    await incubationAudit(actor, 'STARTUP_CREATED', created.id, `Startup "${created.name}" created${documentsUploaded ? ` with ${documentsUploaded} document(s) for verification` : ''}.`);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return apiError(err, 'incubation-startups-post', 400);
  }
}
