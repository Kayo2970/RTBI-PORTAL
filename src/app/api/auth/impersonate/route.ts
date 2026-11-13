import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readCollection } from '@/lib/server-db';
import { createSession, requireSession, requirePermission } from '@/lib/session';
import { parseJsonBody } from '@/lib/validation';
import { apiError } from '@/lib/api-error';

const ImpersonateSchema = z.object({
  targetMemberId: z.string().min(1),
}).strict();

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(actor.tier === 1, 'Only Super Users can quick-switch accounts.');

    const { targetMemberId } = await parseJsonBody(request, ImpersonateSchema);
    const members = await readCollection<any>('members');
    const target = members.find(m => m.id === targetMemberId);

    if (!target) {
      return NextResponse.json({ error: 'Target member not found.' }, { status: 404 });
    }

    if (target.status === 'Terminated') {
      return NextResponse.json({ error: 'Cannot switch to a terminated member account.' }, { status: 403 });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...safeTarget } = target;
    const token = await createSession(target.id);
    return NextResponse.json({ user: safeTarget, token });
  } catch (err: any) {
    return apiError(err, 'impersonate-api');
  }
}
