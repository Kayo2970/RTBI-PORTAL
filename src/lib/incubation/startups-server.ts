import { readCollection } from '../server-db';
import { canViewAllStartupsServer } from '../permissions-server';
import type { Startup } from './types';
import type { Member } from '../local-data';

/** Startups the actor may see: everyone for staff/granted users; tier-4 users only startups they are linked to as founders. */
export async function visibleStartupsFor(actor: any): Promise<Startup[]> {
  const all = await readCollection<Startup>('startups');
  if (await canViewAllStartupsServer(actor)) return all;
  return all.filter(s => s.founderMemberIds?.includes(actor.id));
}

export async function canSeeStartup(actor: any, s: Startup): Promise<boolean> {
  return (await canViewAllStartupsServer(actor)) || !!s.founderMemberIds?.includes(actor.id);
}

/** Keeps only active tier-4 members that exist — founders are always Startup-tier accounts. */
export async function validFounderIds(ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids)) return [];
  const members = await readCollection<Member>('members');
  const ok = new Set(members.filter(m => m.status !== 'Terminated' && m.tier === 4).map(m => m.id));
  return Array.from(new Set(ids.filter((i): i is string => typeof i === 'string' && ok.has(i))));
}

