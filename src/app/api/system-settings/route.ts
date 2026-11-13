import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { isSuperUser } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

// Every signed-in member's client reads this (dashboard-shell.tsx polls it to
// know whether site-wide lockdown is on), so GET only needs a valid session —
// not Super User. Only changing it (POST) is Super-User-only.
export async function GET(request: Request) {
  try {
    await requireSession(request);
    const items = await readCollection('systemSettings');
    return NextResponse.json(items);
  } catch (err: any) {
    return apiError(err, 'system-settings-api-get', 500);
  }
}

// Always exactly one record — POST replaces it wholesale rather than
// appending, since there's nothing to key multiple records by.
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(isSuperUser(actor), 'Only a Super User can update System Settings.');

    const item = await request.json();
    const updated = await mutateCollection('systemSettings', () => [{ ...item, id: 'default' }]);
    return NextResponse.json(updated[0], { status: 200 });
  } catch (err: any) {
    return apiError(err, 'system-settings-api-post', 400);
  }
}
