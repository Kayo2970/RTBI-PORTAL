import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { createOrder, getRazorpayConfig } from '@/lib/razorpay-server';
import type { InvoiceItem } from '@/lib/finance';

/** Open a Razorpay order for the invoice's full total. The amount always comes from the server-side invoice, never the client. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession(request);
    const { id } = await params;
    const cfg = await getRazorpayConfig();
    if (!cfg) throw new Error('Online payment is not enabled. A Super User can set it up in Settings → Integrations.');
    const inv = (await readCollection<InvoiceItem>('invoices')).find(i => i.id === id);
    if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    if (inv.status !== 'Issued' && inv.status !== 'Payment Recorded') throw new Error(`This invoice is ${inv.status.toLowerCase()} and cannot be paid online.`);

    const amountPaise = Math.round(inv.totalAmount * 100);
    if (amountPaise < 100) throw new Error('Razorpay needs an amount of at least ₹1.');
    const order = await createOrder(cfg, {
      amountPaise,
      receipt: inv.invoiceNumber.slice(0, 40),
      notes: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, client: inv.clientName.slice(0, 100) },
    });
    await mutateCollection<InvoiceItem>('invoices', (cur) =>
      cur.map(i => (i.id === id ? { ...i, gatewayOrder: { orderId: order.id, amount: order.amount, createdAt: new Date().toISOString() } } : i)));

    return NextResponse.json({
      keyId: cfg.keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      invoiceNumber: inv.invoiceNumber,
      prefill: { name: inv.clientName, email: inv.clientEmail || '' },
    });
  } catch (err) {
    return apiError(err, 'invoice-razorpay-order', 400);
  }
}
