/** Onboarding checklist + activation gate (SOP 08 / 07). Pure — shared by the server gate and the page. */

export interface MandatoryDocDef {
  key: string;
  num: number;
  label: string;
  description: string;
  evidence: string;
  formats: string;
  owner: string;
  required: boolean;
  applicableNotice?: string;
}

/** The 6 Official Documents Required by RTBI Incubated Startups Data Collection & Document Submission Mandate */
export const RTBI_MANDATORY_DOCUMENTS: MandatoryDocDef[] = [
  {
    key: 'logo',
    num: 1,
    label: 'Startup Logo',
    description: 'High-resolution company logo (PNG/JPG)',
    evidence: 'High-res company logo file (PNG/JPG/WebP)',
    formats: 'PNG, JPG, WebP',
    owner: 'Startup',
    required: true,
  },
  {
    key: 'entityDocs',
    num: 2,
    label: 'Startup Registration Document',
    description: 'Certificate of Incorporation / Registration Certificate',
    evidence: 'Certificate of Incorporation / Registration Certificate / CIN',
    formats: 'PDF, JPG, PNG',
    owner: 'Startup / Administration',
    required: true,
  },
  {
    key: 'agreement',
    num: 3,
    label: 'Startup Agreement Deed with RTBI',
    description: 'Executed agreement copy with RTBI',
    evidence: 'Executed agreement copy with RTBI (verified on Agreements register)',
    formats: 'PDF',
    owner: 'Authorised signatories / administration',
    required: true,
  },
  {
    key: 'portfolio',
    num: 4,
    label: 'Startup Portfolio Material',
    description: 'Pitch Decks, Product Demo Videos, Reference Documents, etc.',
    evidence: 'Pitch Decks, Product Demo Videos, Reference Documents, etc.',
    formats: 'PDF, PPTX, MP4, Link',
    owner: 'Startup',
    required: true,
  },
  {
    key: 'patents',
    num: 5,
    label: 'Patents',
    description: 'Patent application / grant certificates (if applicable)',
    evidence: 'Patent application / grant certificates (or note "Not Applicable")',
    formats: 'PDF, Doc Ref',
    owner: 'Startup',
    required: false,
    applicableNotice: 'If not applicable, enter "Not Applicable"',
  },
  {
    key: 'rentalAgreement',
    num: 6,
    label: 'Rental Agreement with RTBI',
    description: 'If physically incubated, copy of rental agreement with RTBI',
    evidence: 'Copy of rental agreement with RTBI (or note "Not Applicable" if virtual)',
    formats: 'PDF, Doc Ref',
    owner: 'Operations / administration',
    required: false,
    applicableNotice: 'Required if physically incubated; note "Not Applicable" if virtual',
  },
];

export const ONBOARDING_ITEMS: {
  key: string;
  label: string;
  evidence: string;
  owner: string;
  category?: 'document' | 'governance';
  docNum?: number;
  required?: boolean;
}[] = [
  // Official RTBI Mandate Documents (1-6)
  { key: 'logo', label: '1. Startup Logo', evidence: 'High-resolution company logo (PNG/JPG)', owner: 'Startup', category: 'document', docNum: 1, required: true },
  { key: 'entityDocs', label: '2. Startup Registration Document', evidence: 'Certificate of Incorporation / Registration Certificate', owner: 'Administration', category: 'document', docNum: 2, required: true },
  { key: 'agreement', label: '3. Startup Agreement Deed with RTBI', evidence: 'Executed agreement copy with RTBI (verified on the Agreements register)', owner: 'Authorised signatories / administration', category: 'document', docNum: 3, required: true },
  { key: 'portfolio', label: '4. Startup Portfolio Material', evidence: 'Pitch Decks, Product Demo Videos, Reference Documents, etc.', owner: 'Startup', category: 'document', docNum: 4, required: true },
  { key: 'patents', label: '5. Patents', evidence: 'Patent application / grant certificates (or note "Not Applicable")', owner: 'Startup', category: 'document', docNum: 5, required: false },
  { key: 'rentalAgreement', label: '6. Rental Agreement with RTBI', evidence: 'If physically incubated, copy of rental agreement with RTBI (or note "Not Applicable")', owner: 'Operations / administration', category: 'document', docNum: 6, required: false },

  // Operational & Governance Requirements
  { key: 'admission', label: 'Admission communication', evidence: 'Signed or authorised admission letter with conditions', owner: 'CEO / designated officer', category: 'governance' },
  { key: 'fees', label: 'Pay-and-use / fee terms', evidence: 'Approved fee schedule, invoice, receipt, or approved concession/deferral', owner: 'Finance / administration', category: 'governance' },
  { key: 'ipConfidentiality', label: 'IP and confidentiality declaration', evidence: 'Founder declaration, ownership/assignment/licence position, confidentiality undertaking', owner: 'Startup / designated officer', category: 'governance' },
  { key: 'masterRecord', label: 'Startup master record', evidence: 'Startup ID, founders, stage, technology, sector, baseline, agreement dates, status', owner: 'Incubation officer', category: 'governance' },
  { key: 'baseline', label: 'Baseline and milestones', evidence: 'Maturity, prototype status, customer validation, funding, jobs/revenue, risks, 6-12 month milestones', owner: 'Startup with incubation officer', category: 'governance' },
  { key: 'supportPlan', label: 'Support plan', evidence: 'Assigned mentors, planned services, goals, cadence, RTBI contact', owner: 'Incubation officer', category: 'governance' },
  { key: 'facility', label: 'Facility / access record', evidence: 'Workspace or virtual route, asset and access list, safety induction', owner: 'Operations / administration', category: 'governance' },
  { key: 'orientation', label: 'Orientation', evidence: 'Rules, reporting, fees, communication, grievance route, confidentiality explained', owner: 'Incubation officer', category: 'governance' },
];

export const FEE_BASES = ['Approved fee schedule', 'Invoice / receipt', 'Approved concession / deferral'] as const;

/** An uploaded evidence/document file stored on disk (data/uploads/onboarding/...). */
export interface OnboardingFile { name: string; url: string; storageKey: string; type?: string; size?: number; uploadedAt: string; uploadedBy: string }

/** `done` means verified/scrutinised by staff; an upload alone never marks an item done. */
export interface OnboardingItemState { done: boolean; evidenceRef?: string; file?: OnboardingFile; doneAt?: string; doneBy?: string; feeBasis?: string }

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
    if (!st.evidenceRef?.trim() && !st.file) missing.push(`${it.label} — uploaded document or evidence reference`);
    if (it.key === 'agreement' && !facts.agreementExecuted) missing.push('Startup Agreement Deed with RTBI — no Executed agreement on the register');
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
