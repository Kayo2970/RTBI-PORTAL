import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { apiError } from '@/lib/api-error';
import { getRazorpayConfig, settleInvoiceFromRazorpay, verifyWebhookSignature, SettleRejected, type RazorpayPayment } from '@/lib/razorpay-server';
import type { InvoiceItem } from '@/lib/finance';

/**
 * Razorpay → portal callback (Dashboard → Webhooks, events payment.captured and order.paid). Authenticated only by the
 * X-Razorpay-Signature HMAC over the RAW body, so the body is read as text before any parsing. It settles invoices whose
 * browser never came back (closed tab, lost connection); replays are harmless because settling is idempotent.
 * 2xx = "stop retrying". Only genuinely transient failures return 5xx.
 */
export async function POST(request: Request) {
  try {
    const cfg = await getRazorpayConfig(false);
    if (!cfg?.webhookSecret) return NextResponse.json({ error: 'Webhook secret is not configured.' }, { status: 503 });

    const raw = await request.text();
    if (!verifyWebhookSignature(raw, request.headers.get('x-razorpay-signature') || '', cfg.webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
    }

    let event: any;
    try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Malformed body.' }, { status: 400 }); }
    if (event?.event !== 'payment.captured' && event?.event !== 'order.paid') return NextResponse.json({ ok: true, ignored: event?.event || 'unknown' });

    const rp: RazorpayPayment | undefined = event?.payload?.payment?.entity;
    if (!rp?.id) return NextResponse.json({ ok: true, ignored: 'no payment entity' });

    const notes = rp.notes && !Array.isArray(rp.notes) ? rp.notes : {};
    const invoices = await readCollection<InvoiceItem>('invoices');
    const inv = invoices.find(i => i.id === notes.invoiceId) || invoices.find(i => i.gatewayOrder?.orderId && i.gatewayOrder.orderId === rp.order_id);
    if (!inv) return NextResponse.json({ ok: true, ignored: 'not an invoice payment' });

    try {
      const r = await settleInvoiceFromRazorpay(inv.id, rp);
      return NextResponse.json({ ok: true, invoice: inv.invoiceNumber, alreadySettled: r.alreadySettled });
    } catch (e) {
      if (e instanceof SettleRejected) {
        console.warn('[razorpay-webhook] not settled:', e.message);
        return NextResponse.json({ ok: false, note: e.message });
      }
      throw e;
    }
  } catch (err) {
    return apiError(err, 'razorpay-webhook', 500);
  }
}
