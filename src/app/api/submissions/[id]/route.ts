import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { getAccessLevelSettingsServer, canDeleteForms, seesOnlyOwnForms, isOwnForm } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

// Deleting a collected response: form deleters (Centre Head / Super User / FORMS edit grant), or a Training
// Associate on a response to a form they created.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    const { id } = await params;
    const sub = (await readCollection<any>('submissions')).find((s: any) => s.id === id);
    if (!sub) return NextResponse.json({ success: true });

    if (!(await canDeleteForms(actor, settings))) {
      const form = (await readCollection<any>('forms')).find(
        (f: any) => f.id === sub.formId || (!!sub.slug && String(f.slug || '').toLowerCase() === String(sub.slug).toLowerCase())
      );
      if (!(form && seesOnlyOwnForms(actor, settings) && isOwnForm(form, actor))) throw new ForbiddenError();
    }

    await mutateCollection('submissions', (current) => current.filter((s: any) => s.id !== id));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'submissions-api-delete', 500);
  }
}
