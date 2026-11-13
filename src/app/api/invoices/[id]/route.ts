import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canManageBilling } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { bad, str, num, isoDay, cleanLines } from '@/lib/billing-server';
import { invoiceTotal, type Invoice, type Payment } from '@/lib/billing';

/**
 * PATCH (staff only):
 *   { action: 'void' }                          — cancel an invoice nobody has paid
 *   { lines?, discount?, dueDate?, notes? }     — revise the breakup while nothing has been paid or submitted
 * Dates/notes can always be changed; amounts are locked once a payment exists.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSession(request);
    requirePermission(canManageBilling(actor), 'Only staff can edit invoices.');
    const { id } = await params;
    const b = await request.json();
    const payments = (await readCollection<Payment>('payments')).filter(p => p.invoiceId === id && p.status !== 'Rejected');

    let updated!: Invoice;
    await mutateCollection<Invoice>('invoices', (cur) => {
      const idx = cur.findIndex(i => i.id === id);
      if (idx === -1) bad('Invoice not found.');
      const inv = cur[idx];
      if (inv.status === 'Void') bad('This invoice is void.');
      let next: Invoice = { ...inv };
      if (b.action === 'void') {
        if (payments.length) bad('Payments exist against this invoice — reject them first, or leave the invoice as is.');
        next = { ...next, status: 'Void', voidedAt: new Date().toISOString() };
      } else {
        if (b.lines !== undefined || b.discount !== undefined) {
          if (payments.length) bad('Amounts are locked because a payment has been submitted. Void the payment first.');
          if (b.lines !== undefined) next.lines = cleanLines(b.lines);
          if (b.discount !== undefined) next.discount = Math.max(0, num(b.discount));
          if (invoiceTotal(next) <= 0) bad('Invoice total must be greater than zero.');
        }
        if (b.dueDate !== undefined) {
          next.dueDate = isoDay(b.dueDate, inv.dueDate);
          if (next.dueDate < next.issueDate) bad('Due date cannot be before the issue date.');
        }
        if (b.notes !== undefined) next.notes = str(b.notes, 1000);
      }
      updated = next;
      const out = [...cur];
      out[idx] = next;
      return out;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return apiError(err, 'invoices-patch', 400);
  }
}
