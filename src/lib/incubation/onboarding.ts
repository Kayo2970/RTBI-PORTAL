/** Onboarding checklist + activation gate (SOP 08 / 07). Pure — shared by the server gate and the page. */

export const ONBOARDING_ITEMS: { key: string; label: string; evidence: string; owner: string }[] = [
  { key: 'admission', label: 'Admission communication', evidence: 'Signed or authorised admission letter with conditions', owner: 'CEO / designated officer' },
  { key: 'agreement', label: 'Incubation agreement', evidence: 'Executed agreement (verified on the Agreements register)', owner: 'Authorised signatories / administration' },
  { key: 'fees', label: 'Pay-and-use / fee terms', evidence: 'Approved fee schedule, invoice, receipt, or approved concession/deferral', owner: 'Finance / administration' },
  { key: 'entityDocs', label: 'Founder and entity documents', evidence: 'KYC and entity documents as lawful; proof of authorised signatory', owner: 'Administration' },
  { key: 'ipConfidentiality', label: 'IP and confidentiality', evidence: 'Founder declaration, ownership/assignment/licence position, confidentiality undertaking', owner: 'Startup / designated officer' },
  { key: 'masterRecord', label: 'Startup master record', evidence: 'Startup ID, founders, stage, technology, sector, baseline, agreement dates, status', owner: 'Incubation officer' },
  { key: 'baseline', label: 'Baseline and milestones', evidence: 'Maturity, prototype status, customer validation, funding, jobs/revenue, risks, 6-12 month milestones', owner: 'Startup with incubation officer' },
  { key: 'supportPlan', label: 'Support plan', evidence: 'Assigned mentors, planned services, goals, cadence, RTBI contact', owner: 'Incubation officer' },
  { key: 'facility', label: 'Facility / access record', evidence: 'Workspace or virtual route, asset and access list, safety induction', owner: 'Operations / administration' },
  { key: 'orientation', label: 'Orientation', evidence: 'Rules, reporting, fees, communication, grievance route, confidentiality explained', owner: 'Incubation officer' },
];

export const FEE_BASES = ['Approved fee schedule', 'Invoice / receipt', 'Approved concession / deferral'] as const;

export interface OnboardingItemState { done: boolean; evidenceRef?: string; doneAt?: string; doneBy?: string; feeBasis?: string }

export interface OnboardingRecord {
  startupId: string;
  items: Record<string, OnboardingItemState>;
  /** Only a written conditional approval allows limited pre-admission activity. */
  conditionalApproval?: { ref: string; scope: string; endsOn?: string; recordedBy: string; recordedAt: string };
  updatedAt: string;
}

export interface GateFacts {
  /** An 'Executed' agreement exists on the register for this startup. */
  agreementExecuted: boolean;
  /** Startup has a technology: a TRL assessment must have been opened. */
  trlRequired: boolean;
  trlOpened: boolean;
  /** At least one fee schedule is approved (needed when the fee basis is "Approved fee schedule"). */
  approvedFeeSchedule: boolean;
}

export interface GateResult { ok: boolean; basis?: 'complete' | 'conditional'; missing: string[] }

export function activationGate(ob: OnboardingRecord | undefined, facts: GateFacts): GateResult {
  const missing: string[] = [];
  for (const it of ONBOARDING_ITEMS) {
    const st = ob?.items?.[it.key];
    if (!st?.done) { missing.push(it.label); continue; }
    if (!st.evidenceRef?.trim()) missing.push(`${it.label} — evidence reference`);
    if (it.key === 'agreement' && !facts.agreementExecuted) missing.push('Incubation agreement — no Executed agreement on the register');
    if (it.key === 'fees') {
      if (!st.feeBasis) missing.push('Pay-and-use / fee terms — choose the basis');
      else if (st.feeBasis === 'Approved fee schedule' && !facts.approvedFeeSchedule) missing.push('Pay-and-use / fee terms — no approved fee schedule yet (the 2022 table is only Proposed)');
    }
  }
  if (facts.trlRequired && !facts.trlOpened) missing.push('TRL assessment not opened (technology-led startup)');
  if (missing.length === 0) return { ok: true, basis: 'complete', missing };
  const c = ob?.conditionalApproval;
  if (c?.ref?.trim() && c.scope?.trim()) return { ok: true, basis: 'conditional', missing };
  return { ok: false, missing };
}
