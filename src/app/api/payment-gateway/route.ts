import { NextResponse } from 'next/server';
import { requireSession, requirePermission } from '@/lib/session';
import { isSuperUser } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { KEY_ID_PATTERN, razorpayMode, readRazorpayRow, saveRazorpayRow } from '@/lib/razorpay-server';

/** What the Settings form needs. Secrets are never returned — only whether they are saved. */
async function view() {
  const row = await readRazorpayRow();
  return {
    enabled: !!row.enabled,
    keyId: row.keyId || '',
    hasKeySecret: !!row.keySecret,
    hasWebhookSecret: !!row.webhookSecret,
    mode: row.keyId ? razorpayMode(row.keyId) : null,
    updatedAt: row.updatedAt || null,
    updatedBy: row.updatedBy || null,
  };
}

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(isSuperUser(actor), 'Only a Super User can view payment gateway settings.');
    return NextResponse.json(await view());
  } catch (err) {
    return apiError(err, 'payment-gateway-get');
  }
}

/**
 * Save Razorpay credentials. Omitted / blank secrets keep what is stored (so the form can start blank);
 * `clearWebhookSecret: true` removes the webhook secret. Turning the gateway on needs a Key ID and Key Secret.
 */
export async function PUT(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(isSuperUser(actor), 'Only a Super User can change payment gateway settings.');
    const b = await request.json();
    const current = await readRazorpayRow();
    const patch: Record<string, unknown> = {};

    if (typeof b.keyId === 'string' && b.keyId.trim()) {
      const keyId = b.keyId.trim();
      if (!KEY_ID_PATTERN.test(keyId)) throw new Error('The Key ID should look like rzp_test_xxxxxxxx or rzp_live_xxxxxxxx.');
      patch.keyId = keyId;
    }
    if (typeof b.keySecret === 'string' && b.keySecret.trim()) patch.keySecret = b.keySecret.trim().slice(0, 200);
    if (typeof b.webhookSecret === 'string' && b.webhookSecret.trim()) patch.webhookSecret = b.webhookSecret.trim().slice(0, 200);
    if (b.clearWebhookSecret === true) patch.webhookSecret = '';
    if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;

    const merged = { ...current, ...patch } as { keyId?: string; keySecret?: string; enabled?: boolean };
    if (merged.enabled && (!merged.keyId || !merged.keySecret)) throw new Error('Enter the Key ID and Key Secret before turning online payments on.');

    await saveRazorpayRow({ ...patch, updatedAt: new Date().toISOString(), updatedBy: actor.name });
    return NextResponse.json(await view());
  } catch (err) {
    return apiError(err, 'payment-gateway-put', 400);
  }
}
