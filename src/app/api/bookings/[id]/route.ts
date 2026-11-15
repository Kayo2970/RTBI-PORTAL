import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { bad } from '@/lib/billing-server';
import { isStaffTier } from '@/lib/permissions-server';
import type { Booking, Invoice, Payment } from '@/lib/billing';

/** PATCH { action: 'cancel' } — the booker (before it starts) or any staff member. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const body = await request.json();
    if (body.action !== 'cancel') bad('Unsupported action.');

    const existing = (await readCollection<Booking>('bookings')).find(b => b.id === id);
    if (!existing) bad('Booking not found.');
    const staff = isStaffTier(actor);
    requirePermission(staff || existing.bookedById === actor.id, 'You can only cancel your own bookings.');
    if (existing.status === 'Cancelled') bad('This booking is already cancelled.');
    if (!staff && new Date(existing.start).getTime() <= Date.now()) bad('A booking that has already started can only be cancelled by staff.');

    let updated!: Booking;
    await mutateCollection<Booking>('bookings', (cur) =>
      cur.map(b => (b.id === id ? (updated = { ...b, status: 'Cancelled', cancelledAt: new Date().toISOString() }) : b))
    );

    // Void the invoice only when nobody has paid (or tried to pay) against it.
    let invoiceNote: string | undefined;
    if (existing.invoiceId) {
      const payments = await readCollection<Payment>('payments');
      const touched = payments.some(p => p.invoiceId === existing.invoiceId && p.status !== 'Rejected');
      if (touched) {
        invoiceNote = 'A payment exists against this booking\'s invoice — staff must review it (refund or void) from Invoices & Payments.';
      } else {
        await mutateCollection<Invoice>('invoices', (cur) =>
          cur.map(i => (i.id === existing.invoiceId ? { ...i, status: 'Void', voidedAt: new Date().toISOString() } : i))
        );
      }
    }
    return NextResponse.json({ booking: updated, invoiceNote });
  } catch (err) {
    return apiError(err, 'bookings-patch', 400);
  }
}
