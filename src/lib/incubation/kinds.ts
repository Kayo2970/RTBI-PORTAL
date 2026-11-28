import { addWorkingDays, graduationBand, trlAssessmentId, weightedScore } from './rules';
import type { IncubationSettings, Startup } from './types';

/**
 * Register kinds. One generic store (`incubationRecords`) + one generic API/page, driven by these definitions.
 * Pure module — imported by both the server routes and the client pages. All SOP guardrails that apply to a
 * single record live in `validate` / `derive` here so they can never be bypassed by a page.
 */

export type FieldType = 'text' | 'textarea' | 'select' | 'number' | 'date' | 'checkbox' | 'startup' | 'member' | 'file' | 'record';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  hint?: string;
  min?: number;
  max?: number;
  /** Only managers (CEO / Super User / granted) can set this field. */
  managerOnly?: boolean;
  /** type 'record': the register kind it points at, and which of its fields to show as the label. */
  refKind?: string;
  refLabel?: string;
  /** Optional form section heading (presentation only; see sections.ts for the inferred default). */
  section?: string;
}

export interface KindCtx {
  settings: IncubationSettings;
  actorIsManager: boolean;
  actorId: string;
  /** Other records of the same kind for the same startup (oldest first), excluding the one being saved. */
  siblings: any[];
  startup?: Startup;
  now: Date;
}

export interface KindDef {
  kind: string;
  label: string;
  plural: string;
  description: string;
  startupScoped: boolean;
  /** Tier-4 founders may read records of their own linked startup. */
  startupCanRead: boolean;
  /** 'managers' = tier 1-2 / granted; 'staff' = tier 1-3. */
  write: 'managers' | 'staff';
  /** Tier-4 founders may also create/edit records of their own linked startup (e.g. progress submissions). */
  startupCanWrite?: boolean;
  /** Read access limited to managers (and the record's creator). */
  restricted?: boolean;
  fields: FieldDef[] | ((s: IncubationSettings) => FieldDef[]);
  columns: string[];
  derive?: (rec: any, ctx: KindCtx) => any;
  validate?: (rec: any, ctx: KindCtx) => string | null;
}

const text = (key: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'text', ...o });
const area = (key: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'textarea', ...o });
const sel = (key: string, label: string, options: string[], o: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'select', options, ...o });
const num = (key: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'number', ...o });
const date = (key: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'date', ...o });
const chk = (key: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'checkbox', ...o });
const startup = (o: Partial<FieldDef> = {}): FieldDef => ({ key: 'startupId', label: 'Startup', type: 'startup', required: true, ...o });
const member = (key: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'member', ...o });

export const RAG_STATUSES = ['Green', 'Amber', 'Red'] as const;
export const TRL_CONFIDENCE = ['High', 'Medium', 'Low/Provisional'] as const;
export const STAGE_GATE_DECISIONS = ['Proceed', 'Proceed with conditions', 'Revise and resubmit', 'Hold/defer', 'Escalate for specialist/PMC review', 'Stop/close work package'] as const;
export const RENEWAL_OUTCOMES = ['Renewal', 'Conditional renewal', 'Time-bound extension', 'Graduation', 'Non-renewal', 'Proposed termination'] as const;
export const GRADUATION_OUTCOMES = ['Graduate', 'Conditional graduation', 'Time-bound extension', 'Transfer to another pathway', 'Non-renewal/exit', 'Early graduation', 'Exception-approved continuation'] as const;
export const ADVERSE_OUTCOMES: string[] = ['Non-renewal', 'Proposed termination', 'Non-renewal/exit'];
export const EXTENSION_OUTCOMES: string[] = ['Time-bound extension', 'Exception-approved continuation'];
export const GRADUATED_OUTCOMES: string[] = ['Graduate', 'Early graduation'];
export const MENTOR_TYPES = ['Technical', 'Non-technical'];
export const COLLAB_AREAS = ['Funding / Investment', 'Technology / R&D', 'Market access', 'Mentoring', 'Training / Skilling', 'Infrastructure / Labs', 'Academic / Research', 'Government / Policy', 'Industry / Corporate', 'Other'];
export const COMMITTEE_NAME = 'Project Management Committee'; // SOP 09's "Monitoring" wording is not used (matches the Office Order)

const OFFICIAL_ADVERSE = (r: any): string | null => {
  if (!r.finalised) return null;
  if (!r.approvalRef?.trim()) return 'Adverse action needs the competent-authority approval reference before it can be finalised.';
  if (!r.legalReview) return 'Adverse action needs legal review recorded before it can be finalised.';
  if (!r.noticeGiven) return 'Adverse action needs written notice given to the startup.';
  if (!r.responseDeadline) return 'Adverse action needs the response-period deadline.';
  return null;
};

export const KPI_KEYS = ['incubated', 'graduated', 'patents', 'commercialised', 'premises', 'support', 'events'] as const;

export const KINDS: Record<string, KindDef> = {
  agreement: {
    kind: 'agreement', label: 'Agreement', plural: 'Agreements', startupScoped: true, startupCanRead: true, write: 'managers',
    description: 'Agreement register (SOP 07). An agreement is only "Executed" once every verification below is ticked.',
    fields: [
      startup(), text('title', 'Agreement title', { required: true }),
      date('startDate', 'Term start'), date('endDate', 'Term end / expiry'),
      text('signatory', 'Authorised signatory (verified)'),
      chk('legalNameVerified', 'Legal name verified'), chk('registrationVerified', 'Registration status verified'),
      chk('signatoryVerified', 'Authorised signatory verified'), chk('approvedTemplate', 'Approved template used'),
      chk('sideLetter', 'A side letter exists'), chk('sideLetterLegalReview', 'Side letter reviewed by legal'),
      chk('signaturesStampConfirmed', 'Signatures and stamp / e-stamp confirmed'),
      chk('copyGiven', 'Executed copy given to startup'), chk('registerUpdated', 'Agreement register updated'),
      text('feeScheduleId', 'Fee schedule reference'), area('notes', 'Notes'),
    ],
    columns: ['startupId', 'title', 'startDate', 'endDate', 'state'],
    derive: (r) => {
      const ok = r.legalNameVerified && r.registrationVerified && r.signatoryVerified && r.approvedTemplate && r.signaturesStampConfirmed && r.copyGiven && r.registerUpdated && (!r.sideLetter || r.sideLetterLegalReview);
      return { ...r, state: ok ? 'Executed' : 'Draft' };
    },
  },

  review: {
    kind: 'review', label: 'Quarterly Review', plural: 'Quarterly Reviews & RAG', startupScoped: true, startupCanRead: true, write: 'staff',
    description: 'Quarterly monitoring (SOP 08, Annexure E). RAG is a management signal — it never terminates anyone automatically.',
    fields: [
      startup(), text('quarter', 'Quarter (e.g. FY2026-27 Q1)', { required: true }),
      date('periodEnd', 'Quarter end date', { required: true }), date('reportSubmittedOn', 'Startup report submitted on'), date('reviewDate', 'RTBI review date'),
      area('technology', 'Technology / product (TRL, prototype, tests, releases)'), area('market', 'Market / customer (interviews, pilots, LOIs, contracts)'),
      area('finance', 'Business / finance (revenue, runway, costs)'),
      num('fundingApplied', 'Funding applied (₹)', { min: 0 }), num('fundingSanctioned', 'Funding sanctioned (₹)', { min: 0 }), num('fundingReceived', 'Funding received (₹)', { min: 0 }),
      area('team', 'Team / organisation'), area('ipRegulatory', 'IP / regulatory'), area('jobsImpact', 'Jobs and impact'),
      area('supportDelivered', 'Support delivered'), area('compliance', 'Compliance / engagement'),
      sel('rag', 'RAG status', [...RAG_STATUSES], { required: true }), area('ragRationale', 'RAG rationale', { required: true }),
      area('recoveryRootCause', 'Amber: root cause'), area('recoveryActions', 'Amber: recovery actions / resources'),
      text('recoveryOwner', 'Amber: owner'), date('recoveryDue', 'Amber: due date'),
      area('escalationNote', 'Red: escalation to CEO and competent authority'), text('escalatedTo', 'Red: escalated to'),
      chk('founderConfirmed', 'Founder confirmation received'), chk('evidenceIndexUpdated', 'Evidence index updated'),
      text('correctiveAction', 'Corrective action'), text('correctiveOwner', 'Corrective action owner'), date('correctiveDue', 'Corrective action due'),
      area('nextMilestones', 'Next-quarter milestones'),
    ],
    columns: ['startupId', 'quarter', 'rag', 'reviewDate', 'timeliness'],
    validate: (r) => {
      if (r.rag === 'Amber' && (!r.recoveryRootCause?.trim() || !r.recoveryActions?.trim() || !r.recoveryOwner?.trim() || !r.recoveryDue)) {
        return 'Amber needs a written recovery plan: root cause, actions, owner and due date.';
      }
      if (r.rag === 'Red' && (!r.escalationNote?.trim() || !r.escalatedTo?.trim())) return 'Red must be escalated to the CEO and competent authority — record the escalation note and who it went to.';
      if ((r.rag === 'Amber' || r.rag === 'Red') && (!r.correctiveAction?.trim() || !r.correctiveOwner?.trim() || !r.correctiveDue)) return 'Amber/Red needs a corrective action with owner and due date.';
      return null;
    },
    derive: (r, ctx) => {
      const t = ctx.settings.timers;
      let timeliness = '';
      if (r.periodEnd && r.reportSubmittedOn) {
        const due = addWorkingDays(new Date(r.periodEnd), t.quarterlyReportWorkingDays);
        timeliness = new Date(r.reportSubmittedOn) <= due ? 'Report on time' : 'Report late';
      }
      return { ...r, timeliness };
    },
  },

  trl: {
    kind: 'trl', label: 'TRL Assessment', plural: 'TRL Assessments', startupScoped: true, startupCanRead: true, write: 'staff',
    description: 'Technology readiness (SOP 09). TRL measures technology maturity only. It changes only with evidence — never automatically.',
    fields: [
      startup(), text('technology', 'Technology / work package', { required: true }),
      num('claimedTrl', 'Claimed TRL (1-9)', { min: 1, max: 9, required: true }), num('assessedTrl', 'Assessed TRL (1-9)', { min: 1, max: 9, required: true }),
      sel('confidence', 'Confidence', [...TRL_CONFIDENCE], { required: true }),
      text('evidenceIds', 'Evidence IDs (comma separated)', { required: true, hint: 'Highest level fully supported by evidence. Time, spend, grants or patent filings do not raise TRL.' }),
      area('rationale', 'Rationale', { required: true }), area('componentTrls', 'Component-level TRLs (system TRL is not an average)'),
      area('risks', 'Risks'), text('nextMilestone', 'Next milestone'),
      member('assessorId', 'Assessor', { required: true }), chk('coiDeclared', 'Assessor conflict-of-interest declaration filed', { required: true }),
      sel('coiAction', 'COI action', ['Participate', 'Participate with safeguards', 'Recuse']),
      sel('stageGate', 'Stage-gate decision', [...STAGE_GATE_DECISIONS]),
      area('disputeResponse', 'Startup dispute / written response (original assessment is kept)'), text('disputeOutcome', 'Dispute outcome'),
    ],
    columns: ['assessmentId', 'startupId', 'technology', 'assessedTrl', 'confidence', 'status'],
    validate: (r) => {
      if (!r.coiDeclared) return 'The assessor must file a conflict-of-interest declaration first.';
      if (r.coiAction === 'Recuse') return 'A recused assessor cannot record this assessment.';
      if (!String(r.evidenceIds || '').split(',').some(s => s.trim())) return 'A TRL assessment needs at least one evidence ID — TRL is never raised without evidence.';
      return null;
    },
    derive: (r, ctx) => {
      const confirmed = r.confidence !== 'Low/Provisional';
      const prevConfirmed = ctx.siblings.filter(s => s.technology === r.technology && s.status === 'Confirmed').map(s => Number(s.assessedTrl)).reduce((a, b) => Math.max(a, b), 0);
      return {
        ...r,
        assessmentId: r.assessmentId || trlAssessmentId(r.startupId, r.technology || 'TECH', ctx.now),
        status: confirmed ? 'Confirmed' : 'Provisional',
        // A Low/Provisional result is never reported as a confirmed advancement.
        confirmedTrl: confirmed ? Number(r.assessedTrl) : prevConfirmed || undefined,
      };
    },
  },

  renewal: {
    kind: 'renewal', label: 'Renewal Review', plural: 'Annual Renewals', startupScoped: true, startupCanRead: true, write: 'managers',
    description: 'Annual renewal (SOP 07). Finance must supply account and obligation status first. Adverse outcomes need legal review, notice, a response period and approval.',
    fields: [
      startup(), text('termYear', 'Term being reviewed', { required: true }),
      sel('financeAccountStatus', 'Finance account & obligation status', ['Clear', 'Dues outstanding', 'Not yet supplied'], { required: true }),
      area('financeNotes', 'Finance notes'), area('milestoneProgress', 'Progress against original and revised milestones'),
      area('engagement', 'Engagement with RTBI and use of support'), area('compliance', 'Compliance with the agreement'),
      area('futurePotential', 'Future potential'), area('nextTermPlan', 'Plan for the next term'),
      sel('outcome', 'Outcome', [...RENEWAL_OUTCOMES]), area('conditions', 'Conditions / extension period'),
      chk('legalReview', 'Legal review done (adverse action)'), chk('noticeGiven', 'Written notice given (adverse action)'), date('responseDeadline', 'Response period ends'),
      text('impartialReviewer', 'Impartial reviewer (where a conflict exists)'),
      text('approvalRef', 'Approval reference (competent authority)', { managerOnly: true }), chk('finalised', 'Finalise decision', { managerOnly: true }),
    ],
    columns: ['startupId', 'termYear', 'financeAccountStatus', 'outcome', 'state'],
    validate: (r) => {
      if (r.outcome && r.financeAccountStatus === 'Not yet supplied') return 'Finance must supply the account and obligation status before an outcome is recorded.';
      if (r.finalised && !r.outcome) return 'Choose an outcome before finalising.';
      if (ADVERSE_OUTCOMES.includes(r.outcome)) return OFFICIAL_ADVERSE(r);
      if (r.finalised && !r.approvalRef?.trim()) return 'Finalising needs an approval reference.';
      return null;
    },
    derive: (r) => ({ ...r, state: r.finalised ? 'Final' : r.outcome ? 'Pending approval' : 'Open' }),
  },

  graduation: {
    kind: 'graduation', label: 'Graduation Review', plural: 'Graduation Reviews', startupScoped: true, startupCanRead: true, write: 'managers',
    description: 'Graduation scorecard (SOP 10 — draft). Weights and bands come from Settings and show as Proposed until approved.',
    fields: (s) => [
      startup(), sel('pathway', 'Pathway', ['Short-term (~6 months)', 'Long-term (~12 months)', 'Exception'], { required: true }), date('reviewDate', 'Review date', { required: true }),
      chk('cAgreement', 'Signed agreement and amendments on file'), chk('cReports', 'Required reports submitted'), chk('cMeetings', 'Review meetings attended'),
      chk('cNoBreach', 'No unresolved breach or misrepresentation'), chk('cClearance', 'Finance / facility clearance reviewed'), chk('cProfile', 'Updated startup profile and post-incubation plan'),
      ...s.graduation.dimensions.map(d => num(`score_${d.key}`, `${d.label} (1-5, weight ${d.weight})`, { min: 1, max: 5 })),
      area('committeeRecommendation', 'Committee recommendation'),
      sel('outcome', 'Outcome', [...GRADUATION_OUTCOMES]),
      text('exceptionGrounds', 'Exception grounds (deep-tech, regulated, IP-intensive, pilot dependency, force majeure, …)'),
      date('scheduledEndDate', 'Scheduled end date'), date('exceptionRequestedOn', 'Exception / extension requested on'), date('extensionUntil', 'Extension until (must be a fixed date)'),
      chk('clearProgramme', 'Clearance signed: programme'), chk('clearFinance', 'Clearance signed: finance / facilities'), chk('clearOfficer', 'Clearance signed: authorised officer'),
      chk('legalReview', 'Legal review done (adverse action)'), chk('noticeGiven', 'Written notice given (adverse action)'), date('responseDeadline', 'Response period ends'),
      text('approvalRef', 'Approval reference', { managerOnly: true }), chk('finalised', 'Finalise decision', { managerOnly: true }),
      chk('letterIssued', 'Graduation letter issued (only if approved)', { managerOnly: true }),
    ],
    columns: ['startupId', 'pathway', 'total', 'band', 'outcome', 'state'],
    validate: (r, ctx) => {
      const scored = ctx.settings.graduation.dimensions.some(d => r[`score_${d.key}`]);
      if (scored && !(r.cAgreement && r.cReports && r.cMeetings && r.cNoBreach && r.cClearance && r.cProfile)) return 'Process conditions must all be met before the graduation scorecard is scored.';
      if (EXTENSION_OUTCOMES.includes(r.outcome)) {
        if (!r.extensionUntil) return 'Extensions must not be automatic or indefinite — set a fixed end date.';
        if (r.scheduledEndDate && r.exceptionRequestedOn && r.exceptionRequestedOn > r.scheduledEndDate) return 'Exception and extension requests must be made before the scheduled end date.';
      }
      if (r.letterIssued && !(r.finalised && r.approvalRef?.trim())) return 'A graduation letter can only be issued once the decision is approved.';
      if (r.finalised && GRADUATED_OUTCOMES.includes(r.outcome) && !(r.clearProgramme && r.clearFinance && r.clearOfficer)) return 'Clearance must be signed by programme, finance/facilities and the authorised officer.';
      if (ADVERSE_OUTCOMES.includes(r.outcome)) return OFFICIAL_ADVERSE(r);
      if (r.finalised && !r.approvalRef?.trim()) return 'Finalising needs an approval reference.';
      return null;
    },
    derive: (r, ctx) => {
      const g = ctx.settings.graduation;
      const scores: Record<string, number> = {};
      g.dimensions.forEach(d => { scores[d.key] = Number(r[`score_${d.key}`]) || 0; });
      const total = weightedScore(g.dimensions, scores);
      const base = new Date(r.reviewDate || ctx.now);
      const plus = (months: number) => { const d = new Date(base); d.setMonth(d.getMonth() + months); return d.toISOString().slice(0, 10); };
      return {
        ...r, total, band: graduationBand(total, g.eligibleMin, g.conditionalMin),
        settingsStatus: g.status, // 'proposed' until the graduation weights/bands are approved
        state: r.finalised && g.status === 'approved' ? 'Final' : r.outcome ? 'Pending approval' : 'Open',
        followUp6: plus(6), followUp12: plus(12),
      };
    },
  },

  exit: {
    kind: 'exit', label: 'Exit / Closure', plural: 'Exits & Closure', startupScoped: true, startupCanRead: true, write: 'managers',
    description: 'Exit and closure checklist (SOP 07). Closure needs all three clearance signatures.',
    fields: [
      startup(), area('reason', 'Reason / basis (written request or notice)', { required: true }), date('noticeDate', 'Notice / request date'),
      chk('clearProgramme', 'Clearance signed: programme'), chk('clearFinance', 'Clearance signed: finance / facilities'), chk('clearOfficer', 'Clearance signed: authorised officer'),
      chk('exitAcknowledged', 'Exit acknowledgement received'), chk('closed', 'Mark closed'),
    ],
    columns: ['startupId', 'noticeDate', 'closed', 'state'],
    validate: (r) => (r.closed && !(r.clearProgramme && r.clearFinance && r.clearOfficer && r.exitAcknowledged) ? 'Closure needs programme, finance/facilities and authorised-officer clearance plus the exit acknowledgement.' : null),
    derive: (r) => ({ ...r, state: r.closed ? 'Closed' : 'Open' }),
  },

  evidence: {
    kind: 'evidence', label: 'Evidence', plural: 'Evidence Index', startupScoped: true, startupCanRead: false, write: 'staff',
    description: 'Every reported KPI links to a source document, date, responsible officer and verifier. Funding is kept as applied / recommended / sanctioned / received.',
    fields: [
      startup({ required: false }),
      sel('kpiKey', 'KPI / purpose', [...KPI_KEYS, 'funding', 'general'], { required: true, hint: 'Patents count when filed (acknowledgement or number) — not when granted.' }),
      text('title', 'Title', { required: true }), text('docRef', 'Document reference / number'), { key: 'file', label: 'Source document', type: 'file' },
      date('evidenceDate', 'Document date', { required: true }), member('responsibleId', 'Responsible officer', { required: true }), member('verifierId', 'Verified by', { required: true }),
      sel('fundingStage', 'Funding stage (funding evidence only)', ['Applied', 'Recommended', 'Sanctioned', 'Received']), num('amount', 'Amount (₹)', { min: 0 }),
      chk('restricted', 'Restricted (managers only)'), chk('consent', 'Consent recorded for external disclosure'),
    ],
    columns: ['startupId', 'kpiKey', 'title', 'evidenceDate', 'verifierId'],
    validate: (r) => {
      if (!r.docRef?.trim() && !r.file) return 'Attach the source document or give its reference number.';
      if (r.kpiKey === 'funding' && !r.fundingStage) return 'Funding evidence must say whether it is applied, recommended, sanctioned or received.';
      if (r.verifierId && r.verifierId === r.responsibleId) return 'The verifier must be a different person from the responsible officer.';
      return null;
    },
  },

  mentor: {
    kind: 'mentor', label: 'Mentor', plural: 'Mentor Register', startupScoped: false, startupCanRead: false, write: 'managers',
    description: 'Mentor register (SOP 06). Directory only — mentors have no portal login.',
    fields: [
      text('name', 'Name', { required: true }), text('email', 'Email'), text('phone', 'Phone'), text('organisation', 'Organisation'), text('expertise', 'Domain expertise'),
      sel('mentorType', 'Technical / Non-technical', MENTOR_TYPES), startup({ key: 'menteeStartupId', label: 'Startup mentee associated', required: false }),
      chk('coiDeclared', 'Conflict-of-interest declaration filed'), area('coiDetails', 'COI details / safeguards'),
      area('engagementPlan', 'Engagement plan'),
      area('menteeReport', 'Mentor-mentee report (progress, outcomes, next steps)'), date('menteeReportDate', 'Mentor-mentee report date'), { key: 'menteeReportFile', label: 'Mentor-mentee report (file)', type: 'file' },
      sel('status', 'Status', ['Registered', 'Active', 'Closed']), chk('closureChecklistDone', 'Closure checklist done'),
    ],
    columns: ['name', 'mentorType', 'expertise', 'menteeStartupId', 'status', 'coiDeclared'],
    validate: (r) => (r.status === 'Active' && !r.coiDeclared ? 'A mentor needs a conflict-of-interest declaration before becoming Active.' : r.status === 'Closed' && !r.closureChecklistDone ? 'Complete the closure checklist before closing a mentor.' : null),
  },

  mentorSession: {
    kind: 'mentorSession', label: 'Mentor Session', plural: 'Mentor Sessions', startupScoped: true, startupCanRead: true, write: 'staff',
    description: 'Session log: record within the standard timer. Mentoring sessions are support delivered — never a commercial outcome.',
    fields: [
      startup(), { key: 'mentorId', label: 'Mentor', type: 'record', refKind: 'mentor', refLabel: 'name', required: true, hint: 'Pick from the mentor register.' },
      date('sessionDate', 'Session date', { required: true }), date('loggedOn', 'Logged on', { required: true }), area('summary', 'Summary / actions'),
      num('feedbackScore', 'Feedback score (1-5)', { min: 1, max: 5 }), area('feedbackNotes', 'Feedback notes'),
    ],
    columns: ['startupId', 'mentorId', 'sessionDate', 'feedbackScore', 'timeliness'],
    derive: (r, ctx) => {
      const due = addWorkingDays(new Date(r.sessionDate), ctx.settings.timers.mentorSessionLogWorkingDays);
      return { ...r, timeliness: r.loggedOn && new Date(r.loggedOn) > due ? 'Logged late' : 'On time' };
    },
  },

  progress: {
    kind: 'progress', label: 'Progress Submission', plural: 'Startup Progress Submissions', startupScoped: true, startupCanRead: true, startupCanWrite: true, write: 'staff',
    description: 'Startup progress submission: outreach, milestones, awards, grants, funding, competitions and an overall growth overview. Founders submit for their own startup; RTBI staff verify against evidence.',
    fields: [
      startup(), text('period', 'Reporting period (e.g. FY2026-27 Q2)', { required: true, section: 'Period' }), date('submittedOn', 'Submitted on', { section: 'Period' }),
      area('growthOverview', 'Overall growth overview', { required: true, section: 'Growth overview' }),
      num('revenue', 'Revenue in period (₹)', { min: 0, section: 'Growth overview' }), num('customers', 'Customers / users (total)', { min: 0, section: 'Growth overview' }),
      num('teamSize', 'Team size', { min: 0, section: 'Growth overview' }), num('jobsCreated', 'Jobs created in period', { min: 0, section: 'Growth overview' }),
      area('outreachPrograms', 'Outreach programs participated in (name, date, role)', { section: 'Outreach & milestones' }),
      area('milestones', 'Milestones achieved', { section: 'Outreach & milestones' }),
      area('awards', 'Awards and recognitions', { section: 'Awards, grants & funding' }),
      area('grants', 'Grants received (scheme, amount, date)', { section: 'Awards, grants & funding' }),
      num('fundingReceived', 'Funding received in period (₹)', { min: 0, section: 'Awards, grants & funding' }), text('fundingSource', 'Funding source / investor', { section: 'Awards, grants & funding' }),
      area('competitionsWon', 'Competitions won / shortlisted', { section: 'Awards, grants & funding' }),
      area('ipFiled', 'Patents / IP filed or granted', { section: 'Awards, grants & funding' }),
      area('challenges', 'Challenges and support needed from RTBI', { section: 'Next steps' }), area('nextPlans', 'Plans for next period', { section: 'Next steps' }),
      { key: 'supportingDoc', label: 'Supporting document (certificates, letters, sanction orders)', type: 'file' },
      chk('verified', 'Verified by RTBI against evidence', { managerOnly: true, section: 'RTBI verification' }), area('staffRemarks', 'RTBI remarks', { managerOnly: true, section: 'RTBI verification' }),
    ],
    columns: ['startupId', 'period', 'revenue', 'fundingReceived', 'verified'],
  },

  cohort: {
    kind: 'cohort', label: 'Cohort', plural: 'Cohorts', startupScoped: false, startupCanRead: true, write: 'managers',
    description: 'Cohort definitions (SOP 04). Milestones are tracked under Cohort Milestones.',
    fields: [text('name', 'Cohort name', { required: true }), date('startDate', 'Start'), date('endDate', 'End'), sel('pathway', 'Pathway', ['Short-term (~6 months)', 'Long-term (~12 months)', 'Exception']), area('notes', 'Notes')],
    columns: ['name', 'pathway', 'startDate', 'endDate'],
  },

  milestone: {
    kind: 'milestone', label: 'Cohort Milestone', plural: 'Cohort Milestones', startupScoped: true, startupCanRead: true, write: 'staff',
    description: 'Cohort milestone tracker (SOP 04).',
    fields: [startup(), text('cohort', 'Cohort'), text('title', 'Milestone', { required: true }), date('dueDate', 'Due date', { required: true }), sel('status', 'Status', ['Planned', 'In progress', 'Done', 'Delayed']), text('evidenceRef', 'Evidence reference')],
    columns: ['startupId', 'cohort', 'title', 'dueDate', 'status'],
  },

  programEvent: {
    kind: 'programEvent', label: 'Programme Event', plural: 'Programme Events', startupScoped: false, startupCanRead: false, write: 'staff',
    description: 'Event concept note, readiness checklist and report evidence (SOP 04). Outputs and outcomes are recorded separately.',
    fields: [
      text('title', 'Event', { required: true }), date('date', 'Date', { required: true }), area('conceptNote', 'Concept note'),
      chk('rAgenda', 'Agenda approved'), chk('rBudget', 'Budget / approval in place'), chk('rVenue', 'Venue and logistics ready'), chk('rComms', 'Communications ready'),
      sel('status', 'Status', ['Planned', 'Held', 'Reported', 'Cancelled']), num('attendance', 'Output: attendance', { min: 0 }), area('outcomes', 'Outcomes (separate from outputs)'),
      chk('reportEvidence', 'Report, attendance and photographs filed in the evidence index'),
    ],
    columns: ['title', 'date', 'status', 'attendance'],
    validate: (r) => (r.status === 'Reported' && !r.reportEvidence ? 'Reported events need the report evidence filed first.' : null),
  },

  partnership: {
    kind: 'partnership', label: 'Partnership', plural: 'Partnerships', startupScoped: false, startupCanRead: false, write: 'managers',
    description: 'Collaboration and partnerships (SOP 03): opportunity → due diligence → approval → performance review → closure.',
    fields: [
      text('partner', 'Partner', { required: true }),
      text('partnerSpoc', 'SPOC from partner'), text('partnerSpocContact', 'Partner SPOC email / phone'), member('tbiSpoc', 'SPOC from TBI'),
      sel('collabArea', 'Area of collaboration', COLLAB_AREAS), area('opportunityNote', 'Opportunity note'),
      sel('status', 'Status', ['Opportunity', 'Due diligence', 'Approval pending', 'Active', 'Under review', 'Closed']),
      chk('dueDiligenceDone', 'Due-diligence checklist complete'), area('dueDiligenceNotes', 'Due-diligence notes'),
      text('approvalRef', 'Approval reference', { managerOnly: true }), area('performanceReview', 'Performance review'), chk('closureChecklistDone', 'Closure checklist done'),
    ],
    columns: ['partner', 'collabArea', 'partnerSpoc', 'tbiSpoc', 'status', 'approvalRef'],
    validate: (r) => ((r.status === 'Active') && !(r.dueDiligenceDone && r.approvalRef?.trim()) ? 'A partnership becomes Active only after due diligence and an approval reference.' : r.status === 'Closed' && !r.closureChecklistDone ? 'Complete the closure checklist before closing.' : null),
  },

  meeting: {
    kind: 'meeting', label: 'Meeting', plural: 'PMC / BoG Meetings', startupScoped: false, startupCanRead: false, write: 'managers',
    description: `${COMMITTEE_NAME} and Board meetings. Minutes cannot be finalised without the KITS nominee present (verify the exact MoA clause).`,
    fields: [
      sel('body', 'Body', [COMMITTEE_NAME, 'Board of Governors'], { required: true }), date('date', 'Date', { required: true }), text('time', 'Time'), text('venue', 'Venue / mode'),
      area('attendees', 'Attendance — present (name, designation)'), area('absentees', 'Attendance — absent / leave of absence'), num('attendanceCount', 'Members present (count)', { min: 0 }),
      chk('kitsNomineePresent', 'KITS nominee present'), chk('quorumMet', 'Quorum met'),
      area('momAgenda', 'MOM: agenda items'), area('momDiscussion', 'MOM: discussion'), area('momDecisions', 'MOM: decisions / resolutions'),
      area('momActions', 'MOM: action items (item — owner — due date)'), date('nextMeeting', 'MOM: next meeting date'),
      text('minutesRef', 'Minutes reference'), chk('minutesFinalised', 'Minutes finalised'),
      area('risksReviewed', 'Risk register reviewed / KPI shortfall corrective actions'),
    ],
    columns: ['body', 'date', 'attendanceCount', 'kitsNomineePresent', 'minutesFinalised'],
    validate: (r) => (r.minutesFinalised && !r.kitsNomineePresent ? 'Meeting may not be valid: the KITS nominee was not recorded as present. Resolve before finalising the minutes.' : null),
  },

  incident: {
    kind: 'incident', label: 'Incident / Complaint', plural: 'Incidents & Complaints', startupScoped: true, startupCanRead: false, write: 'staff', restricted: true,
    description: 'Restricted records — visible only to managers and the person who logged them. Urgent risks go up immediately, not at the next meeting.',
    fields: [
      startup({ required: false }), sel('type', 'Type', ['Complaint', 'Incident', 'Technical failure', 'Safety incident', 'Change of ownership / design / supplier'], { required: true }),
      area('description', 'Description', { required: true }), date('reportedOn', 'Reported on', { required: true }),
      chk('urgent', 'Urgent — escalated immediately'), text('escalatedTo', 'Escalated to'), area('action', 'Action taken'), sel('status', 'Status', ['Open', 'Under review', 'Closed']),
    ],
    columns: ['startupId', 'type', 'reportedOn', 'urgent', 'status'],
    validate: (r) => (r.urgent && !r.escalatedTo?.trim() ? 'Urgent items must say who they were escalated to.' : null),
  },
};

export function kindFields(def: KindDef, settings: IncubationSettings): FieldDef[] {
  return typeof def.fields === 'function' ? def.fields(settings) : def.fields;
}

export const KIND_ORDER = Object.keys(KINDS);
