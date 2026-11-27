import type { FieldDef } from './kinds';

/**
 * Presentation-only grouping of a register's fields into small sections (Miller's Law: ~5-9 fields per
 * chunk). A field's explicit `section` wins; otherwise sections are inferred from its type so every
 * register — including ones added later — gets a sensible layout with no extra configuration.
 */
const REVIEW_SECTIONS: Record<string, string> = {
  startupId: 'Period', quarter: 'Period', periodEnd: 'Period', reportSubmittedOn: 'Period', reviewDate: 'Period',
  technology: 'Progress', market: 'Progress', finance: 'Progress', team: 'Progress', ipRegulatory: 'Progress', jobsImpact: 'Progress', supportDelivered: 'Progress', compliance: 'Progress',
  fundingApplied: 'Funding', fundingSanctioned: 'Funding', fundingReceived: 'Funding',
  rag: 'Assessment', ragRationale: 'Assessment',
  recoveryRootCause: 'Amber / Red actions', recoveryActions: 'Amber / Red actions', recoveryOwner: 'Amber / Red actions', recoveryDue: 'Amber / Red actions',
  escalationNote: 'Amber / Red actions', escalatedTo: 'Amber / Red actions',
  correctiveAction: 'Follow-up', correctiveOwner: 'Follow-up', correctiveDue: 'Follow-up', nextMilestones: 'Follow-up',
  founderConfirmed: 'Sign-off', evidenceIndexUpdated: 'Sign-off',
};

export interface FieldSection { id: string; title: string; fields: FieldDef[] }

export function sectionOf(kind: string, f: FieldDef): string {
  if (f.section) return f.section;
  if (kind === 'review' && REVIEW_SECTIONS[f.key]) return REVIEW_SECTIONS[f.key];
  if (f.type === 'checkbox') return 'Checklist';
  if (f.type === 'textarea' || f.type === 'file') return 'Notes & evidence';
  return 'Details';
}

export function groupFields(kind: string, fields: FieldDef[]): FieldSection[] {
  const order: string[] = [];
  const map = new Map<string, FieldDef[]>();
  for (const f of fields) {
    const t = sectionOf(kind, f);
    if (!map.has(t)) { map.set(t, []); order.push(t); }
    map.get(t)!.push(f);
  }
  // Basic details first, then the order each section first appears.
  const rank = (t: string) => (t === 'Details' || t === 'Period' ? 0 : 1);
  return order.sort((a, b) => rank(a) - rank(b)).map((t) => ({ id: t.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title: t, fields: map.get(t)! }));
}
