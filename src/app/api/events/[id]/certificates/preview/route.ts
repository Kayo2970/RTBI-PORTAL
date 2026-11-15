import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { gateCertificateAction } from '@/lib/approval-gate';
import { getAppBaseUrl } from '@/lib/app-url';
import { EventItem, EventPassItem } from '@/lib/local-data';
import { CertificateRecord, cleanTypeId, getCertificateTemplate, recordExtras, renderCertificatePng, renderPassPreview, pngToPdf, verifyUrlFor } from '@/lib/certificate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** ?passId=…[&format=pdf] — the certificate exactly as that attendee will get it (PNG data URL as JSON, or the PDF itself). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const gate = await gateCertificateAction(user, 'view');
    if (!gate.allowed || gate.requiresApproval) return NextResponse.json({ error: "You don't have permission to preview certificates." }, { status: 403 });
    const { id } = await params;
    const url = new URL(request.url);
    const passId = url.searchParams.get('passId') || '';
    const event = (await readCollection<EventItem>('events')).find((e) => e.id === id);
    const typeId = cleanTypeId(url.searchParams.get('typeId'));
    const wantPdf = url.searchParams.get('format') === 'pdf';
    if (passId.startsWith('manual-')) {
      // A certificate created by hand: render it from its own record, under its real certificate ID.
      const rec = (await readCollection<CertificateRecord>('certificates')).find((c) => c.passId === passId && c.eventId === id && cleanTypeId(c.typeId) === typeId);
      if (!rec) return NextResponse.json({ error: 'Certificate not found.' }, { status: 404 });
      const template = await getCertificateTemplate(id, typeId);
      const png = await renderCertificatePng({ ...rec, ...recordExtras(rec) }, template, verifyUrlFor(getAppBaseUrl(request), rec.code), wantPdf ? 2 : 1);
      if (wantPdf) {
        return new NextResponse(new Uint8Array(pngToPdf(png)), {
          headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Certificate-${rec.attendeeName.replace(/[^\w]+/g, '_')}.pdf"` },
        });
      }
      return NextResponse.json({ preview: `data:image/png;base64,${png.toString('base64')}` });
    }
    const pass = (await readCollection<EventPassItem>('event_passes')).find((p) => p.id === passId && p.eventId === id);
    if (!event || !pass) return NextResponse.json({ error: 'Attendee not found.' }, { status: 404 });
    // The downloadable PDF is rendered at print quality (2x); the on-screen preview stays quick.
    const png = await renderPassPreview(pass, event, getAppBaseUrl(request), wantPdf ? 2 : 1, typeId);
    if (wantPdf) {
      return new NextResponse(new Uint8Array(pngToPdf(png)), {
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Certificate-${pass.attendeeName.replace(/[^\w]+/g, '_')}.pdf"` },
      });
    }
    return NextResponse.json({ preview: `data:image/png;base64,${png.toString('base64')}` });
  } catch (err) {
    return apiError(err, 'certificates:preview');
  }
}
