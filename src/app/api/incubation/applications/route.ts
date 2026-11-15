import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { isStaffTier } from '@/lib/permissions-server';
import { loadApplications, viewApplication, isManagerActor } from '@/lib/incubation/applications-server';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!isStaffTier(actor)) return NextResponse.json([]);
    const isManager = await isManagerActor(actor);
    const apps = await loadApplications();
    return NextResponse.json(apps.map(a => viewApplication(a, actor, isManager)).filter(Boolean));
  } catch (err) {
    return apiError(err, 'incubation-applications-get', 500);
  }
}
