import { NextResponse } from 'next/server';
import { findCertificateByCode } from '@/lib/certificate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Public verification — only name, event, date and issue date. Addressed by the unguessable certificate code. */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const rec = await findCertificateByCode(code);
  if (!rec || rec.status !== 'Sent') return NextResponse.json({ error: 'Certificate not found' }, { status: 404 });
  return NextResponse.json({ code: rec.code, attendeeName: rec.attendeeName, eventName: rec.eventName, eventDate: rec.eventDate, certificateType: rec.typeName || '', issuedAt: rec.sentAt || rec.issuedAt });
}
