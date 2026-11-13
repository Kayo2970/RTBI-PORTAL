import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { gateCertificateAction } from '@/lib/approval-gate';
import { listIssuedCertificates, deleteCertificates } from '@/lib/certificate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Read-only list of every issued certificate (one row each) with delivery status. Optional ?eventId=. */
export async function GET(request: Request) {
  try {
    const user = await requireSession(request);
    const gate = await gateCertificateAction(user, 'ledger');
    if (!gate.allowed || gate.requiresApproval) return NextResponse.json({ allowed: false, certificates: [] });
    const eventId = new URL(request.url).searchParams.get('eventId') || undefined;
    return NextResponse.json({ allowed: true, certificates: await listIssuedCertificates(eventId) });
  } catch (err) {
    return apiError(err, 'certificates:issued');
  }
}

/** Permanently deletes issued certificates: body { ids: string[] }. */
export async function DELETE(request: Request) {
  try {
    const user = await requireSession(request);
    const gate = await gateCertificateAction(user, 'delete');
    if (!gate.allowed) return NextResponse.json({ error: "You don't have permission to delete certificates." }, { status: 403 });
    if (gate.requiresApproval) return NextResponse.json({ error: 'Deleting certificates needs approval, which is not available for this action.' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((i: unknown) => typeof i === 'string').slice(0, 500) : [];
    if (ids.length === 0) return NextResponse.json({ error: 'No certificates selected.' }, { status: 400 });
    return NextResponse.json({ deleted: await deleteCertificates(ids) });
  } catch (err) {
    return apiError(err, 'certificates:delete');
  }
}
