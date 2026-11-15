import type { IncubationSettings, FeeSchedule } from './types';

/**
 * Seed values taken from the RTBI SOPs. Every block is flagged 'proposed': the SOPs state these
 * weights / thresholds / fees need formal approval before they are treated as final.
 */
export const PROPOSED_FEE_SCHEDULE_2022: FeeSchedule = {
  id: 'fee_sop07_2022_proposed',
  name: 'SOP 07 (2022) rent proposal — NOT effective until approved in writing',
  status: 'proposed',
  lines: [
    { key: 'two-seater', label: '2-seater (128 sq ft)', baseAmount: 5000, gstPercent: 18, period: 'month' },
    { key: 'five-semi', label: '5-seater, semi-furnished (240 sq ft)', baseAmount: 8000, gstPercent: 18, period: 'month' },
    { key: 'five-full-ac', label: '5-seater, fully furnished with AC (240 sq ft)', baseAmount: 11000, gstPercent: 18, period: 'month' },
    { key: 'virtual', label: 'Virtual incubation', baseAmount: 3000, gstPercent: 18, period: 'year' },
  ],
  rentDueDay: 5,
  annualEscalationPercent: 5,
  notes: 'No equity, revenue share, royalty or deposit applies unless a signed agreement says so.',
};

export function defaultIncubationSettings(): IncubationSettings {
  return {
    id: 'default',
    version: 1,
    fiscalYearStartMonth: 4,
    scorecard: {
      status: 'proposed',
      criteria: [
        { key: 'plan', label: 'Project plan / business model, plans and goals', weight: 15 },
        { key: 'novelty', label: 'Novelty / differentiation', weight: 15 },
        { key: 'technical', label: 'Technical viability', weight: 20 },
        { key: 'financial', label: 'Financial feasibility', weight: 15 },
        { key: 'sustainability', label: 'Sustainability', weight: 10 },
        { key: 'scalability', label: 'Scalability', weight: 10 },
        { key: 'local', label: 'Local technology issue / bottleneck relevance', weight: 10 },
        { key: 'team', label: 'Team capability and execution readiness', weight: 5 },
      ],
    },
    graduation: {
      status: 'proposed',
      dimensions: [
        { key: 'product', label: 'Product / technology / solution progress', weight: 20 },
        { key: 'market', label: 'Customer / problem / market validation', weight: 20 },
        { key: 'business', label: 'Business model and execution plan', weight: 15 },
        { key: 'traction', label: 'Commercial traction / adoption / impact', weight: 15 },
        { key: 'team', label: 'Team capability and governance', weight: 10 },
        { key: 'resources', label: 'Funding, partnerships and resource readiness', weight: 10 },
        { key: 'compliance', label: 'Compliance, reporting and incubation engagement', weight: 10 },
      ],
      eligibleMin: 75,
      conditionalMin: 60,
      shortCohortMonths: 6,
      longCohortMonths: 12,
    },
    timers: {
      status: 'proposed',
      acknowledgementWorkingDays: 2,
      screeningDays: 14,
      clarificationWorkingDays: { min: 5, max: 10 },
      admissionCommunicationWorkingDays: 5,
      quarterlyReportWorkingDays: 10,
      reviewRecordWorkingDays: 10,
      mentorSessionLogWorkingDays: 3,
    },
    kpis: {
      status: 'proposed',
      clause84MinStartupsPerFy: 5,
      targets: [
        { key: 'incubated', label: 'Startups incubated', annual: 8, fiveYear: 40, evidence: 'Startup register, selection minutes, signed agreement, admission date' },
        { key: 'graduated', label: 'Startups successfully incubated and graduated', annual: 3, fiveYear: 15, evidence: 'Graduation/exit decision, outcome report, closure record' },
        { key: 'patents', label: 'Patents filed by startups', annual: 3, fiveYear: 15, evidence: 'Filing acknowledgement or number (filed, not granted)' },
        { key: 'commercialised', label: 'Products/technologies/services commercialised', annual: 2, fiveYear: 10, evidence: 'Licence, customer order, invoice' },
        { key: 'premises', label: 'Startups incubated at RTBI premises or virtually', annual: 3, fiveYear: 15, evidence: 'Space allocation or virtual agreement, service records' },
        { key: 'support', label: 'Other support provided to incubated startups', annual: 11, fiveYear: 55, evidence: 'Mentoring, training, investor connect, demo day, market access records' },
        { key: 'events', label: 'Events', annual: 10, fiveYear: 50, evidence: 'Approved plan, agenda, attendance, report, photographs, outcomes' },
      ],
    },
    feeSchedules: [PROPOSED_FEE_SCHEDULE_2022],
    approvalRoutes: {
      selection: { approverMemberIds: [], approverMaxTier: 2 },
      admission: { approverMemberIds: [], approverMaxTier: 2 },
      renewal: { approverMemberIds: [], approverMaxTier: 2 },
      graduation: { approverMemberIds: [], approverMaxTier: 2 },
      exit: { approverMemberIds: [], approverMaxTier: 2 },
    },
    updatedAt: new Date(0).toISOString(),
  };
}
