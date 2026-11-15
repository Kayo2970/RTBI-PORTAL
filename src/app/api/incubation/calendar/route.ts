import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { computeCalendar } from '@/lib/incubation/alerts-server';

export async function GET(request: Request) {
  try {
    return NextResponse.json(await computeCalendar(await requireSession(request)));
  } catch (err) {
    return apiError(err, 'incubation-calendar', 500);
  }
}
