import { KINDS } from './kinds';
import type { PdfSection } from './pdf';
import type { Startup } from './types';

/** Pure builders for downloadable reports (PDF sections). Wording/letterhead is a template until RTBI supplies the final format. */

const show = (v: any): string => (v === undefined || v === null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'object' ? String(v.name ?? '—') : String(v));

/** Renders a record as "Label: value" lines using the register's own field labels (skips empty values). */
export function recordLines(kind: string, rec: any, skip: string[] = ['startupId']): string[] {
  const def = KINDS[kind];
  const fields = typeof def.fields === 'function' ? [] : def.fields;
  return fields.filter(f => !skip.includes(f.key) && rec[f.key] !== undefined && rec[f.key] !== '' && rec[f.key] !== false).map(f => `${f.label.replace(/ \(.*/, '')}: ${show(rec[f.key])}`);
}

const block = (kind: string, rows: any[], title: (r: any) => string, empty: string): string[] =>
  rows.length ? rows.flatMap(r => [title(r), ...recordLines(kind, r).map(l => `   ${l}`), ' ']) : [empty];

export function startupReportSections(s: Startup, rec: Record<string, any[]>): PdfSection[] {
  const by = (k: string) => (rec[k] || []).filter(r => r.startupId === s.id);
  const latest = (k: string) => by(k).slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const trl = latest('trl');
  return [
    { heading: '1. Startup profile', lines: [`ID: ${s.id}`, `Name: ${s.name}`, `Sector: ${show(s.sector)}`, `Stage: ${show(s.stage)}`, `Technology: ${show(s.technology)}`, `Legal status: ${show(s.legalStatus)}`, `Status: ${s.status}`, `Pathway: ${s.pathway}`, `Cohort: ${show(s.cohort)}`, `Incubation start: ${show(s.incubationStartDate)}`, `Problem: ${show(s.problem)}`, `Solution: ${show(s.solution)}`] },
    { heading: '2. Technology readiness (TRL) assessments', lines: trl.length ? trl.flatMap(r => [`${r.assessmentId || r.id}: assessed TRL ${show(r.assessedTrl)} (claimed ${show(r.claimedTrl)}, confidence ${show(r.confidence)})`, `   Rationale: ${show(r.rationale)}`]) : ['No TRL assessment recorded.'] },
    { heading: '3. Quarterly reviews and RAG', lines: block('review', latest('review'), r => `${show(r.quarter)} — RAG ${show(r.rag)} (${show(r.timeliness)})`, 'No quarterly review recorded.') },
    { heading: '4. Progress submissions (outreach, milestones, awards, grants, funding, competitions)', lines: block('progress', latest('progress'), r => `${show(r.period)}${r.verified ? ' — verified' : ' — unverified'}`, 'No progress submission recorded.') },
    { heading: '5. Cohort milestones', lines: block('milestone', by('milestone'), r => `${show(r.title)} — ${show(r.status)} (due ${show(r.dueDate)})`, 'No milestones recorded.') },
    { heading: '6. Mentoring sessions', lines: by('mentorSession').length ? by('mentorSession').map(r => `${show(r.sessionDate)} — feedback ${show(r.feedbackScore)}: ${show(r.summary)}`) : ['No mentoring sessions recorded.'] },
    { heading: '7. Agreements', lines: by('agreement').length ? by('agreement').map(r => `${show(r.title)} — ${show(r.state)} (${show(r.startDate)} to ${show(r.endDate)})`) : ['No agreements recorded.'] },
    { heading: '8. Evidence index (IDs only)', lines: by('evidence').length ? by('evidence').map(r => `${r.id}: ${show(r.title)}`) : ['No evidence recorded.'] },
  ];
}

export function programmeReportSections(rec: Record<string, any[]>, from: string, to: string): PdfSection[] {
  const inRange = (d?: string) => !!d && (!from || d >= from) && (!to || d <= to);
  const events = (rec.programEvent || []).filter(r => inRange(r.date));
  const milestones = (rec.milestone || []).filter(r => inRange(r.dueDate));
  const sessions = (rec.mentorSession || []).filter(r => inRange(r.sessionDate));
  const attendance = events.reduce((n, r) => n + (Number(r.attendance) || 0), 0);
  return [
    { heading: 'Summary', lines: [`Period: ${from || 'start'} to ${to || 'today'}`, `Programme events: ${events.length} (total attendance ${attendance})`, `Cohort milestones due: ${milestones.length} (${milestones.filter(m => m.status === 'Done').length} done)`, `Mentoring sessions: ${sessions.length}`] },
    { heading: 'Programme events', lines: block('programEvent', events, r => `${show(r.title)} — ${show(r.date)} [${show(r.status)}]`, 'No events in this period.') },
    { heading: 'Cohort milestones', lines: milestones.length ? milestones.map(r => `${show(r.startupId)} · ${show(r.title)} — ${show(r.status)} (due ${show(r.dueDate)})`) : ['None in this period.'] },
    { heading: 'Mentoring', lines: sessions.length ? sessions.map(r => `${show(r.sessionDate)} · ${show(r.startupId)} — feedback ${show(r.feedbackScore)}`) : ['None in this period.'] },
  ];
}

/** Minutes of Meeting in a standard layout. */
export function momSections(m: any): PdfSection[] {
  return [
    { lines: [`Body: ${show(m.body)}`, `Date: ${show(m.date)}   Time: ${show(m.time)}`, `Venue / mode: ${show(m.venue)}`] },
    { heading: 'Attendance', lines: [`Present: ${show(m.attendees)}`, `Absent / leave of absence: ${show(m.absentees)}`, `Members present: ${show(m.attendanceCount)}`, `KITS nominee present: ${show(!!m.kitsNomineePresent)}   Quorum met: ${show(!!m.quorumMet)}`] },
    { heading: 'Agenda', lines: [show(m.momAgenda)] },
    { heading: 'Discussion', lines: [show(m.momDiscussion)] },
    { heading: 'Decisions / resolutions', lines: [show(m.momDecisions)] },
    { heading: 'Action items (item — owner — due date)', lines: [show(m.momActions)] },
    { heading: 'Risks reviewed / KPI shortfall actions', lines: [show(m.risksReviewed)] },
    { lines: [`Next meeting: ${show(m.nextMeeting)}`, `Minutes reference: ${show(m.minutesRef)}`, `Status: ${m.minutesFinalised ? 'Finalised' : 'Draft — not finalised'}`] },
  ];
}
