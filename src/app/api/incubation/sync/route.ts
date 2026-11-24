import { NextResponse } from 'next/server';
import { requireSession, ForbiddenError } from '@/lib/session';
import { isInternalStaff } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { syncAllStartupsAndCredentials } from '@/lib/incubation/startup-registry-sync';
import { readCollection } from '@/lib/server-db';
import type { Startup } from '@/lib/incubation/types';

/**
 * GET /api/incubation/sync — Returns synchronization status between Startup Registry and User Credentials.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!isInternalStaff(actor)) throw new ForbiddenError('Only RTBI staff can view synchronisation status.');
    const [startups, members] = await Promise.all([
      readCollection<Startup>('startups'),
      readCollection<any>('members'),
    ]);

    const startupMembers = members.filter((m: any) => m.tier === 4 || m.role?.toLowerCase().includes('startup'));
    const linkedCount = startupMembers.filter((m: any) => m.startupId && startups.some(s => s.id === m.startupId)).length;
    const unlinkedCount = startupMembers.length - linkedCount;

    return NextResponse.json({
      totalStartups: startups.length,
      totalStartupCredentials: startupMembers.length,
      linkedCredentials: linkedCount,
      unlinkedCredentials: unlinkedCount,
      synchronized: unlinkedCount === 0,
    });
  } catch (err) {
    return apiError(err, 'incubation-sync-get', 500);
  }
}

/**
 * POST /api/incubation/sync — Executes bidirectional synchronization between Startup Registry and User Credentials.
 * Gated to Super User and CEO (tier <= 2).
 */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!actor || typeof actor.tier !== 'number' || actor.tier > 2) {
      throw new ForbiddenError('Only CEO or Super User can run Startup Registry synchronization.');
    }

    const result = await syncAllStartupsAndCredentials();
    return NextResponse.json({
      success: true,
      message: 'Startup Registry and User Credentials synchronized successfully.',
      ...result,
    });
  } catch (err) {
    return apiError(err, 'incubation-sync-post', 400);
  }
}
