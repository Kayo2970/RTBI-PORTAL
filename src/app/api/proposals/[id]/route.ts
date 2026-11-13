import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { deleteStoredFilesForRecord } from '@/lib/file-storage';
import { requireSession, ForbiddenError } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { cascadeCloseAutoApprovals, deleteLinkedApprovalRequests } from '@/lib/approval-sync';
import { getAccessLevelSettingsServer } from '@/lib/permissions-server';
import { viewProposalAs } from '@/lib/proposals-server';
import { dispatchProposalEmails } from '@/lib/proposal-email';
import type { ProposalItem, ProposalResponseStatus } from '@/lib/proposals';
import type { Member } from '@/lib/local-data';

const RESPONSE_STATUSES: ProposalResponseStatus[] = ['Under Review', 'Accepted', 'Declined'];

/**
 * PATCH body is one of:
 *   { action: 'decide', decision: 'Approved' | 'Rejected', note?: string }  — approvers only
 *   { action: 'respond', status: 'Under Review' | 'Accepted' | 'Declined', comment?: string } — recipients only
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const body = await request.json();
    const [members, settings] = await Promise.all([readCollection<Member>('members'), getAccessLevelSettingsServer()]);

    const all = await readCollection<ProposalItem>('proposals');
    const existing = all.find(p => p.id === id);
    const view = existing ? viewProposalAs(existing, actor, members, settings) : null;
    if (!existing || !view) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const nowIso = new Date().toISOString();
    let newlyApproved = false;
    let newlyRejected = false;

    if (body.action === 'decide') {
      if (!view.viewer?.canDecide) throw new ForbiddenError();
      if (body.decision !== 'Approved' && body.decision !== 'Rejected') {
        return NextResponse.json({ error: 'Invalid decision.' }, { status: 400 });
      }
      if (existing.status !== 'Pending Approval') {
        return NextResponse.json({ error: 'This proposal has already been decided.' }, { status: 409 });
      }
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : undefined;
      await mutateCollection('proposals', (current) => (current || []).map((p: any) => {
        if (p.id !== id || p.status !== 'Pending Approval') return p;
        if (body.decision === 'Approved') newlyApproved = true; else newlyRejected = true;
        return { ...p, status: body.decision, decidedBy: actor.name, decidedAt: nowIso, decisionNote: note || undefined };
      }));
    } else if (body.action === 'respond') {
      if (!view.viewer?.isRecipient) throw new ForbiddenError('Only the proposal\'s recipients can respond.');
      if (!RESPONSE_STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid response.' }, { status: 400 });
      const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : undefined;
      await mutateCollection('proposals', (current) => (current || []).map((p: any) => {
        if (p.id !== id) return p;
        const others = (p.responses || []).filter((r: any) => r.memberId !== actor.id);
        return { ...p, responses: [...others, { memberId: actor.id, memberName: actor.name, status: body.status, comment: comment || undefined, at: nowIso }] };
      }));
    } else {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }

    const updatedList = await readCollection<ProposalItem>('proposals');
    const updated = updatedList.find(p => p.id === id);
    if (updated && (newlyApproved || newlyRejected)) {
      try {
        await cascadeCloseAutoApprovals('proposal', id, newlyApproved ? 'approved' : 'rejected', actor.name);
      } catch (e) {
        console.error('[proposals-api] Approval cascade-close failed:', e);
      }
      if (newlyApproved) await dispatchProposalEmails(updated);
    }
    const final = updated ? (await readCollection<ProposalItem>('proposals')).find(p => p.id === id) : undefined;
    return NextResponse.json(final ? viewProposalAs(final, actor, members, settings) : null);
  } catch (err: any) {
    return apiError(err, 'proposals-id-api-patch', 400);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const [members, settings, all] = await Promise.all([
      readCollection<Member>('members'),
      getAccessLevelSettingsServer(),
      readCollection<ProposalItem>('proposals'),
    ]);
    const existing = all.find(p => p.id === id);
    const view = existing ? viewProposalAs(existing, actor, members, settings) : null;
    if (!existing || !view) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!view.viewer?.canDelete) throw new ForbiddenError();

    await mutateCollection('proposals', (current) => (current || []).filter((p: any) => p.id !== id));
    await deleteStoredFilesForRecord('proposals', id);
    await deleteLinkedApprovalRequests('proposal', id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'proposals-id-api-delete', 500);
  }
}
