import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import {
  capturePayment, fetchPayment, getRazorpayConfig, settleInvoiceFromRazorpay, verifyCheckoutSignature, SettleRejected,
} from '@/lib/razorpay-server';
import type { InvoiceItem } from '@/lib/finance';

/**
 * Verify a Checkout success and settle the invoice. Trust chain, all server-side:
 *  1. HMAC signature of order_id|payment_id with the Key Secret (proves Checkout produced it),
 *  2. the order is the one we opened for THIS invoice,
 *  3. Razorpay's own record shows that payment on that order, captured, for the full invoice amount.
 * Only then is the invoice marked Paid and the income booked.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession(request);
    const { id } = await params;
    const b = await request.json();
    const orderId = typeof b.razorpay_order_id === 'string' ? b.razorpay_order_id : '';
    const paymentId = typeof b.razorpay_payment_id === 'string' ? b.razorpay_payment_id : '';
    const signature = typeof b.razorpay_signature === 'string' ? b.razorpay_signature : '';
    if (!orderId || !paymentId || !signature) throw new Error('Incomplete payment details.');

    const cfg = await getRazorpayConfig();
    if (!cfg) throw new Error('Online payment is not enabled.');
    const inv = (await readCollection<InvoiceItem>('invoices')).find(i => i.id === id);
    if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    if (!inv.gatewayOrder || inv.gatewayOrder.orderId !== orderId) throw new Error('This payment does not belong to the order opened for this invoice.');
    if (!verifyCheckoutSignature(orderId, paymentId, signature, cfg.keySecret)) {
      return NextResponse.json({ error: 'Payment signature could not be verified. Nothing was recorded.' }, { status: 400 });
    }

    let rp = await fetchPayment(cfg, paymentId);
    if (rp.order_id !== orderId) throw new Error('Razorpay reports this payment against a different order.');
    if (rp.status === 'authorized') rp = await capturePayment(cfg, paymentId, rp.amount);
    if (rp.status !== 'captured') throw new Error(`The payment is ${rp.status}; it has not been completed.`);

    const { invoice, income, alreadySettled } = await settleInvoiceFromRazorpay(id, rp);
    return NextResponse.json({ invoice, income, alreadySettled });
  } catch (err) {
    if (err instanceof SettleRejected) return NextResponse.json({ error: err.message }, { status: 409 });
    return apiError(err, 'invoice-razorpay-verify', 400);
  }
}
