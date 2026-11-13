import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { purgeRemovedAttachments } from '@/lib/cascade-delete';
import { deleteStoredFilesForRecord } from '@/lib/file-storage';
import { requireSession, requirePermission } from '@/lib/session';
import {
  getAccessLevelSettingsServer,
  canApproveAsSectorHead,
  canVerifyReimbursementCentreHead,
  canApproveAsFinanceHead,
  isCentreHead,
} from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const updates = await request.json();
    const settings = await getAccessLevelSettingsServer();

    const existing = (await readCollection<any>('reimbursements')).find((r: any) => r.id === id);
    const isClaimant = !!(
      existing?.memberEmail &&
      actor?.email &&
      String(existing.memberEmail).toLowerCase() === String(actor.email).toLowerCase()
    );

    // Figure out which stage this PATCH is actioning from the body shape —
    // see updateReimbursementStatus()/verifyReimbursementByCentreHead() in
    // local-data.ts, the only two client write paths that hit this route.
    const isCentreHeadVerifyAction = updates.status === 'Verified by Centre Head' || updates.centreHeadVerified === true;
    const isFinanceDecision = updates.status === 'Approved' || (updates.status === 'Denied' && !!updates.finalApprover);
    const isFirstPassReject = updates.status === 'Denied' && !!updates.firstPassReviewer && !updates.finalApprover;

    let allowed = false;
    if (isCentreHeadVerifyAction || isFirstPassReject) {
      allowed = allowed || canApproveAsSectorHead(actor, settings) || canVerifyReimbursementCentreHead(actor, settings);
    }
    if (isFinanceDecision) {
      allowed = allowed || canApproveAsFinanceHead(actor, settings, existing);
    }
    if (!isCentreHeadVerifyAction && !isFinanceDecision && !isFirstPassReject) {
      // No recognized stage transition (e.g. a minor field edit) — allow the
      // claimant editing their own claim, or anyone who could act on it at
      // any stage, but not an unrelated member.
      allowed =
        isClaimant ||
        canApproveAsSectorHead(actor, settings) ||
        canVerifyReimbursementCentreHead(actor, settings) ||
        canApproveAsFinanceHead(actor, settings, existing);
    }
    requirePermission(allowed, 'You do not have permission to update this reimbursement claim.');

    // Upsert: if this id isn't in the server's collection yet — e.g. it's one of the
    // client-bundled sample/seed records that was never POSTed — create it instead of
    // 404ing and silently dropping the edit (that used to leave the sample data stuck
    // forever, since polling clients would then keep re-hydrating the stale sample).
    let previousReceipts: any[] | undefined;
    const updated = await mutateCollection('reimbursements', (current) => {
      const idx = current.findIndex((item: any) => item.id === id);
      if (idx === -1) return [...current, { id, ...updates }];
      previousReceipts = current[idx].receiptFiles;
      const next = [...current];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });
    if (Array.isArray(updates.receiptFiles)) await purgeRemovedAttachments(previousReceipts, updates.receiptFiles);
    return NextResponse.json(updated.find((r: any) => r.id === id));
  } catch (err: any) {
    return apiError(err, 'reimbursements-id-api-patch', 400);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const settings = await getAccessLevelSettingsServer();
    const existing = (await readCollection<any>('reimbursements')).find((r: any) => r.id === id);
    const isClaimant = !!(
      existing?.memberEmail &&
      actor?.email &&
      String(existing.memberEmail).toLowerCase() === String(actor.email).toLowerCase()
    );
    requirePermission(
      isClaimant || isCentreHead(actor, settings) || actor.tier === 1,
      'You do not have permission to delete this reimbursement claim.'
    );

    let found = false;
    await mutateCollection('reimbursements', (current) => {
      const filtered = current.filter((r: any) => r.id !== id);
      found = filtered.length < current.length;
      return filtered;
    });
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await deleteStoredFilesForRecord('reimbursements', id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'reimbursements-id-api-delete', 500);
  }
}
