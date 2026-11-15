import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { gateCertificateAction } from '@/lib/approval-gate';
import { getAppBaseUrl } from '@/lib/app-url';
import { EventItem } from '@/lib/local-data';
import { cleanTypeId, createManualCertificate, getCertificateTypes, sendManualCertificate } from '@/lib/certificate';
import { cleanCertEmail } from '@/lib/certificate-layout';
import { cleanBackgroundChoice } from '@/lib/email-background';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Creates a certificate on the spot for someone without an event pass.
 * Body: { typeId?, name, email?, organisation?, category?, send?: boolean, message? } — `send` also emails it (needs an email address).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const gate = await gateCertificateAction(user, 'send');
    if (!gate.allowed) return NextResponse.json({ error: "You don't have permission to create certificates." }, { status: 403 });
    if (gate.requiresApproval) return NextResponse.json({ error: 'Creating certificates needs an approver for your role — ask a Head or the Centre leadership.' }, { status: 403 });
    const { id } = await params;
    const body = await request.json();
    const event = (await readCollection<EventItem>('events')).find((e) => e.id === id);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    const typeId = cleanTypeId(body.typeId);
    const typeName = (await getCertificateTypes(id)).find((t) => t.id === typeId)?.name;
    if (body.send && !String(body.email || '').trim()) return NextResponse.json({ error: 'Enter an email address to send the certificate.' }, { status: 400 });
    let record = await createManualCertificate(event, { name: body.name, email: body.email, organisation: body.organisation, category: body.category }, typeId, typeName);
    if (body.send) {
      const r = await sendManualCertificate(record, getAppBaseUrl(request), undefined, cleanCertEmail(body.message), user?.name || 'Staff', cleanBackgroundChoice(body.background));
      record = r.record;
      if (!r.ok) return NextResponse.json({ error: r.error || 'Created, but the email could not be sent.', record }, { status: 502 });
    }
    return NextResponse.json({ record });
  } catch (err: any) {
    if (/^(Enter|That email)/.test(err?.message || '')) return NextResponse.json({ error: err.message }, { status: 400 });
    return apiError(err, 'certificates:manual');
  }
}
