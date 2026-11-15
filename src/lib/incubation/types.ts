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
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  /** Append-only: no silent edits to startup data. */
  changeLog: StartupChange[];
}
