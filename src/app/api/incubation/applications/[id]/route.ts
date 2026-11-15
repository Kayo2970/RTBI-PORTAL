import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { dispatchEmail } from '@/lib/email-service';
import { fanOutAutoApproval, cascadeCloseAutoApprovals, type ApprovalPanelMember } from '@/lib/approval-sync';
import { isStaffTier, isRouteApprover } from '@/lib/permissions-server';
import { incubationAudit } from '@/lib/incubation/audit-server';
import { loadSettings } from '@/lib/incubation/records-server';
import { viewApplication, isManagerActor } from '@/lib/incubation/applications-server';
import { addWorkingDays, nextStartupId, weightedScore, weightsValid } from '@/lib/incubation/rules';
import {
  DECISION_OPTIONS, SCREENING_AREAS, STARTUP_MODES,
  type Application, type ApplicationDecision, type Startup, type StartupMode,
} from '@/lib/incubation/types';

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    if (!isStaffTier(actor)) return fail('Not found', 404);
    const app = (await readCollection<Application>('applications')).find(a => a.id === id);
    const view = app ? viewApplication(app, actor, await isManagerActor(actor)) : null;
    return view ? NextResponse.json(view) : fail('Not found', 404);
  } catch (err) {
    return apiError(err, 'incubation-application-get', 500);
  }
}

/**
 * PATCH { action, ... }. Applicant data is never edited — every action appends to `log`.
 *   acknowledge | screen | resolveMissing | assign        — managers
 *   coi | score                                           — the assigned evaluator (COI is a hard gate before scoring)
 *   decide                                                — managers (records a recommendation)
 *   finalise                                              — the configured selection approver (blocked while settings are only 'proposed')
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    if (!isStaffTier(actor)) return fail('Not found', 404);
    const body = await request.json();
    const settings = await loadSettings();
    const isManager = await isManagerActor(actor);
    const apps = await readCollection<Application>('applications');
    const app = apps.find(a => a.id === id);
    if (!app) return fail('Not found', 404);

    const now = new Date();
    const nowIso = now.toISOString();
    const logEntry = (action: string, detail?: string) => ({ at: nowIso, by: actor.id, action, detail });
    let next: Application = { ...app };
    let afterCommit: (() => Promise<void>) | null = null;
    const managerOnly = () => { if (!isManager) throw new ForbiddenError('Only the CEO or Super User can do this.'); };

    switch (body.action) {
      case 'acknowledge': {
        managerOnly();
        next = { ...app, acknowledgedAt: nowIso, log: [...app.log, logEntry('Acknowledged')] };
        break;
      }

      case 'screen': {
        managerOnly();
        const outcome = body.outcome;
        if (!['eligible', 'clarification', 'ineligible'].includes(outcome)) return fail('Choose a screening outcome.');
        const checks: Record<string, any> = {};
        for (const area of SCREENING_AREAS) {
          const c = body.checks?.[area];
          if (!c || !['yes', 'no', 'na'].includes(c.result)) return fail(`Screening: answer "${area}".`);
          if (c.result === 'no' && !str(c.evidence)) return fail(`Screening: add the evidence/reason for "${area}".`);
          checks[area] = { result: c.result, evidence: str(c.evidence) || undefined };
        }
        if (outcome === 'ineligible' && !str(body.criterion)) return fail('Ineligible must cite the published criterion that was not met.');
        if (outcome === 'eligible' && Object.values(checks).some((c: any) => c.result === 'no')) return fail('An applicant with a failed check cannot be marked eligible — choose clarification or ineligible.');
        let missingDocs = app.missingDocs || [];
        let status: Application['status'] = outcome === 'eligible' ? 'Eligible' : outcome === 'ineligible' ? 'Ineligible' : 'Clarification required';
        if (outcome === 'clarification') {
          const items: string[] = (Array.isArray(body.items) ? body.items : []).map((i: unknown) => str(i, 300)).filter(Boolean);
          if (!items.length) return fail('List what is missing. Staff must ask in writing and must not fill gaps themselves.');
          const { min, max } = settings.timers.clarificationWorkingDays;
          const days = Number(body.deadlineWorkingDays);
          if (!Number.isFinite(days) || days < min || days > max) return fail(`The response deadline must be ${min}-${max} working days.`);
          const dueBy = addWorkingDays(now, days).toISOString();
          missingDocs = [...missingDocs, ...items.map(item => ({ item, requestedAt: nowIso, dueBy }))];
          const to = app.applicantEmail;
          afterCommit = async () => {
            await dispatchEmail({ to, category: 'SYSTEM', subject: `RTBI application ${app.id} — information required`,
              bodyText: `Dear ${app.applicantName},\n\nTo continue screening application ${app.id}, please send us:\n- ${items.join('\n- ')}\n\nPlease respond by ${dueBy.slice(0, 10)}.\n\nRTBI` }).catch(e => console.error('[incubation] clarification email failed', e));
          };
        }
        next = { ...app, status, missingDocs, screening: { at: nowIso, by: actor.id, checks, outcome, criterion: str(body.criterion) || undefined }, log: [...app.log, logEntry(`Screened: ${outcome}`, str(body.criterion))] };
        break;
      }

      case 'resolveMissing': {
        managerOnly();
        const idx = Number(body.index);
        if (!app.missingDocs?.[idx]) return fail('No such item.');
        next = { ...app, missingDocs: app.missingDocs.map((m, i) => (i === idx ? { ...m, resolvedAt: nowIso } : m)), log: [...app.log, logEntry('Missing item received', app.missingDocs[idx].item)] };
        break;
      }

      case 'assign': {
        managerOnly();
        if (!['Eligible', 'Evaluation'].includes(app.status)) return fail('Only eligible applications can be assigned to evaluators.');
        const members = await readCollection<any>('members');
        const picks: any[] = Array.isArray(body.evaluators) ? body.evaluators : [];
        const assigned = picks.map(p => {
          const m = members.find(x => x.id === p?.memberId && x.status !== 'Terminated' && typeof x.tier === 'number' && x.tier <= 3);
          return m ? { memberId: m.id, name: m.name, specialist: !!p.specialist } : null;
        }).filter(Boolean) as Application['assigned'];
        if (!assigned.length) return fail('Choose at least one evaluator (tier 1-3).');
        next = { ...app, status: 'Evaluation', assigned, log: [...app.log, logEntry('Evaluators assigned', assigned.map(a => a.name).join(', '))] };
        break;
      }

      case 'coi': {
        if (!app.assigned.some(a => a.memberId === actor.id)) throw new ForbiddenError('You are not assigned to this application.');
        if (app.scorecards.some(s => s.memberId === actor.id)) return fail('You have already submitted your scorecard.');
        const conflict = !!body.conflict;
        const action = body.coiAction === 'recuse' ? 'recuse' : 'participate';
        if (conflict && !str(body.mitigation)) return fail('Describe the conflict and the safeguards.');
        const decl = { memberId: actor.id, memberName: actor.name, at: nowIso, conflict, mitigation: str(body.mitigation) || undefined, action } as const;
        next = { ...app, coi: [...app.coi.filter(c => c.memberId !== actor.id), decl], log: [...app.log, logEntry('COI declared', `${actor.name}: ${conflict ? 'conflict' : 'none'} → ${action}`)] };
        break;
      }

      case 'score': {
        if (!app.assigned.some(a => a.memberId === actor.id)) throw new ForbiddenError('You are not assigned to this application.');
        const coi = app.coi.find(c => c.memberId === actor.id);
        if (!coi) return fail('File your conflict-of-interest declaration before scoring.');
        if (coi.action === 'recuse') return fail('You recused yourself from this application.');
        if (app.scorecards.some(s => s.memberId === actor.id)) return fail('Your scorecard is already submitted and cannot be changed.');
        if (!weightsValid(settings.scorecard.criteria)) return fail('The scorecard weights in Settings do not total 100.');
        const scores: Record<string, number> = {};
        for (const c of settings.scorecard.criteria) {
          const v = Number(body.scores?.[c.key]);
          if (!Number.isInteger(v) || v < 1 || v > 5) return fail(`Score "${c.label}" from 1 to 5.`);
          scores[c.key] = v;
        }
        const specialist = app.assigned.find(a => a.memberId === actor.id)?.specialist;
        next = { ...app, scorecards: [...app.scorecards, { memberId: actor.id, memberName: actor.name, specialist, scores, weighted: weightedScore(settings.scorecard.criteria, scores), recommendation: str(body.recommendation, 100) || undefined, comments: str(body.comments) || undefined, submittedAt: nowIso }],
          log: [...app.log, logEntry('Scorecard submitted', actor.name)] };
        break;
      }

      case 'decide': {
        managerOnly();
        const option = body.option;
        if (!(DECISION_OPTIONS as readonly string[]).includes(option)) return fail('Choose a decision.');
        if (app.decision?.finalisedAt) return fail('This decision is final.');
        if (!str(body.authority)) return fail('Record the deciding authority.');
        const selecting = option === 'Selected' || option === 'Selected subject to conditions';
        const cards = app.scorecards;
        const aggregate = cards.length ? Math.round((cards.reduce((s, c) => s + c.weighted, 0) / cards.length) * 100) / 100 : undefined;
        const override = str(body.overrideReason);
        if (selecting || option === 'Not selected' || option === 'Waitlisted') {
          if (!cards.length) return fail('At least one submitted scorecard is needed before a selection decision.');
          if (cards.length < app.assigned.length && !override) return fail('Not every assigned evaluator has submitted. Wait, or record an override reason.');
        }
        if (option === 'Selected subject to conditions' && !str(body.conditions)) return fail('Record the conditions, owner and due date.');
        if (selecting) {
          const { passThreshold, minTechnicalScore } = settings.scorecard;
          if (passThreshold !== undefined && aggregate !== undefined && aggregate < passThreshold && !override) return fail(`Aggregate ${aggregate} is below the pass threshold ${passThreshold}. Record an override reason to proceed.`);
          if (minTechnicalScore !== undefined && cards.length) {
            const techAvg = cards.reduce((s, c) => s + (c.scores['technical'] || 0), 0) / cards.length;
            if (techAvg < minTechnicalScore && !override) return fail(`Average technical score ${techAvg.toFixed(1)} is below the minimum ${minTechnicalScore}. Record an override reason to proceed.`);
          }
        }
        const decision: ApplicationDecision = {
          option, recordedAt: nowIso, recordedBy: actor.id, authority: str(body.authority, 300), minutesRef: str(body.minutesRef, 300) || undefined,
          conditions: str(body.conditions) || undefined, owner: str(body.owner, 200) || undefined, dueDate: /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate || '') ? body.dueDate : undefined,
          notes: str(body.notes) || undefined, overrideReason: override || undefined, aggregate, reasonCategory: str(body.reasonCategory, 200) || undefined,
          provisional: settings.scorecard.status !== 'approved',
        };
        next = { ...app, status: 'Decision recorded', decision, log: [...app.log, logEntry(`Decision recorded: ${option}`, decision.provisional ? 'provisional — scorecard settings still proposed' : undefined)] };
        afterCommit = async () => {
          const members = await readCollection<any>('members');
          const route = settings.approvalRoutes.selection;
          const panel: ApprovalPanelMember[] = members
            .filter(m => m.status !== 'Terminated' && m.id !== actor.id && isRouteApprover(m, route))
            .map(m => ({ id: m.id, name: m.name, email: m.email, label: 'Selection Approver' }));
          if (panel.length) {
            await fanOutAutoApproval({ entityType: 'incubation', entityId: app.id, entityTitle: `${app.id} — ${app.sections.startupName || app.applicantName}: ${option}`,
              requesterId: actor.id, requesterName: actor.name, requesterEmail: actor.email, message: 'A selection decision needs final approval before it is communicated.', customPanel: panel });
          }
        };
        break;
      }

      case 'finalise': {
        const route = settings.approvalRoutes.selection;
        if (!isRouteApprover(actor, route)) throw new ForbiddenError('You are not a configured selection approver.');
        if (!app.decision) return fail('Record a decision first.');
        if (app.decision.finalisedAt) return fail('Already final.');
        if (settings.scorecard.status !== 'approved') return fail('The selection scorecard settings are still Proposed. Approve them in Incubation Settings before any decision can be final.');
        const ref = str(body.approvalRef, 300);
        if (!ref) return fail('Enter the approval reference (minutes / order number).');
        const decision = { ...app.decision, finalisedAt: nowIso, finalisedBy: actor.id, approvalRef: ref, provisional: false };
        const keep = decision.option === 'Selected' || decision.option === 'Selected subject to conditions' || decision.option === 'Waitlisted';
        let startupId = app.startupId;
        if (keep && !startupId) {
          let created!: Startup;
          await mutateCollection<Startup>('startups', cur => {
            const s = app.sections;
            const mode = (STARTUP_MODES as readonly string[]).find(m => (s.mode || '').toLowerCase().startsWith(m.toLowerCase())) as StartupMode | undefined;
            created = { id: nextStartupId(cur.map(x => x.id), now), name: s.startupName || app.applicantName, sector: s.sector, stage: s.stage, technology: s.solution?.slice(0, 120), legalStatus: s.legalStatus, website: s.website,
              status: decision.option === 'Waitlisted' ? 'Waitlisted' : 'Selected', pathway: 'Long-term (~12 months)', mode, founderMemberIds: [], consent: { externalDisclosure: false, photos: false, caseStudies: false },
              sourceApplicationId: app.id, createdAt: nowIso, createdBy: actor.id, updatedAt: nowIso, changeLog: [] };
            return [created, ...cur];
          });
          startupId = created.id;
        }
        next = { ...app, status: 'Decision final', decision, startupId, log: [...app.log, logEntry('Decision finalised', `${decision.option} — ref ${ref}`)] };
        const to = app.applicantEmail;
        afterCommit = async () => {
          await cascadeCloseAutoApprovals('incubation', app.id, 'approved', actor.name).catch(() => {});
          const lines = [`Dear ${app.applicantName},`, '', `Your application ${app.id} has been reviewed. Outcome: ${decision.option}.`];
          if (decision.conditions) lines.push(`Conditions: ${decision.conditions}`);
          if (decision.option === 'Not selected' && decision.reasonCategory) lines.push(`Reason category: ${decision.reasonCategory}`);
          lines.push('', 'A selection decision does not by itself activate services. An admission letter and agreement will follow where applicable.', '', 'RTBI');
          await dispatchEmail({ to, category: 'SYSTEM', subject: `RTBI application ${app.id} — outcome`, bodyText: lines.join('\n') }).catch(e => console.error('[incubation] decision email failed', e));
        };
        break;
      }

      default:
        return fail('Unknown action.');
    }

    await mutateCollection<Application>('applications', cur => cur.map(a => (a.id === id ? next : a)));
    await incubationAudit(actor, `APPLICATION_${String(body.action).toUpperCase()}`, id, `Application ${id}: ${body.action}.`);
    if (afterCommit) { try { await afterCommit(); } catch (e) { console.error('[incubation] post-commit step failed', e); } }
    return NextResponse.json(viewApplication(next, actor, isManager));
  } catch (err) {
    return apiError(err, 'incubation-application-patch', 400);
  }
}
