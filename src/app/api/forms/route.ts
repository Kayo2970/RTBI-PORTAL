import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { getAccessLevelSettingsServer, canCreateForms, seesOnlyOwnForms, isOwnForm } from '@/lib/permissions-server';
import { visibleFormsFor } from '@/lib/forms-visibility';
import { fanOutAutoApproval, resolveCustomApprovalPanel, resolveTraineeFormPanel } from '@/lib/approval-sync';
import { apiError } from '@/lib/api-error';
import { gateFormAction, formEditKeys, holdEditForApproval, stampPendingCreate, isPendingState } from '@/lib/approval-gate';

const PENDING_APPROVAL_MESSAGE: Record<string, string> = {
  pending_create: 'This form needs sign-off from the Centre Head or designated approver before its public link goes live.',
  pending_edit: 'An edit to this form needs sign-off from the Centre Head or designated approver.',
  pending_delete: 'A request to delete this form needs sign-off from the Centre Head or designated approver.',
};

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    const items = await readCollection<any>('forms');
    return NextResponse.json(visibleFormsFor(items, actor, settings));
  } catch (err: any) {
    return apiError(err, 'forms-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    const item = await request.json();
    // Chain of command: decided here from the stored policies / roles, never from the approvalStatus the browser sent.
    const storedForm = (await readCollection<any>('forms')).find((f: any) => f.id === item.id);
    if (!storedForm) {
      const gate = await gateFormAction(actor, 'CREATE');
      if (!gate.allowed) throw new ForbiddenError();
      if (gate.requiresApproval) stampPendingCreate(item, gate, actor);
      else if (!canCreateForms(actor, settings) && actor.tier !== 1) throw new ForbiddenError();
      // Ownership is stamped from the session, never trusted from the browser.
      item.createdById = actor.id;
      item.createdByDivision = actor.division;
    } else {
      if (seesOnlyOwnForms(actor, settings) && !isOwnForm(storedForm, actor)) throw new ForbiddenError();
      const bookkeeping = ['createdById', 'createdByDivision', 'approvalStatus', 'pendingChange', 'submittedBy', 'submittedByEmail', 'approverType', 'approverMemberId', 'approverPolicyTagId', 'approvalPolicyName', 'approverName', 'decidedBy', 'decidedAt', 'rejectionReason'];
      const keys = formEditKeys(item).filter((k) => JSON.stringify(storedForm[k]) !== JSON.stringify(item[k]));
      for (const k of bookkeeping) { if (k in storedForm) item[k] = storedForm[k]; else delete item[k]; }
      const gate = await gateFormAction(actor, 'EDIT');
      if (!gate.allowed) throw new ForbiddenError();
      if (keys.length > 0 && gate.requiresApproval && !isPendingState(storedForm.approvalStatus)) {
        const upd: Record<string, any> = {};
        for (const k of keys) upd[k] = item[k];
        holdEditForApproval(storedForm, upd, keys, gate, actor);
        const base = { ...storedForm };
        for (const k of Object.keys(item)) delete item[k];
        Object.assign(item, base, upd);
      }
    }
    const updated = await mutateCollection('forms', (current) => {
      if (item.slug && current.some((f: any) => f.id !== item.id && f.slug?.toLowerCase() === item.slug?.toLowerCase())) {
        throw new Error(`A form with slug "${item.slug}" already exists`);
      }
      const at = current.findIndex((f: any) => f.id === item.id);
      if (at >= 0) { const copy = [...current]; copy[at] = item; return copy; }
      return [item, ...current];
    });
    const created = updated.find((f: any) => f.id === item.id);

    // Route the built-in Group Policy approval gate on this form (see
    // PublicFormItem's doc comment in local-data.ts) into the Approvals
    // module, mirroring the treatment given to Events/Tasks — previously
    // missing entirely, so pending forms never notified anyone or showed
    // up in the consolidated Approvals inbox.
    if (created && (created.approvalStatus === 'pending_create' || created.approvalStatus === 'pending_edit')) {
      try {
        const customPanel = created.approverType && created.approverType !== 'CENTER_HEAD'
          ? await resolveCustomApprovalPanel(created.approverType, created.approverMemberId, created.approverPolicyTagId)
          : created.createdByDivision === 'Training Associate' ? await resolveTraineeFormPanel() : undefined;
        await fanOutAutoApproval({
          entityType: 'form',
          entityId: created.id,
          entityTitle: created.title,
          eventId: created.eventId,
          requesterId: created.submittedBy || '',
          requesterName: created.submittedBy || 'A member',
          requesterEmail: created.submittedByEmail,
          message: PENDING_APPROVAL_MESSAGE[created.approvalStatus],
          customPanel,
        });
      } catch (approvalErr) {
        console.error('[forms-api] Approval fan-out failed:', approvalErr);
      }
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'forms-api-post', 400);
  }
}
