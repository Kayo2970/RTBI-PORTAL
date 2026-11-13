import { NextResponse } from 'next/server';
import { mutateCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { getAccessLevelSettingsServer, canBuildForms } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { initialFormTemplates } from '@/lib/local-data';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canBuildForms(actor, settings)) throw new ForbiddenError();
    const { id } = await params;

    const body = await request.json();
    // Built-in templates can be edited (saved as a `customized` copy) or deleted (a `deleted` marker row, so
    // server-db.ts's boot-time re-seed of a missing built-in doesn't bring it back). Upsert for built-in ids.
    const builtIn = initialFormTemplates.find(t => t.id === id);
    let found = false;
    const updated = await mutateCollection('formTemplates', (current) => {
      const idx = current.findIndex((t: any) => t.id === id);
      if (idx === -1) {
        if (!builtIn) return current;
        found = true;
        return [{ ...builtIn, ...body, id }, ...current];
      }
      found = true;
      const next = [...current];
      next[idx] = { ...next[idx], ...body, id };
      return next;
    });
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(updated.find((t: any) => t.id === id));
  } catch (err: any) {
    return apiError(err, 'form-templates-id-api-patch', 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canBuildForms(actor, settings)) throw new ForbiddenError();
    const { id } = await params;
    let found = false;
    await mutateCollection('formTemplates', (current) => {
      const filtered = current.filter((t: any) => t.id !== id);
      found = filtered.length < current.length;
      return filtered;
    });
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'form-templates-id-api-delete', 500);
  }
}
