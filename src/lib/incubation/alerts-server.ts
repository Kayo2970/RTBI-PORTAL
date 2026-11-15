import { readCollection } from '../server-db';
import { isInternalStaff } from '../permissions-server';
import { visibleStartupsFor } from './startups-server';
import { loadSettings } from './records-server';
import { addWorkingDays, lastQuarterEnd } from './rules';
import type { Application, Startup } from './types';

export interface IncubationAlert { id: string; title: string; detail: string; severity: 'overdue' | 'soon' | 'info'; link: string; date?: string }
export interface CalendarItem { id: string; date: string; title: string; type: string; link: string }

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Service timers + deadlines the actor should act on. Startup-tier users only see their own startup's items. */
export async function computeAlerts(actor: any, now = new Date()): Promise<IncubationAlert[]> {
  const settings = await loadSettings();
  const staff = isInternalStaff(actor);
  const [startupsAll, recs, apps] = await Promise.all([visibleStartupsFor(actor), readCollection<any>('incubationRecords'), staff ? readCollection<Application>('applications') : Promise.resolve([] as Application[])]);
  const alerts: IncubationAlert[] = [];
  const t = settings.timers;

  if (staff) {
    for (const a of apps) {
      const link = `/dashboard/incubation/applications?open=${a.id}`;
      const name = a.sections?.startupName || a.applicantName;
      if (a.status === 'Received' && !a.acknowledgedAt && new Date(a.ackDueBy) < now) alerts.push({ id: `ack_${a.id}`, title: `Acknowledge ${a.id}`, detail: `${name}: acknowledgement was due ${a.ackDueBy.slice(0, 10)}.`, severity: 'overdue', link });
      if (['Received', 'Clarification required'].includes(a.status) && !a.screening && new Date(new Date(a.receivedAt).getTime() + t.screeningDays * DAY) < now) alerts.push({ id: `scr_${a.id}`, title: `Screen ${a.id}`, detail: `${name}: screening target (${t.screeningDays} days) has passed.`, severity: 'overdue', link });
      for (const [i, m] of (a.missingDocs || []).entries()) {
        if (!m.resolvedAt && new Date(m.dueBy) < now) alerts.push({ id: `mis_${a.id}_${i}`, title: `Missing item overdue — ${a.id}`, detail: `${name}: "${m.item}" was due ${m.dueBy.slice(0, 10)}.`, severity: 'overdue', link });
      }
      if (a.decision?.finalisedAt && a.startupId && ['Selected', 'Selected subject to conditions'].includes(a.decision.option)) {
        // Admission letter due within N working days of the final decision (done = the onboarding "admission" item is complete).
        const ob = recs.find(r => r.kind === 'onboarding' && r.startupId === a.startupId);
        if (!ob?.items?.admission?.done) {
          const due = addWorkingDays(new Date(a.decision.finalisedAt), t.admissionCommunicationWorkingDays);
          const adm = `/dashboard/incubation/onboarding?startup=${a.startupId}`;
          if (due < now) alerts.push({ id: `adm_${a.id}`, title: `Admission communication overdue — ${a.startupId}`, detail: `${name}: due ${iso(due)} (${t.admissionCommunicationWorkingDays} working days after the final decision).`, severity: 'overdue', link: adm });
          else if (due.getTime() - now.getTime() <= 2 * DAY) alerts.push({ id: `adm_${a.id}`, title: `Admission communication due ${iso(due)} — ${a.startupId}`, detail: `${name}: send the admission letter.`, severity: 'soon', link: adm });
        }
      }
      if (a.status === 'Decision recorded' && a.decision && new Date(a.decision.recordedAt) < new Date(now.getTime() - 3 * DAY)) alerts.push({ id: `fin_${a.id}`, title: `Decision awaiting final approval — ${a.id}`, detail: `${name}: ${a.decision.option}${a.decision.provisional ? ' (provisional — settings still Proposed)' : ''}.`, severity: 'soon', link });
    }
  }

  const q = lastQuarterEnd(now, settings.fiscalYearStartMonth);
  const reportDue = addWorkingDays(q.end, t.quarterlyReportWorkingDays);
  const active = startupsAll.filter((s: Startup) => s.status === 'Active');
  for (const s of active) {
    const mine = recs.filter(r => r.kind === 'review' && r.startupId === s.id);
    const hasThisQuarter = mine.some(r => r.quarter === q.label || (r.periodEnd && r.periodEnd >= iso(q.end)));
    const link = `/dashboard/incubation/records/review`;
    if (!hasThisQuarter && now > reportDue) alerts.push({ id: `qr_${s.id}_${q.label}`, title: `Quarterly review overdue — ${s.id}`, detail: `${q.label}: report was due ${iso(reportDue)} (${t.quarterlyReportWorkingDays} working days after quarter end).`, severity: 'overdue', link });
    else if (!hasThisQuarter) alerts.push({ id: `qr_${s.id}_${q.label}`, title: `Quarterly report due ${iso(reportDue)} — ${s.id}`, detail: `${q.label}.`, severity: 'info', link });
    if (staff) {
      for (const r of mine) {
        if (r.reportSubmittedOn && !r.reviewDate && addWorkingDays(new Date(r.reportSubmittedOn), t.reviewRecordWorkingDays) < now) alerts.push({ id: `rv_${r.id}`, title: `Record the review — ${s.id}`, detail: `${r.quarter}: review record was due within ${t.reviewRecordWorkingDays} working days of the report.`, severity: 'overdue', link });
      }
      const latest = [...mine].sort((a, b) => String(b.periodEnd || '').localeCompare(String(a.periodEnd || '')))[0];
      if (latest?.rag === 'Red') alerts.push({ id: `red_${s.id}`, title: `Red status — ${s.id}`, detail: `${latest.quarter}: escalated to ${latest.escalatedTo || 'CEO / competent authority'}. A management signal only — no automatic action.`, severity: 'soon', link });
    }
  }

  if (staff) {
    for (const r of recs.filter(x => x.kind === 'agreement' && x.endDate)) {
      const days = Math.floor((new Date(r.endDate).getTime() - now.getTime()) / DAY);
      if (days <= 60) alerts.push({ id: `agr_${r.id}`, title: `Agreement ${days < 0 ? 'expired' : 'expiring'} — ${r.startupId}`, detail: `${r.title}: ends ${r.endDate}.`, severity: days < 0 ? 'overdue' : 'soon', link: '/dashboard/incubation/records/agreement', date: r.endDate });
    }
    for (const r of recs.filter(x => x.kind === 'graduation' && x.finalised && ['Graduate', 'Early graduation'].includes(x.outcome))) {
      for (const [k, d] of [['6-month', r.followUp6], ['12-month', r.followUp12]] as const) {
        if (d && Math.abs(new Date(d).getTime() - now.getTime()) <= 14 * DAY) alerts.push({ id: `fu_${r.id}_${k}`, title: `Post-graduation ${k} follow-up — ${r.startupId}`, detail: `Due ${d} (where the agreement and data rules allow).`, severity: 'soon', link: '/dashboard/incubation/records/graduation', date: d });
      }
    }
    for (const s of recs.filter(x => x.kind === 'mentorSession' && x.timeliness === 'Logged late').slice(0, 5)) {
      alerts.push({ id: `ms_${s.id}`, title: 'Mentor session logged late', detail: `${s.startupId}: session ${s.sessionDate}.`, severity: 'info', link: '/dashboard/incubation/records/mentorSession' });
    }
  }
  const order = { overdue: 0, soon: 1, info: 2 } as const;
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Dated items for the Calendar page (staff see everything; startup users their own startup). */
export async function computeCalendar(actor: any, now = new Date()): Promise<CalendarItem[]> {
  const settings = await loadSettings();
  const startups = await visibleStartupsFor(actor);
  const ids = new Set(startups.map(s => s.id));
  const recs = (await readCollection<any>('incubationRecords')).filter(r => !r.startupId || ids.has(r.startupId) || isInternalStaff(actor));
  const staff = isInternalStaff(actor);
  const items: CalendarItem[] = [];
  for (const r of recs) {
    if (r.kind === 'milestone' && r.dueDate) items.push({ id: r.id, date: r.dueDate, title: `Milestone: ${r.title} (${r.startupId})`, type: 'milestone', link: '/dashboard/incubation/records/milestone' });
    if (r.kind === 'agreement' && r.endDate) items.push({ id: r.id, date: r.endDate, title: `Agreement ends: ${r.startupId}`, type: 'agreement', link: '/dashboard/incubation/records/agreement' });
    if (r.kind === 'graduation' && r.finalised && r.followUp6) items.push({ id: `${r.id}_6`, date: r.followUp6, title: `6-month follow-up: ${r.startupId}`, type: 'followup', link: '/dashboard/incubation/records/graduation' });
    if (r.kind === 'graduation' && r.finalised && r.followUp12) items.push({ id: `${r.id}_12`, date: r.followUp12, title: `12-month follow-up: ${r.startupId}`, type: 'followup', link: '/dashboard/incubation/records/graduation' });
    if (r.kind === 'cohort') { if (r.startDate) items.push({ id: `${r.id}_s`, date: r.startDate, title: `Cohort starts: ${r.name}`, type: 'cohort', link: '/dashboard/incubation/records/cohort' }); if (r.endDate) items.push({ id: `${r.id}_e`, date: r.endDate, title: `Cohort ends: ${r.name}`, type: 'cohort', link: '/dashboard/incubation/records/cohort' }); }
    if (staff && r.kind === 'programEvent' && r.date) items.push({ id: r.id, date: r.date, title: `Programme event: ${r.title}`, type: 'event', link: '/dashboard/incubation/records/programEvent' });
    if (staff && r.kind === 'meeting' && r.date) items.push({ id: r.id, date: r.date, title: `${r.body}`, type: 'meeting', link: '/dashboard/incubation/records/meeting' });
  }
  const q = lastQuarterEnd(now, settings.fiscalYearStartMonth);
  for (const s of startups.filter(x => x.status === 'Active')) {
    items.push({ id: `qr_${s.id}`, date: iso(addWorkingDays(q.end, settings.timers.quarterlyReportWorkingDays)), title: `Quarterly report due: ${s.id} (${q.label})`, type: 'review', link: '/dashboard/incubation/records/review' });
  }
  return items;
}
