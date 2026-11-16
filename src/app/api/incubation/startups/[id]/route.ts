import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { canManageStartupsServer } from '@/lib/permissions-server';
import { incubationAudit } from '@/lib/incubation/audit-server';
import { canSeeStartup, validFounderIds, canFounderEditStartup } from '@/lib/incubation/startups-server';
import { saveBase64File, parseDataUrl } from '@/lib/file-storage';
import { MAX_STARTUP_LOGO_BYTES, STARTUP_LOGO_MIME_TYPES } from '@/lib/startup-profile';
import { STARTUP_PATHWAYS, STARTUP_MODES, type Startup, type StartupChange } from '@/lib/incubation/types';

const TEXT_FIELDS = [
  'name', 'sector', 'stage', 'technology', 'legalStatus', 'website', 'cohort', 'notes',
  'incubationStartDate', 'tagline', 'aboutUs', 'problem', 'solution', 'foundedYear', 'teamSize', 'location',
] as const;

// Fields that authorized founders are allowed to self-update
const FOUNDER_EDITABLE_FIELDS = new Set([
  'name', 'tagline', 'sector', 'stage', 'technology', 'website',
  'aboutUs', 'problem', 'solution', 'foundedYear', 'teamSize', 'location', 'notes',
]);

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
    const { id } = await params;

    const allStartups = await readCollection<Startup>('startups');
    const existingStartup = allStartups.find(x => x.id === id);
    if (!existingStartup) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const isManager = await canManageStartupsServer(actor);
    const isFounder = canFounderEditStartup(actor, existingStartup);

    if (!isManager && !isFounder) {
      throw new ForbiddenError('You do not have permission to edit this startup.');
    }

    const body = await request.json();
    const founders = (isManager && body.founderMemberIds !== undefined) ? await validFounderIds(body.founderMemberIds) : undefined;
    const now = new Date().toISOString();
    let updated: Startup | undefined;

    // Handle logo upload if provided
    let newLogo: { logoUrl: string; logoStorageKey: string } | undefined;
    if (typeof body.logoData === 'string' && body.logoData.startsWith('data:')) {
      const { mime, buffer } = parseDataUrl(body.logoData);
      if (!(STARTUP_LOGO_MIME_TYPES as readonly string[]).includes(mime)) {
        return NextResponse.json({ error: 'Logo must be a PNG, JPG or WebP image.' }, { status: 400 });
      }
      if (buffer.length > MAX_STARTUP_LOGO_BYTES) {
        return NextResponse.json({ error: 'Logo exceeds the 2 MB maximum limit.' }, { status: 400 });
      }
      const stored = await saveBase64File('startup-logos', id, 0, body.logoFileName || 'logo.png', body.logoData);
      newLogo = { logoUrl: stored.url, logoStorageKey: stored.storageKey };
    }

    await mutateCollection<Startup>('startups', (cur) => cur.map(s => {
      if (s.id !== id) return s;
      const next: Startup = { ...s };
      const changes: StartupChange[] = [];
      const set = (field: string, to: unknown) => {
        const from = (s as any)[field];
        if (JSON.stringify(from) !== JSON.stringify(to)) {
          (next as any)[field] = to;
          changes.push({ at: now, by: actor.id, field, from, to });
        }
      };

      for (const f of TEXT_FIELDS) {
        // If actor is founder only, only allow founder editable fields
        if (!isManager && !FOUNDER_EDITABLE_FIELDS.has(f)) continue;

        if (typeof body[f] === 'string') {
          const maxLen = (f === 'notes' || f === 'aboutUs' || f === 'problem' || f === 'solution') ? 3000 : 300;
          const v = body[f].trim().slice(0, maxLen);
          if (f === 'name' && !v) continue;
          set(f, v || undefined);
        }
      }

      if (newLogo) {
        set('logoUrl', newLogo.logoUrl);
        set('logoStorageKey', newLogo.logoStorageKey);
      }

      if (body.socials && typeof body.socials === 'object') {
        set('socials', body.socials);
      }

      // Administrative changes reserved for manager (CEO / Super User)
      if (isManager) {
        if ((STARTUP_PATHWAYS as readonly string[]).includes(body.pathway)) set('pathway', body.pathway);
        if ((STARTUP_MODES as readonly string[]).includes(body.mode)) set('mode', body.mode);
        if (founders) set('founderMemberIds', founders);
        if (body.status === 'Waitlisted' || body.status === 'Applicant' || body.status === 'Selected') set('status', body.status);
      }

      if (body.consent && typeof body.consent === 'object') {
        const c = {
          externalDisclosure: !!body.consent.externalDisclosure,
          photos: !!body.consent.photos,
          caseStudies: !!body.consent.caseStudies,
          recordedAt: now,
          recordedBy: actor.id,
        };
        set('consent', c);
      }

      next.updatedAt = changes.length ? now : s.updatedAt;
      next.changeLog = [...(s.changeLog || []), ...changes];
      updated = next;
      return next;
    }));

    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // If founders list changed, synchronize member credentials (startupId link)
    if (founders) {
      await mutateCollection('members', (cur) =>
        (cur || []).map((m: any) => {
          if (founders.includes(m.id)) {
            return { ...m, startupId: id, tier: 4, role: 'Startup', division: 'Startup' };
          } else if (m.startupId === id && !founders.includes(m.id)) {
            const { startupId: _old, ...rest } = m;
            return rest;
          }
          return m;
        })
      );
    }

    await incubationAudit(actor, 'STARTUP_UPDATED', id, `Startup ${id} updated by ${isFounder && !isManager ? 'founder' : 'manager'}.`);
    return NextResponse.json(updated);
  } catch (err) {
    return apiError(err, 'incubation-startup-patch', 400);
  }
}
