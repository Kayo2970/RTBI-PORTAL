import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canManageIncome } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

async function canManageIncomeSources(actor: any) {
  return canManageIncome(actor);
}

export async function GET(request: Request) {
  try {
    await requireSession(request); // finance is readable by every signed-in member
    const items = await readCollection('incomeSources');
    return NextResponse.json(items);
  } catch (err: any) {
    return apiError(err, 'income-sources-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(await canManageIncomeSources(actor), 'You do not have permission to add income sources.');

    const item = await request.json();
    // Invoice-sourced income is only ever created by verifying an invoice payment (see /api/invoices/[id]).
    item.source = 'manual';
    delete item.invoiceId; delete item.invoiceNumber; delete item.clientName; delete item.paymentMode; delete item.paymentReference;
    if (!item.id || !item.name || typeof item.amount !== 'number') {
      return NextResponse.json({ error: 'id, name, and numeric amount are required.' }, { status: 400 });
    }

    const updated = await mutateCollection('incomeSources', (current) => {
      const idx = current.findIndex((i: any) => i.id === item.id);
      if (idx >= 0 && current[idx].source === 'invoice') throw new Error('Invoice income can only change through its invoice.');
      if (idx >= 0) {
        current[idx] = item;
        return [...current];
      }
      return [item, ...current];
    });

    const created = updated.find((i: any) => i.id === item.id);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'income-sources-api-post', 500);
  }
}
