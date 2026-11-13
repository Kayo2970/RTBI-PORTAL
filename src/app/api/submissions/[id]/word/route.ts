import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { fillFeedbackFormDocx } from '@/lib/docx-fill';
import { FEEDBACK_FORM_TEMPLATE_ID } from '@/lib/local-data';

// NOTE: intentionally NOT gated with requireSession. The Forms dashboard
// triggers this download via `window.open(...)` (src/app/dashboard/forms/page.tsx),
// a plain browser navigation that cannot attach an Authorization header —
// gating this route would break the download outright. Same pattern/tradeoff
// as src/app/api/files/[...key]/route.ts. Its only real protection is the
// unguessability of the submission id in the URL.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const submissions = await readCollection<any>('submissions');
    const submission = submissions.find((s) => s.id === id);
    if (!submission) {
      return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
    }

    const forms = await readCollection<any>('forms');
    const form = forms.find((f) => f.id === submission.formId);
    if (!form) {
      return NextResponse.json({ error: 'The form this submission belongs to no longer exists.' }, { status: 404 });
    }
    if (form.sourceTemplateId !== FEEDBACK_FORM_TEMPLATE_ID) {
      return NextResponse.json({ error: 'This form was not built from the Feedback Form Template — a filled Word copy is only available for that template.' }, { status: 400 });
    }

    const buffer = await fillFeedbackFormDocx(form, submission);
    const fileName = `Feedback Form - ${(form.title || 'Response').replace(/[^\w\- ]/g, '')} - ${submission.id}.docx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err: any) {
    console.error('[submissions/word] Failed to generate filled Word document:', err);
    return NextResponse.json({ error: 'Could not generate the filled Word document.' }, { status: 500 });
  }
}
