import { seesOnlyOwnForms, isOwnForm, type AccessLevelSettings } from './permissions-server';

/**
 * Server-side filter for the Forms module: a Training Associate (who can build forms but isn't a full form builder)
 * only ever receives the forms they created, and only the responses to those forms. Everyone else is unchanged.
 */
export function visibleFormsFor<T extends { createdById?: string; submittedByEmail?: string }>(forms: T[], actor: any, settings: AccessLevelSettings): T[] {
  if (!seesOnlyOwnForms(actor, settings)) return forms;
  return forms.filter((f) => isOwnForm(f, actor));
}

export function visibleSubmissionsFor(submissions: any[], forms: any[], actor: any, settings: AccessLevelSettings): any[] {
  if (!seesOnlyOwnForms(actor, settings)) return submissions;
  const own = forms.filter((f) => isOwnForm(f, actor));
  const ids = new Set(own.map((f) => f.id));
  const slugs = new Set(own.map((f) => String(f.slug || '').toLowerCase()).filter(Boolean));
  return submissions.filter((s) => ids.has(s.formId) || slugs.has(String(s.slug || '').toLowerCase()));
}

/** Approval-inbox rows naming a form (by title) are hidden from a Training Associate unless the form is theirs. */
export function visibleApprovalRequestsFor(requests: any[], forms: any[], actor: any, settings: AccessLevelSettings): any[] {
  if (!seesOnlyOwnForms(actor, settings)) return requests;
  const ownIds = new Set(forms.filter((f) => isOwnForm(f, actor)).map((f) => f.id));
  return requests.filter((r) => r.entityType !== 'form' || ownIds.has(r.entityId));
}
