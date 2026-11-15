import { NextResponse } from 'next/server';
import { mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canManageBilling } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { getBillingSettings, str, num } from '@/lib/billing-server';
import type { BillingSettings } from '@/lib/billing';

// Any signed-in member needs the payee details to pay an invoice.
export async function GET(request: Request) {
  try {
    await requireSession(request);
    return NextResponse.json(await getBillingSettings());
  } catch (err) {
    return apiError(err, 'billing-settings-get');
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(canManageBilling(actor), 'Only staff can change payment settings.');
    const b = await request.json();
    const next: BillingSettings = {
      id: 'default',
      businessName: str(b.businessName, 120) || 'RTBI',
      address: str(b.address, 400),
      gstin: str(b.gstin, 20).toUpperCase(),
      upiId: str(b.upiId, 80),
      bankName: str(b.bankName, 120),
      accountName: str(b.accountName, 120),
      accountNumber: str(b.accountNumber, 40),
      ifsc: str(b.ifsc, 20).toUpperCase(),
      terms: str(b.terms, 1000),
      defaultDueDays: Math.min(365, Math.max(0, Math.round(num(b.defaultDueDays, 7)))),
      updatedAt: new Date().toISOString(),
    };
    await mutateCollection('billingSettings', () => [next]);
    return NextResponse.json(next);
  } catch (err) {
    return apiError(err, 'billing-settings-put', 400);
  }
}
