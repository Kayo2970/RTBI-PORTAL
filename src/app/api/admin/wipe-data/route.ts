import { NextResponse } from 'next/server';
import { wipeAllData } from '@/lib/server-db';
import { getSessionMember } from '@/lib/session';
import { isSuperUser } from '@/lib/permissions';
import { apiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/wipe-data
 * Wipes all application collections, uploads, and in-memory caches.
 * Allowed when running on localhost or called by an authenticated Super User.
 */
export async function POST(request: Request) {
  try {
    const host = request.headers.get('host') || '';
    const isLocalhost =
      host.includes('localhost') ||
      host.includes('127.0.0.1') ||
      host.includes('[::1]');

    if (!isLocalhost) {
      const actor = await getSessionMember(request);
      if (!actor || !isSuperUser(actor)) {
        return NextResponse.json(
          { error: 'Forbidden. Wipe data is restricted to localhost or Super User.' },
          { status: 403 }
        );
      }
    }

    await wipeAllData();

    return NextResponse.json({
      success: true,
      message: 'All application memory and data collections have been wiped clean.',
    });
  } catch (err: any) {
    return apiError(err, 'admin-wipe-data', 500);
  }
}
