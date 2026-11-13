import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import {
  getAccessLevelSettingsServer,
  canVerifyBudgetCentreHead,
  canDecideBudget,
  canSubmitBudget,
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

    const existing = (await readCollection<any>('budgets')).find((b: any) => b.id === id);
    const isSubmitter = !!(
      existing?.submittedByEmail &&
      actor?.email &&
      String(existing.submittedByEmail).toLowerCase() === String(actor.email).toLowerCase()
    );

    // Figure out which stage this PATCH is actioning from the body shape —
    // see decideBudget()/verifyBudgetByCentreHead()/updateBudget() in
    // local-data.ts, the only client write paths that hit this route.
    // Stages are detected from what the request CHANGES relative to the stored record. The client PATCHes the whole
    // record every time, and leaving `decidedBy` out used to make an approval look like a plain edit, which the
    // submitter was allowed to send — i.e. self-approval.
    const changed = (k: string) => JSON.stringify(existing?.[k]) !== JSON.stringify((updates as any)[k]) && k in updates;
    const isVerifyStage = updates.centreHeadVerified === true && existing?.centreHeadVerified !== true;
    const isDecideStage = (updates.status === 'Approved' || updates.status === 'Rejected') && (changed('status') || changed('decidedBy'));
    const isEditStage = updates.status === 'Pending' && updates.centreHeadVerified === false && (existing?.status !== 'Pending' || existing?.centreHeadVerified !== false);

    // Every stage the body touches must be permitted (a verify + decide in one request needs BOTH rights).
    let allowed = true;
    if (isVerifyStage) allowed = allowed && canVerifyBudgetCentreHead(actor, settings);
    if (isDecideStage) allowed = allowed && canDecideBudget(actor, settings, existing);
    if (isEditStage) allowed = allowed && (canSubmitBudget(actor, settings) || isSubmitter);
    if (!isVerifyStage && !isDecideStage && !isEditStage) {
      // No recognized stage transition — fall back to the union of everyone
      // who could legitimately touch this record.
      allowed =
        isSubmitter ||
        canSubmitBudget(actor, settings) ||
        canVerifyBudgetCentreHead(actor, settings) ||
        canDecideBudget(actor, settings, existing);
    }
    requirePermission(allowed, 'You do not have permission to update this budget request.');

    const updated = await mutateCollection('budgets', (current) => {
      const idx = current.findIndex((b: any) => b.id === id);
      if (idx === -1) return [...current, { id, ...updates }];
      const next = [...current];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });
    return NextResponse.json(updated.find((b: any) => b.id === id));
  } catch (err: any) {
    return apiError(err, 'budgets-id-api-patch', 400);
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
    requirePermission(
      isCentreHead(actor, settings) || actor.tier === 1,
      'You do not have permission to delete this budget request.'
    );

    let found = false;
    await mutateCollection('budgets', (current) => {
      const filtered = current.filter((b: any) => b.id !== id);
      found = filtered.length < current.length;
      return filtered;
    });
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'budgets-id-api-delete', 500);
  }
}
