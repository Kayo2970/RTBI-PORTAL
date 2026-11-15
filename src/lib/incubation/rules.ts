import type { IncubationSettings, WeightedCriterion } from './types';

/** Weighted score per SOP 08 Annexure C: (score ÷ 5) × weight, summed. Missing criteria count as 0. */
export function weightedScore(criteria: WeightedCriterion[], scores: Record<string, number>): number {
  const total = criteria.reduce((sum, c) => {
    const s = Math.min(5, Math.max(0, Number(scores[c.key]) || 0));
    return sum + (s / 5) * c.weight;
  }, 0);
  return Math.round(total * 100) / 100;
}

export function totalWeight(criteria: WeightedCriterion[]): number {
  return criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);
}

/** A scorecard/graduation config is only usable when its weights sum to exactly 100. */
export function weightsValid(criteria: WeightedCriterion[]): boolean {
  return Math.abs(totalWeight(criteria) - 100) < 0.001;
}

export type GraduationBand = 'eligible' | 'conditional' | 'not-ready';
export function graduationBand(score: number, eligibleMin: number, conditionalMin: number): GraduationBand {
  if (score >= eligibleMin) return 'eligible';
  if (score >= conditionalMin) return 'conditional';
  return 'not-ready';
}

/** Add `n` working days (Mon-Fri) to a date. Public holidays are not modelled. */
export function addWorkingDays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let left = Math.max(0, Math.floor(n));
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d;
}

/** Financial year label for a date, e.g. start month 4: 2026-05-01 -> "FY2026-27". */
export function financialYearLabel(date: Date, startMonth = 4): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const startYear = m >= startMonth ? y : y - 1;
  if (startMonth === 1) return `FY${startYear}`;
  return `FY${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Quarter (1-4) within the financial year. */
export function fiscalQuarter(date: Date, startMonth = 4): number {
  const m = date.getMonth() + 1;
  const offset = (m - startMonth + 12) % 12;
  return Math.floor(offset / 3) + 1;
}

/** Sequential human-readable startup id: RTBI-S-<year>-<nnn>. */
export function nextStartupId(existingIds: string[], now = new Date()): string {
  const year = now.getFullYear();
  const prefix = `RTBI-S-${year}-`;
  const max = existingIds
    .filter(id => id.startsWith(prefix))
    .map(id => parseInt(id.slice(prefix.length), 10))
    .filter(n => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** Suggested TRL assessment id (used from Phase 4): RTBI-TRL-[Startup ID]-[Technology]-[YYYYMMDD]. */
export function trlAssessmentId(startupId: string, technology: string, date = new Date()): string {
  const tech = technology.replace(/[^A-Za-z0-9]+/g, '').slice(0, 12).toUpperCase() || 'TECH';
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `RTBI-TRL-${startupId}-${tech}-${ymd}`;
}

/** Marking a block approved requires an approval reference; weights must sum to 100. Returns error text or null. */
export function validateSettings(s: IncubationSettings): string | null {
  if (!weightsValid(s.scorecard.criteria)) return 'Selection scorecard weights must total 100.';
  if (!weightsValid(s.graduation.dimensions)) return 'Graduation scorecard weights must total 100.';
  if (s.graduation.conditionalMin >= s.graduation.eligibleMin) return 'Graduation "conditional" minimum must be below the "eligible" minimum.';
  if (s.fiscalYearStartMonth < 1 || s.fiscalYearStartMonth > 12) return 'Fiscal-year start month must be 1-12.';
  const blocks: [string, { status: string; approvalRef?: string }][] = [
    ['Selection scorecard', s.scorecard], ['Graduation', s.graduation], ['Timers', s.timers], ['KPI targets', s.kpis],
    ...s.feeSchedules.map((f): [string, { status: string; approvalRef?: string }] => [`Fee schedule "${f.name}"`, f]),
  ];
  for (const [label, b] of blocks) {
    if (b.status === 'approved' && !b.approvalRef?.trim()) return `${label}: an approval reference is required to mark it approved.`;
  }
  return null;
}
