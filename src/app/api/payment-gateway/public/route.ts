import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { getRazorpayConfig, razorpayMode } from '@/lib/razorpay-server';

/** For any signed-in member's browser: is online payment on, and the PUBLIC key id Checkout needs. Never the secret. */
export async function GET(request: Request) {
  try {
    await requireSession(request);
    const cfg = await getRazorpayConfig();
    return NextResponse.json(cfg ? { enabled: true, keyId: cfg.keyId, mode: razorpayMode(cfg.keyId) } : { enabled: false });
  } catch (err) {
    return apiError(err, 'payment-gateway-public-get');
  }
}
