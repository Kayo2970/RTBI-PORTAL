import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { isInternalStaff } from '@/lib/permissions-server';
import { computeKpis } from '@/lib/incubation/kpi-server';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!isInternalStaff(actor)) return NextResponse.json({ error: 'Programme KPIs are visible to RTBI staff only.' }, { status: 403 });
    const fy = new URL(request.url).searchParams.get('fy') || undefined;
    return NextResponse.json(await computeKpis(fy));
  } catch (err) {
    return apiError(err, 'incubation-kpi', 500);
  }
}
