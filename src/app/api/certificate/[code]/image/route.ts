import { NextResponse } from 'next/server';
import { findCertificateByCode, getCertificateTemplate, recordExtras, renderCertificatePng, verifyUrlFor } from '@/lib/certificate';
import { getAppBaseUrl } from '@/lib/app-url';
import { readStoredFile } from '@/lib/file-storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const rec = await findCertificateByCode(code);
  if (!rec || rec.status !== 'Sent') return NextResponse.json({ error: 'Certificate not found' }, { status: 404 });
  // After the 30-day retention run only the small background-free thumbnail is kept
  if (rec.thumbKey) {
    try {
      return new NextResponse(new Uint8Array(await readStoredFile(rec.thumbKey)), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } });
    } catch {
      /* thumbnail missing — fall through to a fresh render */
    }
  }
  const png = await renderCertificatePng({ ...rec, ...recordExtras(rec) }, await getCertificateTemplate(rec.eventId, rec.typeId), verifyUrlFor(getAppBaseUrl(request), rec.code), 2);
  return new NextResponse(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' } });
}
