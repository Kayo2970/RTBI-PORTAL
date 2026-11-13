import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canManageBilling } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { bad, str, syncInvoiceStatus } from '@/lib/billing-server';
import type { Payment } from '@/lib/billing';

/** PATCH { action: 'verify' | 'reject', reason? } — staff confirm that the money actually arrived (or not). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSession(request);
    requirePermission(canManageBilling(actor), 'Only staff can verify payments.');
    const { id } = await params;
    const b = await request.json();
    if (b.action !== 'verify' && b.action !== 'reject') bad('Unsupported action.');
    const reason = str(b.reason, 300);
    if (b.action === 'reject' && !reason) bad('Give a reason for rejecting this payment.');

    let updated!: Payment;
    await mutateCollection<Payment>('payments', (cur) => {
      const idx = cur.findIndex(p => p.id === id);
      if (idx === -1) bad('Payment not found.');
      if (cur[idx].status !== 'Pending Verification') bad('This payment has already been reviewed.');
      updated = {
        ...cur[idx],
        status: b.action === 'verify' ? 'Verified' : 'Rejected',
        reviewedById: actor.id, reviewedByName: actor.name, reviewedAt: new Date().toISOString(),
        ...(b.action === 'reject' ? { rejectReason: reason } : {}),
      };
      const out = [...cur];
      out[idx] = updated;
      return out;
    });
    await syncInvoiceStatus(updated.invoiceId);
    return NextResponse.json(updated);
  } catch (err) {
    return apiError(err, 'payments-patch', 400);
  }
}
