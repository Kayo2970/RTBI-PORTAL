import { NextResponse } from 'next/server';
import { requireSession, requirePermission } from '@/lib/session';
import { isSuperUser } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { getRazorpayConfig, pingRazorpay, razorpayMode } from '@/lib/razorpay-server';

/** Super User only: makes one read-only authenticated call to Razorpay with the saved keys. */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(isSuperUser(actor), 'Only a Super User can test the payment gateway.');
    const cfg = await getRazorpayConfig(false);
    if (!cfg) return NextResponse.json({ ok: false, message: 'Save the Key ID and Key Secret first.' });
    try {
      await pingRazorpay(cfg);
      return NextResponse.json({ ok: true, mode: razorpayMode(cfg.keyId), message: `Razorpay accepted the keys (${razorpayMode(cfg.keyId)} mode).` });
    } catch (e: any) {
      return NextResponse.json({ ok: false, message: e?.message || 'Could not reach Razorpay.' });
    }
  } catch (err) {
    return apiError(err, 'payment-gateway-test');
  }
}
