import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { EventPassItem } from '@/lib/local-data';
import { purgeEventPassArtifacts } from '@/lib/cascade-delete';
import { gateEventPassAction } from '@/lib/approval-gate';
import { markPassPending, submitPassApproval } from '@/lib/event-pass-approvals';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; passId: string }> }
) {
  try {
    const sessionUser = await requireSession(request);
    const { passId } = await params;

    const passes = await readCollection<EventPassItem>('event_passes');
    const target = passes.find((p) => p.id === passId || p.serialNumber === passId);
    if (!target) {
      return NextResponse.json({ error: 'Pass not found' }, { status: 404 });
    }

    const gate = await gateEventPassAction(sessionUser, 'delete');
    if (!gate.allowed) {
      return NextResponse.json({ error: "You don't have permission to delete event passes." }, { status: 403 });
    }
    if (gate.requiresApproval) {
      if (target.approvalStatus) {
        return NextResponse.json({ error: 'This pass already has a change waiting for approval.' }, { status: 409 });
      }
      const pending = await markPassPending(target.id, 'pending_delete', sessionUser, gate);
      await submitPassApproval({
        action: 'delete',
        pass: target,
        actor: sessionUser,
        gate,
        message: `${sessionUser.name} wants to delete ${target.attendeeName}'s pass for ${target.eventName}. It stays active until you approve${gate.policyName ? ` (policy: ${gate.policyName})` : ''}.`,
      });
      return NextResponse.json({ success: true, approvalPending: true, pass: pending }, { status: 202 });
    }

    await mutateCollection<EventPassItem>('event_passes', (current = []) =>
      current.filter((p) => p.id !== passId && p.serialNumber !== passId)
    );

    await purgeEventPassArtifacts(target);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'event-passes-delete', 500);
  }
}
