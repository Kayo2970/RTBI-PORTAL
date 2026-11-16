/**
 * Incubation domain types (Phase 1: settings + startup registry).
 * Pure types only — safe to import from client and server.
 */

/** Anything the SOPs leave unapproved is stored as 'proposed' until an approval reference is recorded. */
export type ApprovalState = 'proposed' | 'approved';

export interface Approvable {
  status: ApprovalState;
  /** e.g. minutes / office-order reference. Required to mark a setting approved. */
  approvalRef?: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface WeightedCriterion { key: string; label: string; weight: number; evidence?: string }

export interface ScorecardConfig extends Approvable {
  criteria: WeightedCriterion[];
  /** Undefined in the SOPs — must be set before evaluation can be finalised. */
  passThreshold?: number;
  minTechnicalScore?: number;
  tieBreakRule?: string;
}

export interface GraduationConfig extends Approvable {
  dimensions: WeightedCriterion[];
  /** >= eligibleMin -> eligible; >= conditionalMin -> conditional/extension; else not ready. */
  eligibleMin: number;
  conditionalMin: number;
  shortCohortMonths: number;
  longCohortMonths: number;
}

export interface TimerConfig extends Approvable {
  acknowledgementWorkingDays: number;
  screeningDays: number;
  clarificationWorkingDays: { min: number; max: number };
  admissionCommunicationWorkingDays: number;
  quarterlyReportWorkingDays: number;
  reviewRecordWorkingDays: number;
  mentorSessionLogWorkingDays: number;
}

export interface FeeLine { key: string; label: string; baseAmount: number; gstPercent: number; period: 'month' | 'year' }

/** A versioned fee schedule. The SOP 07 (2022) table is seeded as 'proposed' and is NOT effective until approved. */
export interface FeeSchedule extends Approvable {
  id: string;
  name: string;
  effectiveFrom?: string;
  lines: FeeLine[];
  rentDueDay: number;
  annualEscalationPercent: number;
  notes?: string;
}

export interface KpiTarget { key: string; label: string; annual: number; fiveYear: number; evidence: string }

export interface KpiConfig extends Approvable {
  targets: KpiTarget[];
  /** MoA Clause 8.4 minimum startups per financial year — tracked separately from the Annexure F target. */
  clause84MinStartupsPerFy: number;
}

export interface ApprovalRouteConfig {
  /** Member ids; empty -> falls back to every active tier <= approverMaxTier. */
  approverMemberIds: string[];
  approverMaxTier: number;
}

export interface IncubationSettings {
  id: 'default';
  /** Bumped on every save — settings are versioned, prior versions are kept in `history`. */
  version: number;
  fiscalYearStartMonth: number; // 1-12, 4 = April (Indian FY)
  programmeStartDate?: string; // ISO date; anchors the five-year cumulative view
  scorecard: ScorecardConfig;
  graduation: GraduationConfig;
  timers: TimerConfig;
  kpis: KpiConfig;
  feeSchedules: FeeSchedule[];
  approvalRoutes: Record<'selection' | 'admission' | 'renewal' | 'graduation' | 'exit', ApprovalRouteConfig>;
  updatedAt: string;
  updatedBy?: string;
}

export const STARTUP_STATUSES = ['Applicant', 'Selected', 'Onboarding', 'Active', 'Graduated', 'Exited', 'Waitlisted'] as const;
export type StartupStatus = (typeof STARTUP_STATUSES)[number];

export const STARTUP_PATHWAYS = ['Short-term (~6 months)', 'Long-term (~12 months)', 'Exception'] as const;
export type StartupPathway = (typeof STARTUP_PATHWAYS)[number];

export const STARTUP_MODES = ['Physical', 'Virtual', 'Other'] as const;
export type StartupMode = (typeof STARTUP_MODES)[number];

export interface StartupChange { at: string; by: string; field: string; from: unknown; to: unknown }

export interface Startup {
  /** Human-readable ID, e.g. RTBI-S-2026-001. Used on shared dashboards instead of the name. */
  id: string;
  name: string;
  sector?: string;
  stage?: string;
  technology?: string;
  legalStatus?: string; // 'Not incorporated' is recorded as such, never invented
  website?: string;
  status: StartupStatus;
  pathway: StartupPathway;
  mode?: StartupMode;
  cohort?: string;
  /** Tier-4 Member ids linked as founders / authorised contacts. */
  founderMemberIds: string[];
  /** Photos, pitches, case studies — external disclosure needs explicit consent. */
  consent: { externalDisclosure: boolean; photos: boolean; caseStudies: boolean; recordedAt?: string; recordedBy?: string };
  incubationStartDate?: string;
  /** Set only by the activation gate (all 10 onboarding items, or a written conditional approval). */
  activatedAt?: string;
  activationBasis?: 'complete' | 'conditional';
  sourceApplicationId?: string;
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  /** Append-only: no silent edits to startup data. */
  changeLog: StartupChange[];

  // Startup profile fields filled by the startup itself
  tagline?: string;
  logoUrl?: string;
  logoStorageKey?: string;
  aboutUs?: string;
  problem?: string;
  solution?: string;
  foundedYear?: string;
  teamSize?: string;
  location?: string;
  socials?: { linkedin?: string; twitter?: string; instagram?: string };
  profileCompletedAt?: string;
}

// ---------------------------------------------------------------- Applications (Phase 2)

export const APPLICATION_SECTIONS: { key: string; label: string; fields: { key: string; label: string; long?: boolean; required?: boolean }[] }[] = [
  { key: 'A', label: 'Application details', fields: [
    { key: 'call', label: 'Call / cohort' }, { key: 'mode', label: 'Preferred mode (physical, virtual, other)' } ] },
  { key: 'B', label: 'Startup and entity profile', fields: [
    { key: 'startupName', label: 'Startup name', required: true }, { key: 'website', label: 'Website' }, { key: 'address', label: 'Address' },
    { key: 'formationDate', label: 'Date of formation' }, { key: 'legalStatus', label: 'Legal status (write “Not incorporated” if so)', required: true },
    { key: 'registration', label: 'Registration details' }, { key: 'sector', label: 'Sector', required: true }, { key: 'stage', label: 'Stage', required: true } ] },
  { key: 'C', label: 'Founder / team profile', fields: [
    { key: 'founders', label: 'Founders: names, roles, experience, skills', long: true, required: true }, { key: 'contacts', label: 'Contacts', long: true },
    { key: 'shareholding', label: 'Shareholding summary', long: true }, { key: 'commitment', label: 'Founder commitment', long: true } ] },
  { key: 'D', label: 'Problem statement', fields: [
    { key: 'problem', label: 'Problem and target users', long: true, required: true }, { key: 'problemEvidence', label: 'Evidence the problem exists', long: true },
    { key: 'localIssue', label: 'Local technology issue addressed', long: true } ] },
  { key: 'E', label: 'Solution and technology', fields: [
    { key: 'solution', label: 'Description and technology basis', long: true, required: true }, { key: 'novelty', label: 'Novelty / differentiation', long: true },
    { key: 'devStage', label: 'Development stage, prototype / POC, architecture', long: true }, { key: 'techRisks', label: 'Key technical risks', long: true } ] },
  { key: 'F', label: 'IP and research origin', fields: [
    { key: 'ipOwnership', label: 'IP ownership / status, patents filed or granted, licences', long: true, required: true },
    { key: 'thirdPartyIp', label: 'Third-party IP and university / research permissions', long: true } ] },
  { key: 'G', label: 'Market and competition', fields: [
    { key: 'segments', label: 'Segments and competitors', long: true }, { key: 'validation', label: 'Validation: pilots, LOIs, orders', long: true }, { key: 'goToMarket', label: 'Go-to-market', long: true } ] },
  { key: 'H', label: 'Business model and finance', fields: [
    { key: 'revenueModel', label: 'Revenue model and pricing', long: true }, { key: 'costs', label: 'Costs', long: true },
    { key: 'funding', label: 'Funding raised or applied for', long: true }, { key: 'projections', label: '12-24 month projections', long: true } ] },
  { key: 'I', label: 'Sustainability and scalability', fields: [
    { key: 'scale', label: 'Scale potential, operating needs, constraints and mitigation', long: true } ] },
  { key: 'J', label: 'Milestones and support requested', fields: [
    { key: 'milestones', label: '6-12 month milestones', long: true }, { key: 'support', label: 'Mentor / technical / facility / investor / industry support wanted', long: true } ] },
  { key: 'K', label: 'Regulatory / risk', fields: [
    { key: 'regulatory', label: 'Regulatory, safety, clinical, data and cybersecurity requirements, status and gaps', long: true } ] },
];

export const SCREENING_AREAS = [
  'Applicant identity and team', 'Entity and stage', 'Technology relevance', 'Problem and customer', 'Completeness', 'Integrity, conflict and IP flags', 'Published eligibility rules',
] as const;

export const DECISION_OPTIONS = ['Selected', 'Selected subject to conditions', 'Waitlisted', 'Further information required', 'Not selected'] as const;
export type DecisionOption = (typeof DECISION_OPTIONS)[number];

export const APPLICATION_STATUSES = ['Received', 'Clarification required', 'Ineligible', 'Eligible', 'Evaluation', 'Decision recorded', 'Decision final'] as const;

export interface ApplicationFile { name: string; url: string; storageKey: string; type?: string; label?: string }

export interface ScreeningRecord {
  at: string; by: string;
  checks: Record<string, { result: 'yes' | 'no' | 'na'; evidence?: string }>;
  outcome: 'eligible' | 'clarification' | 'ineligible';
  criterion?: string;
}

export interface MissingDoc { item: string; requestedAt: string; dueBy: string; resolvedAt?: string }

export interface CoiDeclaration { memberId: string; memberName: string; at: string; conflict: boolean; mitigation?: string; action: 'participate' | 'recuse' }

export interface EvaluatorScorecard {
  memberId: string; memberName: string; specialist?: boolean;
  scores: Record<string, number>; weighted: number;
  recommendation?: string; comments?: string; submittedAt: string;
}

export interface ApplicationDecision {
  option: DecisionOption; recordedAt: string; recordedBy: string;
  authority: string; minutesRef?: string; conditions?: string; owner?: string; dueDate?: string; notes?: string;
  overrideReason?: string; aggregate?: number; reasonCategory?: string;
  /** True while the scorecard settings are still 'proposed' — such a decision cannot be finalised. */
  provisional: boolean;
  finalisedAt?: string; finalisedBy?: string; approvalRef?: string;
}

export interface Application {
  id: string;
  receivedAt: string;
  ackDueBy: string;
  acknowledgedAt?: string;
  status: (typeof APPLICATION_STATUSES)[number];
  applicantEmail: string;
  applicantName: string;
  sections: Record<string, string>;
  declaration: { accepted: boolean; signedName: string; signedDate: string };
  files: ApplicationFile[];
  screening?: ScreeningRecord;
  missingDocs: MissingDoc[];
  assigned: { memberId: string; name: string; specialist?: boolean }[];
  coi: CoiDeclaration[];
  scorecards: EvaluatorScorecard[];
  decision?: ApplicationDecision;
  startupId?: string;
  /** Append-only: the applicant's data is never silently edited. */
  log: { at: string; by: string; action: string; detail?: string }[];
}
