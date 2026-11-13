import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { bad, str, num, createInvoice } from '@/lib/billing-server';
import { isStaffTier } from '@/lib/permissions-server';
import { Booking, Room, rangesOverlap, billableHours } from '@/lib/billing';

const MAX_HOURS = 12;

function fmtRange(start: string, end: string): string {
  const o: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' };
  const t: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true };
  const s = new Date(start), e = new Date(end);
  return `${s.toLocaleDateString('en-IN', o)}, ${s.toLocaleTimeString('en-IN', t)} – ${e.toLocaleTimeString('en-IN', t)} IST`;
}

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const all = await readCollection<Booking>('bookings');
    if (isStaffTier(actor)) return NextResponse.json(all);
    // Everyone can see which slots are taken; only the booker (and staff) see the details.
    return NextResponse.json(
      all.map(b =>
        b.bookedById === actor.id
          ? b
          : { id: b.id, roomId: b.roomId, roomName: b.roomName, start: b.start, end: b.end, status: b.status, title: 'Booked', bookedById: '', bookedByName: '', bookedByEmail: '', createdAt: b.createdAt }
      )
    );
  } catch (err) {
    return apiError(err, 'bookings-get');
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const b = await request.json();
    const rooms = await readCollection<Room>('rooms');
    const room = rooms.find(r => r.id === b.roomId);
    if (!room || !room.active) bad('That boardroom is not available for booking.');
    const startMs = new Date(b.start).getTime();
    const endMs = new Date(b.end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) bad('Choose a valid start and end time.');
    if (endMs <= startMs) bad('End time must be after the start time.');
    if (startMs < Date.now() - 5 * 60_000) bad('You cannot book a time slot in the past.');
    if ((endMs - startMs) / 3_600_000 > MAX_HOURS) bad(`A single booking can be at most ${MAX_HOURS} hours.`);
    const title = str(b.title, 120);
    if (!title) bad('Give the booking a title or purpose.');
    const attendees = Math.max(0, Math.round(num(b.attendees)));
    if (attendees > room.capacity) bad(`${room.name} seats ${room.capacity} people.`);

    const start = new Date(startMs).toISOString();
    const end = new Date(endMs).toISOString();
    const booking: Booking = {
      id: 'bk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      roomId: room.id, roomName: room.name, start, end, title, attendees,
      notes: str(b.notes, 500),
      organisation: str(b.organisation, 120),
      bookedById: actor.id, bookedByName: actor.name, bookedByEmail: actor.email,
      status: 'Confirmed',
      createdAt: new Date().toISOString(),
    };

    // Conflict check + insert happen together under the collection lock, so two
    // people racing for the same slot can't both succeed.
    await mutateCollection<Booking>('bookings', (cur) => {
      const clash = cur.find(x => x.roomId === room.id && x.status === 'Confirmed' && rangesOverlap(x.start, x.end, start, end));
      if (clash) bad(`${room.name} is already booked for part of that time. Pick another slot.`);
      return [...cur, booking];
    });

    if (room.hourlyRate > 0) {
      try {
        const hours = billableHours(start, end);
        const inv = await createInvoice(
          {
            customerId: actor.id, customerName: actor.name, customerEmail: actor.email,
            customerOrganisation: booking.organisation,
            lines: [{
              description: `${room.name} boardroom — ${fmtRange(start, end)} (${hours} hr${hours === 1 ? '' : 's'})`,
              quantity: hours, unitPrice: room.hourlyRate, taxPercent: room.gstPercent,
            }],
            source: 'Booking', bookingId: booking.id,
            notes: `Booking: ${title}`,
          },
          { id: actor.id, name: actor.name }
        );
        booking.invoiceId = inv.id;
        await mutateCollection<Booking>('bookings', (cur) => cur.map(x => (x.id === booking.id ? { ...x, invoiceId: inv.id } : x)));
      } catch (e) {
        // Don't leave a confirmed booking behind that has no invoice.
        await mutateCollection<Booking>('bookings', (cur) => cur.filter(x => x.id !== booking.id));
        throw e;
      }
    }
    return NextResponse.json(booking, { status: 201 });
  } catch (err) {
    return apiError(err, 'bookings-post', 400);
  }
}
