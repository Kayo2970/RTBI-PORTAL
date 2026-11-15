import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canManageRooms } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { bad, cleanRoom } from '@/lib/billing-server';
import type { Room, Booking } from '@/lib/billing';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSession(request);
    requirePermission(canManageRooms(actor), 'Only staff can edit boardrooms.');
    const { id } = await params;
    const body = await request.json();
    let updated!: Room;
    await mutateCollection<Room>('rooms', (cur) => {
      const idx = cur.findIndex(r => r.id === id);
      if (idx === -1) bad('Room not found.');
      updated = cleanRoom({ ...cur[idx], ...body }, cur[idx]);
      const next = [...cur];
      next[idx] = updated;
      return next;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return apiError(err, 'rooms-patch', 400);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSession(request);
    requirePermission(canManageRooms(actor), 'Only staff can remove boardrooms.');
    const { id } = await params;
    const bookings = await readCollection<Booking>('bookings');
    const now = Date.now();
    if (bookings.some(b => b.roomId === id && b.status === 'Confirmed' && new Date(b.end).getTime() > now)) {
      bad('This room has upcoming bookings. Cancel them first, or deactivate the room instead.');
    }
    await mutateCollection<Room>('rooms', (cur) => cur.filter(r => r.id !== id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, 'rooms-delete', 400);
  }
}
