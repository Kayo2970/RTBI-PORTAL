import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession(request);
    const { id } = await params;
    await mutateCollection('clients', (current: any[] = []) => current.filter(c => c.id !== id));
    return NextResponse.json({ success: true, deletedId: id });
  } catch (err: any) {
    return apiError(err, 'clients-delete', 400);
  }
}

