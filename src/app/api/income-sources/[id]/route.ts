import { NextResponse } from 'next/server';
import { mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { getAccessLevelSettingsServer, isCentreHead, isFinanceHead } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

async function canManageIncomeSources(actor: any) {
  const settings = await getAccessLevelSettingsServer();
  return isCentreHead(actor, settings) || isFinanceHead(actor, settings) || actor?.tier === 1;
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
      if (idx >= 0) {
        current[idx] = { ...current[idx], ...updates };
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
    await mutateCollection('incomeSources', (current) => current.filter((i: any) => i.id !== id));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'income-sources-id-api-delete', 500);
  }
}
