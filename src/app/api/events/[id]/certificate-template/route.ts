import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { gateCertificateAction } from '@/lib/approval-gate';
import { EventItem } from '@/lib/local-data';
import { cleanTypeId, getCertificateTemplate, saveCertificateTemplate, renderCertificatePng, eventDateLabel, CertificateTemplate } from '@/lib/certificate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function authorise(request: Request, action: 'view' | 'design') {
  const user = await requireSession(request);
  const gate = await gateCertificateAction(user, action);
  if (!gate.allowed || gate.requiresApproval) {
    return { error: NextResponse.json({ error: "You don't have permission to change the certificate design." }, { status: 403 }) };
  }
  return { user };
}

async function withPreview(eventId: string, template: CertificateTemplate, _typeId: string) {
  const event = (await readCollection<EventItem>('events')).find((e) => e.id === eventId);
  const png = await renderCertificatePng(
    { attendeeName: 'Aarav Sharma', eventName: event?.title || 'Your Event', eventDate: event ? eventDateLabel(event) : '', code: 'SAMPLE000' },
    template,
    'https://example.com/certificate/SAMPLE000',
    1
  );
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorise(request, 'view');
    if (auth.error) return auth.error;
    const { id } = await params;
    const typeId = cleanTypeId(new URL(request.url).searchParams.get('typeId'));
    const template = await getCertificateTemplate(id, typeId);
    return NextResponse.json({ template, hasBackground: !!template.backgroundKey, preview: await withPreview(id, template, typeId) });
  } catch (err) {
    return apiError(err, 'certificate-template:get');
  }
}

/** Body: template text fields + optional `background` (image data URL, or null to remove). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorise(request, 'design');
    if (auth.error) return auth.error;
    const { id } = await params;
    const body = await request.json();
    const typeId = cleanTypeId(new URL(request.url).searchParams.get('typeId'));
    const template = await saveCertificateTemplate(id, body, body.background === null ? null : typeof body.background === 'string' ? body.background : undefined, typeId);
    return NextResponse.json({ template, hasBackground: !!template.backgroundKey, preview: await withPreview(id, template, typeId) });
  } catch (err: any) {
    if (err?.message?.startsWith('Artwork')) return NextResponse.json({ error: err.message }, { status: 400 });
    return apiError(err, 'certificate-template:put');
  }
}
