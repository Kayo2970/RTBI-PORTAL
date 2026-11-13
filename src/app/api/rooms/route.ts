import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canManageRooms } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { cleanRoom } from '@/lib/billing-server';
import type { Room } from '@/lib/billing';

export async function GET(request: Request) {
  try {
    await requireSession(request);
    return NextResponse.json(await readCollection<Room>('rooms'));
  } catch (err) {
    return apiError(err, 'rooms-get');
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(canManageRooms(actor), 'Only staff can add boardrooms.');
    const room = cleanRoom(await request.json());
    await mutateCollection<Room>('rooms', (cur) => [...cur, room]);
    return NextResponse.json(room, { status: 201 });
  } catch (err) {
    return apiError(err, 'rooms-post', 400);
  }
}
