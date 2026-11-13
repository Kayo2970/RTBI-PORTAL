import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canEditRating, getAccessLevelSettingsServer } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const settings = await getAccessLevelSettingsServer();
    const existing = await readCollection<any>('ratings');
    const target = existing.find((r: any) => r.id === id) || null;
    // A not-yet-existent id (client-bundled sample/seed data never POSTed)
    // has no author to check ownership against — canEditRating then only
    // allows the Super User/Centre Head, which is the safe default here.
    requirePermission(canEditRating(target, actor, settings), 'You do not have permission to edit this rating.');
    const updates = await request.json();
    // Upsert: if this id isn't in the server's collection yet (e.g. client-bundled
    // sample/seed data never POSTed), create it instead of 404ing and silently
    // dropping the edit.
    const updatedAt = new Date().toISOString().split('T')[0];
    const updated = await mutateCollection('ratings', (current) => {
      const idx = current.findIndex((item: any) => item.id === id);
      if (idx === -1) return [...current, { id, ...updates, updatedAt }];
      const next = [...current];
      next[idx] = { ...next[idx], ...updates, updatedAt };
      return next;
    });
    return NextResponse.json(updated.find((r: any) => r.id === id));
  } catch (err: any) {
    return apiError(err, 'ratings-id-api-patch', 400);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const settings = await getAccessLevelSettingsServer();
    const existing = await readCollection<any>('ratings');
    const target = existing.find((r: any) => r.id === id);
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requirePermission(canEditRating(target, actor, settings), 'You do not have permission to delete this rating.');
    let found = false;
    await mutateCollection('ratings', (current) => {
      const filtered = current.filter((r: any) => r.id !== id);
      found = filtered.length < current.length;
      return filtered;
    });
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'ratings-id-api-delete', 500);
  }
}
