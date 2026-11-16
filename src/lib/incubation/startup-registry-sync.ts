import { readCollection, mutateCollection } from '@/lib/server-db';
import { nextStartupId } from '@/lib/incubation/rules';
import type { Startup, StartupChange, StartupPathway } from '@/lib/incubation/types';
import type { StartupProfile, StartupProfileInput } from '@/lib/startup-profile';

const cleanStr = (v: unknown, max = 2000): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};

/**
 * Maps a canonical Startup record from the Startup Registry into a StartupProfile shape.
 * Safe to import and use across server and client components.
 */
export function mapStartupToProfile(startup: Startup): StartupProfile {
  return {
    startupName: startup.name || 'Startup',
    tagline: startup.tagline,
    logoUrl: startup.logoUrl,
    logoStorageKey: startup.logoStorageKey,
    sector: startup.sector || 'Other',
    stage: startup.stage || 'Idea',
    foundedYear: startup.foundedYear,
    teamSize: startup.teamSize,
    location: startup.location,
    website: startup.website,
    aboutUs: startup.aboutUs || startup.notes || '',
    problem: startup.problem,
    solution: startup.solution,
    socials: startup.socials,
    completedAt: startup.profileCompletedAt || startup.updatedAt || startup.createdAt,
  };
}

/**
 * Retrieves the Startup record associated with a member (by member.startupId or founderMemberIds).
 */
export async function getStartupForMemberServer(memberOrId: string | any): Promise<Startup | null> {
  const memberId = typeof memberOrId === 'string' ? memberOrId : memberOrId?.id;
  const explicitStartupId = typeof memberOrId === 'object' ? memberOrId?.startupId : undefined;

  const startups = await readCollection<Startup>('startups');
  if (explicitStartupId) {
    const matched = startups.find(s => s.id === explicitStartupId);
    if (matched) return matched;
  }
  if (memberId) {
    const matched = startups.find(s => Array.isArray(s.founderMemberIds) && s.founderMemberIds.includes(memberId));
    if (matched) return matched;
  }
  return null;
}

export interface SyncProfileParams {
  memberId: string;
  profile: StartupProfileInput | StartupProfile;
  phone?: string;
  actorId?: string;
}

/**
 * Synchronizes startup profile information filled by the founder during registration/activation
 * directly into the Startup Registry (`startups` collection).
 *
 * Guarantees that:
 * 1. The Startup Registry holds ALL rich startup company data (name, brand, sector, stage, problem, solution, about us, etc.).
 * 2. The User Directory (`members` collection) holds ONLY user authentication credentials (email, password hash, phone, startupId),
 *    without cluttering the user directory with company profile data.
 * 3. Bidirectional linkage (member.startupId <-> startup.founderMemberIds) is established and verified.
 */
export async function syncStartupProfileToRegistry(params: SyncProfileParams): Promise<{ startup: Startup; member: any }> {
  const { memberId, profile, phone, actorId = memberId } = params;
  const now = new Date().toISOString();

  // 1. Read existing collections
  const [startups, members] = await Promise.all([
    readCollection<Startup>('startups'),
    readCollection<any>('members'),
  ]);

  const targetMember = members.find((m: any) => m.id === memberId);
  if (!targetMember) {
    throw new Error(`Member with id "${memberId}" not found for startup registration synchronization.`);
  }

  // 2. Identify or create the Startup in the Startup Registry
  let targetStartup = startups.find(s => s.id === targetMember.startupId);
  if (!targetStartup) {
    targetStartup = startups.find(s => Array.isArray(s.founderMemberIds) && s.founderMemberIds.includes(memberId));
  }
  if (!targetStartup && profile.startupName) {
    const normName = profile.startupName.trim().toLowerCase();
    targetStartup = startups.find(s => s.name?.trim().toLowerCase() === normName);
  }

  let finalStartup!: Startup;
  const isNewStartup = !targetStartup;

  await mutateCollection<Startup>('startups', (cur) => {
    const existing = cur.find(s => s.id === targetStartup?.id);
    const sId = existing?.id || targetStartup?.id || nextStartupId(cur.map(x => x.id));
    const changes: StartupChange[] = [];

    const fieldUpdates: Partial<Startup> = {
      name: cleanStr(profile.startupName, 150) || existing?.name || targetMember.name || 'Startup',
      tagline: cleanStr(profile.tagline, 200) || existing?.tagline,
      sector: cleanStr(profile.sector, 100) || existing?.sector,
      stage: cleanStr(profile.stage, 100) || existing?.stage,
      foundedYear: cleanStr(profile.foundedYear, 10) || existing?.foundedYear,
      teamSize: cleanStr(profile.teamSize, 50) || existing?.teamSize,
      location: cleanStr(profile.location, 200) || existing?.location,
      website: cleanStr(profile.website, 300) || existing?.website,
      aboutUs: cleanStr(profile.aboutUs, 3000) || existing?.aboutUs,
      problem: cleanStr(profile.problem, 2000) || existing?.problem,
      solution: cleanStr(profile.solution, 2000) || existing?.solution,
      socials: profile.socials || existing?.socials,
      profileCompletedAt: now,
      updatedAt: now,
    };

    if ((profile as any).logoUrl) {
      fieldUpdates.logoUrl = (profile as any).logoUrl;
      fieldUpdates.logoStorageKey = (profile as any).logoStorageKey;
    }

    if (existing) {
      // Append changelog
      changes.push({
        at: now,
        by: actorId,
        field: 'profile',
        from: 'Previous Profile',
        to: 'Self-Registered by Founder',
      });
      const founderSet = new Set(existing.founderMemberIds || []);
      founderSet.add(memberId);

      finalStartup = {
        ...existing,
        ...fieldUpdates,
        founderMemberIds: Array.from(founderSet),
        changeLog: [...(existing.changeLog || []), ...changes],
      };
      return cur.map(s => (s.id === existing.id ? finalStartup : s));
    } else {
      finalStartup = {
        id: sId,
        name: fieldUpdates.name!,
        tagline: fieldUpdates.tagline,
        logoUrl: fieldUpdates.logoUrl,
        logoStorageKey: fieldUpdates.logoStorageKey,
        sector: fieldUpdates.sector,
        stage: fieldUpdates.stage,
        technology: fieldUpdates.solution ? 'Proprietary Technology' : undefined,
        legalStatus: 'Not incorporated',
        website: fieldUpdates.website,
        aboutUs: fieldUpdates.aboutUs,
        problem: fieldUpdates.problem,
        solution: fieldUpdates.solution,
        foundedYear: fieldUpdates.foundedYear,
        teamSize: fieldUpdates.teamSize,
        location: fieldUpdates.location,
        socials: fieldUpdates.socials,
        profileCompletedAt: now,
        status: 'Applicant',
        pathway: 'Long-term (~12 months)' as StartupPathway,
        founderMemberIds: [memberId],
        consent: { externalDisclosure: false, photos: false, caseStudies: false },
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        changeLog: [
          {
            at: now,
            by: actorId,
            field: 'initial_registration',
            from: null,
            to: `Registered via portal with ID ${sId}`,
          },
        ],
      };
      return [finalStartup, ...cur];
    }
  });

  // 3. Update the member credentials in the User Directory (`members` collection)
  // Ensures only credentials and startupId live in the user directory
  let updatedMember: any = null;
  await mutateCollection('members', (cur) =>
    (cur || []).map((m: any) => {
      if (m.id === memberId) {
        // Strip heavy company profile data from member record to keep User Directory clean
        const { startupProfile: _oldProfile, ...rest } = m;
        updatedMember = {
          ...rest,
          startupId: finalStartup.id,
          tier: 4,
          role: 'Startup',
          division: 'Startup',
          status: m.status || 'Active',
          hasPassword: true,
          ...(phone ? { phone, cardPhone: m.cardPhone || phone } : {}),
        };
        return updatedMember;
      }
      return m;
    })
  );

  return { startup: finalStartup, member: updatedMember };
}

/**
 * Scans all startups in the Startup Registry and all tier-4 accounts in the User Directory,
 * repairing broken or missing links so both modules remain fully synchronized.
 */
export async function syncAllStartupsAndCredentials(): Promise<{
  linkedMembers: number;
  createdStartups: number;
  totalStartups: number;
  totalStartupCredentials: number;
  details: string[];
}> {
  const [startups, members] = await Promise.all([
    readCollection<Startup>('startups'),
    readCollection<any>('members'),
  ]);

  const startupMembers = members.filter((m: any) => m.tier === 4 || m.role?.toLowerCase().includes('startup'));
  const details: string[] = [];
  let linkedMembers = 0;
  let createdStartups = 0;
  const now = new Date().toISOString();

  const startupMap = new Map<string, Startup>(startups.map(s => [s.id, s]));
  const updatedMembersList = [...members];
  let memberMutated = false;

  // 1. Ensure all startup credentials have valid startupId and are present in founderMemberIds
  for (const m of startupMembers) {
    let linkedStartup: Startup | undefined;

    if (m.startupId && startupMap.has(m.startupId)) {
      linkedStartup = startupMap.get(m.startupId);
    } else {
      // Find startup by founderMemberIds
      linkedStartup = Array.from(startupMap.values()).find(s =>
        Array.isArray(s.founderMemberIds) && s.founderMemberIds.includes(m.id)
      );
    }

    if (!linkedStartup && m.name) {
      // Match by name or startupProfile.startupName
      const possibleName = (m.startupProfile?.startupName || m.name || '').trim().toLowerCase();
      linkedStartup = Array.from(startupMap.values()).find(s => s.name?.trim().toLowerCase() === possibleName);
    }

    if (!linkedStartup) {
      // Create a registry record for this startup account so it is registered in the Startup Registry
      const newId = nextStartupId(Array.from(startupMap.keys()));
      const sName = m.startupProfile?.startupName || m.name || `Startup ${newId}`;
      const newStartup: Startup = {
        id: newId,
        name: sName,
        tagline: m.startupProfile?.tagline,
        logoUrl: m.startupProfile?.logoUrl,
        logoStorageKey: m.startupProfile?.logoStorageKey,
        sector: m.startupProfile?.sector || 'Other',
        stage: m.startupProfile?.stage || 'Idea',
        technology: m.startupProfile?.solution ? 'Proprietary Technology' : undefined,
        legalStatus: 'Not incorporated',
        website: m.startupProfile?.website,
        aboutUs: m.startupProfile?.aboutUs || '',
        problem: m.startupProfile?.problem,
        solution: m.startupProfile?.solution,
        foundedYear: m.startupProfile?.foundedYear,
        teamSize: m.startupProfile?.teamSize,
        location: m.startupProfile?.location,
        socials: m.startupProfile?.socials,
        profileCompletedAt: m.startupProfile?.completedAt || now,
        status: 'Applicant',
        pathway: 'Long-term (~12 months)',
        founderMemberIds: [m.id],
        consent: { externalDisclosure: false, photos: false, caseStudies: false },
        createdAt: now,
        createdBy: 'system_sync',
        updatedAt: now,
        changeLog: [{ at: now, by: 'system_sync', field: 'auto_sync', from: null, to: `Auto-registered from credential ${m.id}` }],
      };
      startupMap.set(newId, newStartup);
      linkedStartup = newStartup;
      createdStartups++;
      details.push(`Created registry record ${newId} ("${sName}") for user credential ${m.email}`);
    }

    // Ensure bidirectional link
    if (linkedStartup) {
      if (m.startupId !== linkedStartup.id) {
        const idx = updatedMembersList.findIndex((x: any) => x.id === m.id);
        if (idx !== -1) {
          const { startupProfile: _stripped, ...rest } = updatedMembersList[idx];
          updatedMembersList[idx] = { ...rest, startupId: linkedStartup.id, tier: 4, role: 'Startup' };
          memberMutated = true;
          linkedMembers++;
          details.push(`Linked member ${m.email} (${m.id}) to startup registry ${linkedStartup.id}`);
        }
      }

      if (!linkedStartup.founderMemberIds.includes(m.id)) {
        linkedStartup.founderMemberIds = [...linkedStartup.founderMemberIds, m.id];
        startupMap.set(linkedStartup.id, linkedStartup);
        details.push(`Added member ${m.id} to founder accounts for startup ${linkedStartup.id}`);
      }
    }
  }

  // 2. Persist any mutations
  if (createdStartups > 0 || details.some(d => d.includes('founder accounts'))) {
    await mutateCollection<Startup>('startups', () => Array.from(startupMap.values()));
  }

  if (memberMutated) {
    await mutateCollection('members', () => updatedMembersList);
  }

  return {
    linkedMembers,
    createdStartups,
    totalStartups: startupMap.size,
    totalStartupCredentials: startupMembers.length,
    details,
  };
}
