import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { deleteStoredFile } from '@/lib/file-storage';
import { requireSession, requirePermission } from '@/lib/session';
import { canDeleteExpense } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const existing = (await readCollection<any>('expenses')).find((e: any) => e.id === id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requirePermission(canDeleteExpense(actor, existing), 'You can only delete expenses you booked yourself.');

    await mutateCollection('expenses', (current) => current.filter((e: any) => e.id !== id));
    for (const f of existing.billFiles || []) {
      if (f?.storageKey) await deleteStoredFile(f.storageKey).catch(() => {});
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'expenses-id-api-delete', 500);
  }
}
