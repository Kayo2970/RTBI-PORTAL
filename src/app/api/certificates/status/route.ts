import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { gateCertificateAction } from '@/lib/approval-gate';
import { getCertificateStatuses } from '@/lib/certificate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Certificate status per pass (issued / queued / sent / failed, with times) for the Issued Passes table. Optional ?eventId=. */
export async function GET(request: Request) {
  try {
    const user = await requireSession(request);
    const gate = await gateCertificateAction(user, 'ledger');
    if (!gate.allowed || gate.requiresApproval) return NextResponse.json({ allowed: false, statuses: {} });
    const eventId = new URL(request.url).searchParams.get('eventId') || undefined;
    return NextResponse.json({ allowed: true, statuses: await getCertificateStatuses(eventId) });
  } catch (err) {
    return apiError(err, 'certificates:status');
  }
}
