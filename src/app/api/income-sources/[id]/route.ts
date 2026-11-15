import { NextResponse } from 'next/server';
import { mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canManageIncome } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

async function canManageIncomeSources(actor: any) {
  return canManageIncome(actor);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    requirePermission(await canManageIncomeSources(actor), 'You do not have permission to update income sources.');

    const { id } = await params;
    const updates = await request.json();

    let updatedItem: any = null;
    await mutateCollection('incomeSources', (current) => {
      const idx = current.findIndex((i: any) => i.id === id);
      if (idx >= 0 && current[idx].source === 'invoice') throw new Error('Income booked from an invoice cannot be edited here — it follows its invoice.');
      if (idx >= 0) {
        const { source, invoiceId, invoiceNumber, ...safe } = updates || {};
        current[idx] = { ...current[idx], ...safe };
        updatedItem = current[idx];
      }
      return [...current];
    });

    if (!updatedItem) {
      return NextResponse.json({ error: 'Income source item not found.' }, { status: 404 });
    }

    return NextResponse.json(updatedItem);
  } catch (err: any) {
    return apiError(err, 'income-sources-id-api-patch', 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    requirePermission(await canManageIncomeSources(actor), 'You do not have permission to delete income sources.');

    const { id } = await params;
    await mutateCollection('incomeSources', (current) => {
      if (current.some((i: any) => i.id === id && i.source === 'invoice')) throw new Error('Income booked from an invoice cannot be deleted here.');
      return current.filter((i: any) => i.id !== id);
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'income-sources-id-api-delete', 500);
  }
}
