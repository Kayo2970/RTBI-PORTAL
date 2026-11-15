import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { canManageBilling } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { bad, str, num, isoDay, todayISO, syncInvoiceStatus } from '@/lib/billing-server';
import { PAYMENT_METHODS, invoiceTotal, amountCommitted, type Invoice, type Payment, type PaymentMethod } from '@/lib/billing';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const all = await readCollection<Payment>('payments');
    if (canManageBilling(actor)) return NextResponse.json(all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    const mine = new Set((await readCollection<Invoice>('invoices')).filter(i => i.customerId === actor.id).map(i => i.id));
    return NextResponse.json(all.filter(p => mine.has(p.invoiceId) || p.submittedById === actor.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  } catch (err) {
    return apiError(err, 'payments-get');
  }
}

/**
 * Pay (or record a payment against) an invoice.
 *  - The invoice's customer submits what they paid + the UTR/reference → "Pending Verification".
 *  - Staff recording a payment they received (cash, cheque, etc.) → verified straight away.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const staff = canManageBilling(actor);
    const b = await request.json();
    const invoice = (await readCollection<Invoice>('invoices')).find(i => i.id === b.invoiceId);
    if (!invoice) bad('Invoice not found.');
    if (!staff && invoice.customerId !== actor.id) bad('You can only pay your own invoices.');
    if (invoice.status === 'Void') bad('This invoice has been voided.');
    if (invoice.status === 'Paid') bad('This invoice is already fully paid.');

    const method = b.method as PaymentMethod;
    if (!PAYMENT_METHODS.includes(method)) bad('Choose a payment method.');
    const amount = Math.round(num(b.amount) * 100) / 100;
    if (amount <= 0) bad('Enter the amount paid.');
    const reference = str(b.reference, 80);
    if (!reference && method !== 'Cash') bad('Enter the transaction / UTR / cheque reference so we can match your payment.');

    const now = new Date().toISOString();
    const payment: Payment = {
      id: 'pay_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      invoiceId: invoice.id, invoiceNumber: invoice.number,
      amount, method, reference,
      paidOn: isoDay(b.paidOn, todayISO()),
      note: str(b.note, 300),
      status: staff ? 'Verified' : 'Pending Verification',
      submittedById: actor.id, submittedByName: actor.name,
      createdAt: now,
      ...(staff ? { reviewedById: actor.id, reviewedByName: actor.name, reviewedAt: now } : {}),
    };

    // Re-check the outstanding balance under the payments lock so concurrent
    // submissions can't together exceed what is due.
    await mutateCollection<Payment>('payments', (cur) => {
      const outstanding = Math.round((invoiceTotal(invoice) - amountCommitted(invoice.id, cur)) * 100) / 100;
      if (amount > outstanding + 0.005) bad(`Only ₹${outstanding.toFixed(2)} is outstanding on ${invoice.number}.`);
      if (reference && cur.some(p => p.status !== 'Rejected' && p.reference.toLowerCase() === reference.toLowerCase() && p.method === method)) {
        bad('A payment with this reference has already been submitted.');
      }
      return [...cur, payment];
    });
    await syncInvoiceStatus(invoice.id);
    return NextResponse.json(payment, { status: 201 });
  } catch (err) {
    return apiError(err, 'payments-post', 400);
  }
}
