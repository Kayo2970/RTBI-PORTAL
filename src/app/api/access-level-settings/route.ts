import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { isSuperUser } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(isSuperUser(actor), 'Only a Super User can view Access Level Settings.');
    const items = await readCollection('accessLevelSettings');
    return NextResponse.json(items);
  } catch (err: any) {
    return apiError(err, 'access-level-settings-api-get', 500);
  }
}

// Always exactly one record — POST replaces it wholesale rather than
// appending, since there's nothing to key multiple records by.
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(isSuperUser(actor), 'Only a Super User can update Access Level Settings.');

    const item = await request.json();
    const updated = await mutateCollection('accessLevelSettings', () => [{ ...item, id: 'default' }]);
    return NextResponse.json(updated[0], { status: 200 });
  } catch (err: any) {
    return apiError(err, 'access-level-settings-api-post', 400);
  }
}
