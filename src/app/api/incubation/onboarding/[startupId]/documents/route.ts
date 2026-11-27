import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { isInternalStaff, isExternalReviewer } from '@/lib/permissions-server';
import { incubationAudit } from '@/lib/incubation/audit-server';
import { canFounderEditStartup } from '@/lib/incubation/startups-server';
import { attachOnboardingDocs } from '@/lib/incubation/onboarding-files-server';
import { ONBOARDING_ITEMS } from '@/lib/incubation/onboarding';
import type { Startup } from '@/lib/incubation/types';

export const maxDuration = 60;

/**
 * POST { documents: { [itemKey]: { name, type, dataUrl } } }
 * RTBI staff may upload for any startup; a founder may upload the six mandatory documents for their own
 * startup. Uploading never marks an item verified — staff scrutinise and verify it afterwards.
 */
export async function POST(request: Request, { params }: { params: Promise<{ startupId: string }> }) {
  try {
    const actor = await requireSession(request);
    if (isExternalReviewer(actor)) throw new ForbiddenError();
    const { startupId } = await params;
    const startup = (await readCollection<Startup>('startups')).find(s => s.id === startupId);
    if (!startup) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const staff = isInternalStaff(actor) && actor.tier !== 4;
    if (!staff && !canFounderEditStartup(actor, startup)) throw new ForbiddenError();
    const body = await request.json();
    const only = staff ? undefined : ONBOARDING_ITEMS.filter(i => i.category === 'document').map(i => i.key);
    const n = await attachOnboardingDocs(actor.id, startupId, body.documents, only);
    if (n === 0) return NextResponse.json({ error: 'No document received.' }, { status: 400 });
    await incubationAudit(actor, 'ONBOARDING_DOCUMENT_UPLOADED', startupId, `${n} document(s) uploaded for verification.`);
    return NextResponse.json({ ok: true, uploaded: n }, { status: 201 });
  } catch (err) {
    return apiError(err, 'incubation-onboarding-documents', 400);
  }
}
