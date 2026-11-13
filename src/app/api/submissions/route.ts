import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { hasLockedDefault, resolveFieldDefault, isFormClosed } from '@/lib/local-data';
import { getFormEventInfo } from '@/lib/public-form';
import { getAccessLevelSettingsServer } from '@/lib/permissions-server';
import { visibleSubmissionsFor } from '@/lib/forms-visibility';

// GET (listing collected responses) is member-only. POST is deliberately left
// ungated: forms are filled out publicly at src/app/forms/[slug]/page.tsx by
// non-members with no session at all (addSubmission() in local-data.ts even
// logs the actor as "Public Respondent") — this is a genuine public form
// intake endpoint, not an oversight.
export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    const items = await readCollection<any>('submissions');
    // Training Associates only see responses to forms they created.
    return NextResponse.json(visibleSubmissionsFor(items, await readCollection<any>('forms'), actor, settings));
  } catch (err: any) {
    return apiError(err, 'submissions-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    const item = await request.json();
    // Locked defaults are enforced here as well as in the browser: whatever the respondent's client sent for a
    // locked, pre-filled question is replaced by the form's own value.
    const form = (await readCollection<any>('forms')).find((f: any) => f.id === item.formId);
    // Past the form's close time: refuse the response so a tab left open (or a direct API call) can't submit late.
    if (form && isFormClosed(form)) {
      return NextResponse.json({ error: 'This form is currently closed.', code: 'FORM_CLOSED' }, { status: 410 });
    }
    if (form && Array.isArray(form.fields)) {
      const eventInfo = await getFormEventInfo(form);
      const data: Record<string, any> = { ...(item.data || {}) };
      for (const f of form.fields) {
        if (!hasLockedDefault(f)) continue;
        const v = resolveFieldDefault(f, eventInfo);
        const filled = f.type === 'checkbox' ? v === true : Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '';
        if (filled) data[f.id] = f.type === 'scale' ? Number(v) : v;
      }
      item.data = data;
    }
    const updated = await mutateCollection('submissions', (current) => [item, ...current]);
    const created = updated.find((s: any) => s.id === item.id);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'submissions-api-post', 400);
  }
}
