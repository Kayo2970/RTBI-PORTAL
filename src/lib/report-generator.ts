/**
 * report-generator.ts — Builds real, downloadable PDF performance reports entirely client-side (jsPDF + jspdf-autotable).
 * No server round-trip and no headless browser: it runs in the visitor's browser and triggers a native file download.
 *
 * Two layouts, chosen by whether the report is about ONE person:
 *   - Personal report (a student downloading their own report, or any report scoped to a single member): profile, KPI
 *     summary, competency radar + rubric criteria, an event-wise breakdown (chart + a section per event), a task-wise
 *     breakdown (chart + a card per task with every evaluator's scores and remarks), a monthly trend and a full log.
 *     The Report Type picks how much of it is included (complete / event-wise / task-wise).
 *   - Team report (several members): summary, distribution, and the event-wise / student-wise / task-wise breakdowns.
 *
 * All charts are drawn natively into the PDF (vector), so they never depend on what happens to be on screen, never
 * pick up a dark UI background, and stay sharp when printed.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { RatingItem, EventItem, Member, TaskItem, formatEventDateRange } from './local-data';
import { RATING_CRITERIA } from './rating-criteria';
import { buildStudentFinalScores } from './final-score';
import type { SubmitterReportScore } from './report-scoring';

type RGB = [number, number, number];
const BRAND_PRIMARY: RGB = [54, 28, 106]; // #361C6A
const BRAND_ACCENT: RGB = [227, 74, 33]; // #E34A21
const TEXT_DARK: RGB = [29, 24, 37]; // #1D1825
const TEXT_MUTED: RGB = [91, 77, 112]; // #5B4D70
const BORDER_LIGHT: RGB = [217, 212, 226]; // #D9D4E2
const PANEL: RGB = [250, 246, 239]; // #FAF6EF
const GOOD: RGB = [16, 185, 129];
const OK: RGB = [59, 130, 246];
const WARN: RGB = [245, 158, 11];
const BAD: RGB = [239, 68, 68];
const PAGE_MARGIN = 40;

export type ReportType = 'overall' | 'event' | 'student' | 'task';

export interface PerformanceReportParams {
  /** One row per (member, task) — multiple evaluators already averaged together. */
  ratings: RatingItem[];
  /** Every individual evaluator row behind `ratings` (lets task cards list each evaluator separately). */
  rawRatings?: RatingItem[];
  averages: { quality: number; timeliness: number; initiative: number; collaboration: number; overall: number };
  scope: { division: string; member: string; period: string };
  generatedBy: string;
  reportType: ReportType;
  events: EventItem[];
  members: Member[];
  tasks?: TaskItem[];
  /** Report Writing Final Score per submitter (decay-weighted over scored event reports), already narrowed to the report's scope. */
  reportWriting?: SubmitterReportScore[];
  /** Set when the report is about a single person: switches to the personal layout. */
  subject?: string;
}

// ── helpers ─────────────────────────────────────────────────────────────────────

function scoreBand(score: number): string {
  if (score >= 4.5) return 'Excellent';
  if (score >= 3.5) return 'Good';
  if (score >= 2.5) return 'Satisfactory';
  if (score >= 1.5) return 'Needs Improvement';
  return 'Unsatisfactory';
}

function scoreColor(score: number): RGB {
  if (score >= 3.75) return GOOD;
  if (score >= 2.5) return OK;
  if (score >= 1.25) return WARN;
  return BAD;
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return parseFloat((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1));
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item); else map.set(k, [item]);
  }
  return map;
}

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const REVIEWER_LABEL: Record<string, string> = {
  SUPER_USER: 'Super User',
  CENTRE_HEAD: 'Centre Head',
  ADVISOR: 'Advisor',
  GG_HEAD: 'GG Campus Head',
  DESIGN_HEAD: 'Design Head',
};

/** Starts a new page if the block wouldn't fit above the footer line. */
function ensureSpace(doc: jsPDF, y: number, neededHeight: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + neededHeight > pageHeight - 50) {
    doc.addPage();
    return 46;
  }
  return y;
}

function sectionTitle(doc: jsPDF, y: number, text: string, sub?: string): number {
  const margin = PAGE_MARGIN;
  y = ensureSpace(doc, y, sub ? 52 : 38);
  doc.setFillColor(...BRAND_ACCENT);
  doc.rect(margin, y - 11, 3, sub ? 24 : 14, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...TEXT_DARK);
  doc.text(text, margin + 10, y);
  if (sub) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(doc.splitTextToSize(sub, doc.internal.pageSize.getWidth() - margin * 2 - 10), margin + 10, y + 12);
    return y + 32;
  }
  return y + 20;
}

function subTitle(doc: jsPDF, y: number, text: string): number {
  y = ensureSpace(doc, y, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(text, PAGE_MARGIN, y);
  return y + 8;
}

function lastY(doc: jsPDF): number {
  return (doc as any).lastAutoTable.finalY as number;
}

// ── native charts ───────────────────────────────────────────────────────────────

interface BarRow { label: string; value: number; note?: string }

/** Horizontal bar chart on a 0–5 scale: label | track + coloured bar | value. Long lists simply continue on the next page. */
function barChart(doc: jsPDF, y: number, rows: BarRow[], title?: string, max = 5): number {
  const margin = PAGE_MARGIN;
  const pageWidth = doc.internal.pageSize.getWidth();
  const usable = pageWidth - margin * 2;
  const labelW = Math.min(190, usable * 0.38);
  const valueW = 64;
  const trackX = margin + labelW + 6;
  const trackW = usable - labelW - valueW - 10;
  if (title) y = subTitle(doc, y, title);
  y += 2;
  const rowH = 17;
  for (const row of rows) {
    y = ensureSpace(doc, y, rowH + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_DARK);
    const lines = doc.splitTextToSize(row.label, labelW) as string[];
    const shown = lines.length > 1 ? `${lines[0].replace(/\s+\S*$/, '')}…` : lines[0];
    doc.text(shown, margin, y + 8.5);
    doc.setFillColor(...BORDER_LIGHT);
    doc.roundedRect(trackX, y + 2, trackW, 9, 2, 2, 'F');
    const frac = Math.max(0, Math.min(1, row.value / max));
    if (frac > 0) {
      doc.setFillColor(...scoreColor(row.value));
      doc.roundedRect(trackX, y + 2, Math.max(3, trackW * frac), 9, 2, 2, 'F');
    }
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_DARK);
    doc.text(`${row.value.toFixed(1)} / ${max.toFixed(1)}`, trackX + trackW + 6, y + 9);
    y += rowH;
  }
  // scale legend
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...TEXT_MUTED);
  const legend: Array<[RGB, string]> = [[GOOD, '3.75 – 5.0'], [OK, '2.5 – 3.75'], [WARN, '1.25 – 2.5'], [BAD, '0 – 1.25']];
  let lx = trackX;
  y += 2;
  for (const [c, t] of legend) {
    doc.setFillColor(...c);
    doc.rect(lx, y - 5, 6, 6, 'F');
    doc.text(t, lx + 9, y);
    lx += 62;
  }
  return y + 14;
}

/** Spider chart of up to ~8 axes on a 0–5 scale, with a rings grid and labelled values. */
function radarChart(doc: jsPDF, cx: number, cy: number, radius: number, axes: Array<{ label: string; value: number }>) {
  const n = axes.length;
  if (n < 3) return;
  const point = (i: number, frac: number): [number, number] => {
    const a = (-90 + (360 / n) * i) * (Math.PI / 180);
    return [cx + Math.cos(a) * radius * frac, cy + Math.sin(a) * radius * frac];
  };
  doc.setDrawColor(...BORDER_LIGHT);
  doc.setLineWidth(0.6);
  for (let ring = 1; ring <= 5; ring++) {
    const pts = axes.map((_, i) => point(i, ring / 5));
    doc.lines(
      pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]] as [number, number]).concat([[pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]]]),
      pts[0][0], pts[0][1], [1, 1], 'S', true
    );
  }
  axes.forEach((_, i) => {
    const [x, y] = point(i, 1);
    doc.line(cx, cy, x, y);
  });
  const data = axes.map((a, i) => point(i, Math.max(0, Math.min(5, a.value)) / 5));
  const GState = (doc as any).GState;
  if (GState) doc.setGState(new GState({ opacity: 0.35 }));
  doc.setFillColor(...BRAND_ACCENT);
  doc.lines(
    data.slice(1).map((p, i) => [p[0] - data[i][0], p[1] - data[i][1]] as [number, number]).concat([[data[0][0] - data[n - 1][0], data[0][1] - data[n - 1][1]]]),
    data[0][0], data[0][1], [1, 1], 'F', true
  );
  if (GState) doc.setGState(new GState({ opacity: 1 }));
  doc.setDrawColor(...BRAND_ACCENT);
  doc.setLineWidth(1.4);
  doc.lines(
    data.slice(1).map((p, i) => [p[0] - data[i][0], p[1] - data[i][1]] as [number, number]).concat([[data[0][0] - data[n - 1][0], data[0][1] - data[n - 1][1]]]),
    data[0][0], data[0][1], [1, 1], 'S', true
  );
  doc.setFillColor(...BRAND_ACCENT);
  data.forEach(([x, y]) => doc.circle(x, y, 2.2, 'F'));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_DARK);
  axes.forEach((a, i) => {
    const [x, y] = point(i, 1.2);
    const align = Math.abs(x - cx) < 4 ? 'center' : x > cx ? 'left' : 'right';
    doc.text(`${a.label} ${a.value.toFixed(1)}`, x, y + 3, { align });
  });
  doc.setLineWidth(0.5);
}

/** Line chart of a score over time (0–5 scale). */
function lineChart(doc: jsPDF, y: number, points: Array<{ label: string; value: number }>, title: string): number {
  const margin = PAGE_MARGIN;
  const usable = doc.internal.pageSize.getWidth() - margin * 2;
  const h = 120;
  y = ensureSpace(doc, y, h + 50);
  y = subTitle(doc, y, title);
  const left = margin + 24;
  const w = usable - 34;
  const top = y + 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...TEXT_MUTED);
  doc.setDrawColor(...BORDER_LIGHT);
  doc.setLineWidth(0.5);
  for (let v = 0; v <= 5; v++) {
    const gy = top + h - (v / 5) * h;
    doc.line(left, gy, left + w, gy);
    doc.text(String(v), left - 8, gy + 2, { align: 'right' });
  }
  const xs = points.map((_, i) => (points.length === 1 ? left + w / 2 : left + (w / (points.length - 1)) * i));
  const ys = points.map((p) => top + h - (Math.max(0, Math.min(5, p.value)) / 5) * h);
  doc.setDrawColor(...BRAND_ACCENT);
  doc.setLineWidth(1.6);
  for (let i = 1; i < points.length; i++) doc.line(xs[i - 1], ys[i - 1], xs[i], ys[i]);
  points.forEach((p, i) => {
    doc.setFillColor(...scoreColor(p.value));
    doc.circle(xs[i], ys[i], 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_DARK);
    doc.text(p.value.toFixed(1), xs[i], ys[i] - 6, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_MUTED);
    doc.text(p.label, xs[i], top + h + 11, { align: 'center' });
  });
  doc.setLineWidth(0.5);
  return top + h + 26;
}

function kpiRow(doc: jsPDF, y: number, items: Array<{ label: string; value: string; sub?: string; color?: RGB }>): number {
  const margin = PAGE_MARGIN;
  const usable = doc.internal.pageSize.getWidth() - margin * 2;
  const gap = 8;
  const w = (usable - gap * (items.length - 1)) / items.length;
  y = ensureSpace(doc, y, 62);
  items.forEach((it, i) => {
    const x = margin + i * (w + gap);
    doc.setFillColor(...PANEL);
    doc.setDrawColor(...BORDER_LIGHT);
    doc.roundedRect(x, y, w, 52, 4, 4, 'FD');
    doc.setFillColor(...(it.color || BRAND_ACCENT));
    doc.rect(x, y + 6, 3, 40, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(it.label, x + 10, y + 15);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...TEXT_DARK);
    doc.text(it.value, x + 10, y + 34);
    if (it.sub) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...TEXT_MUTED);
      doc.text(it.sub, x + 10, y + 45);
    }
  });
  return y + 66;
}

function bullets(doc: jsPDF, y: number, lines: string[]): number {
  const usable = doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2 - 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_DARK);
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(line, usable) as string[];
    y = ensureSpace(doc, y, wrapped.length * 11 + 4);
    doc.setFillColor(...BRAND_ACCENT);
    doc.circle(PAGE_MARGIN + 3, y - 2.5, 1.6, 'F');
    doc.text(wrapped, PAGE_MARGIN + 12, y);
    y += wrapped.length * 11 + 3;
  }
  return y + 4;
}

// ── shared pieces ───────────────────────────────────────────────────────────────

function letterhead(doc: jsPDF, title: string, subtitle: string): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...BRAND_PRIMARY);
  doc.rect(0, 0, pageWidth, 96, 'F');
  doc.setFillColor(...BRAND_ACCENT);
  doc.rect(0, 96, pageWidth, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('RTBI Portal', PAGE_MARGIN, 36);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(title, PAGE_MARGIN, 56);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 215, 230);
  doc.text(subtitle, PAGE_MARGIN, 72);
  doc.text('MSRUAS Portal — Confidential, Internal Use Only', PAGE_MARGIN, 85);
  return 120;
}

function metaBlock(doc: jsPDF, y: number, lines: string[]): number {
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_MUTED);
  doc.setFontSize(9);
  lines.forEach((line, i) => doc.text(line, PAGE_MARGIN, y + i * 13));
  return y + lines.length * 13 + 16;
}

function footers(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...BORDER_LIGHT);
    doc.line(PAGE_MARGIN, pageHeight - 34, pageWidth - PAGE_MARGIN, pageHeight - 34);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUTED);
    doc.text('RTBI Portal — Confidential', PAGE_MARGIN, pageHeight - 20);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - PAGE_MARGIN, pageHeight - 20, { align: 'right' });
  }
}

const COMP_ROWS = (a: PerformanceReportParams['averages']): BarRow[] => [
  { label: 'Quality', value: a.quality },
  { label: 'Timeliness', value: a.timeliness },
  { label: 'Initiative', value: a.initiative },
  { label: 'Collaboration', value: a.collaboration },
];

function distributionTable(doc: jsPDF, y: number, ratings: RatingItem[]): number {
  const bands = ['Excellent', 'Good', 'Satisfactory', 'Needs Improvement', 'Unsatisfactory'];
  const rows = bands.map((band) => ({ band, count: ratings.filter((r) => scoreBand(r.overallScore) === band).length }));
  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [['Performance Band', 'Evaluations', 'Share']],
    body: rows.map((d) => [d.band, String(d.count), ratings.length ? `${((d.count / ratings.length) * 100).toFixed(0)}%` : '0%']),
    theme: 'grid',
    headStyles: { fillColor: BRAND_PRIMARY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9, textColor: TEXT_DARK },
    alternateRowStyles: { fillColor: PANEL },
  });
  return lastY(doc) + 20;
}

const SCORE_HEAD = ['Quality', 'Timeliness', 'Initiative', 'Collab.', 'Overall'];
const scoreCells = (r: RatingItem) => [r.quality.toFixed(1), r.timeliness.toFixed(1), r.initiative.toFixed(1), r.collaboration.toFixed(1), r.overallScore.toFixed(1)];

/** "Report Writing — Final Score" table (scored event reports). Skipped when nothing in scope has been scored. */
function reportWritingSection(doc: jsPDF, y: number, rows: SubmitterReportScore[] | undefined, sectionLabel: string): number {
  if (!rows || rows.length === 0) return y;
  y = sectionTitle(doc, y, sectionLabel, 'Average of scored event reports on the Report Writing rubric (100% of the score).');
  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [['#', 'Submitter', 'Reports scored', 'Last report', 'Final score']],
    body: rows.map((r, i) => [String(i + 1), r.submittedBy, String(r.reportCount), (r.lastSubmittedAt || '').slice(0, 10), `${r.finalScore.toFixed(2)} / 5`]),
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 4, textColor: TEXT_DARK, lineColor: BORDER_LIGHT },
    headStyles: { fillColor: BRAND_PRIMARY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: PANEL },
  });
  return lastY(doc) + 20;
}

function fullLogAppendix(doc: jsPDF, ratings: RatingItem[], showStudent: boolean) {
  doc.addPage();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...TEXT_DARK);
  doc.text('Appendix: Full Audited Performance Log', PAGE_MARGIN, 40);
  const head = [...(showStudent ? ['Student'] : []), 'Task', 'Event', 'Evaluator', 'Qual.', 'Time.', 'Init.', 'Collab.', 'Overall', 'Date', 'Remarks'];
  autoTable(doc, {
    startY: 52,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [head],
    body: ratings.map((r) => [
      ...(showStudent ? [r.targetName] : []),
      r.taskTitle,
      r.eventName || '—',
      r.raterName,
      r.quality.toFixed(1),
      r.timeliness.toFixed(1),
      r.initiative.toFixed(1),
      r.collaboration.toFixed(1),
      r.overallScore.toFixed(1),
      (r.createdAt || '').split('T')[0],
      [r.lateNote, r.notes].filter(Boolean).join(' | ') || '—',
    ]),
    theme: 'striped',
    styles: { fontSize: 7.5, cellPadding: 4, textColor: TEXT_DARK, lineColor: BORDER_LIGHT },
    headStyles: { fillColor: BRAND_PRIMARY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: PANEL },
  });
}

function eventHeader(doc: jsPDF, y: number, name: string, matched: EventItem | undefined, stats: string, standalone = false): number {
  const usable = doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2;
  y = ensureSpace(doc, y, 70);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...BRAND_ACCENT);
  doc.text(name, PAGE_MARGIN, y);
  y += 13;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_MUTED);
  if (matched) {
    const detail = [formatEventDateRange(matched), matched.location, matched.campus].filter(Boolean).join(' · ');
    if (detail) {
      doc.text(detail, PAGE_MARGIN, y);
      y += 11;
    }
    if (matched.description) {
      const desc = (doc.splitTextToSize(matched.description, usable) as string[]).slice(0, 4);
      doc.text(desc, PAGE_MARGIN, y);
      y += desc.length * 10 + 3;
    }
  } else if (!standalone) {
    doc.text('(Not linked to a record in the Events module)', PAGE_MARGIN, y);
    y += 11;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_DARK);
  doc.text(stats, PAGE_MARGIN, y);
  return y + 6;
}

// ── personal report ─────────────────────────────────────────────────────────────

function buildPersonal(doc: jsPDF, p: PerformanceReportParams) {
  const { ratings, scope, generatedBy, reportType, events, members, averages } = p;
  const tasks = p.tasks || [];
  const raw = p.rawRatings && p.rawRatings.length ? p.rawRatings : ratings;
  const name = p.subject || ratings[0]?.targetName || 'Member';
  const member = members.find((m) => m.id === ratings[0]?.targetId || m.name === name);
  const pageWidth = doc.internal.pageSize.getWidth();
  const usable = pageWidth - PAGE_MARGIN * 2;
  const kind = reportType === 'event' ? 'Event-wise Performance Report' : reportType === 'task' ? 'Task-wise Performance Report' : 'Personal Performance Report';
  let y = letterhead(doc, kind, `${name}${member ? ` — ${[member.division, member.role].filter(Boolean).join(' · ')}` : ''}`);

  const profile = [
    `Member: ${name}${member?.email ? `  <${member.email}>` : ''}`,
    ...(member ? [`Division: ${member.division}${member.department ? `  ·  Department: ${member.department}` : ''}${member.program ? `  ·  Programme: ${member.program}` : ''}${member.batch ? `  ·  ${member.batch}` : ''}`] : []),
    `Period: ${scope.period}`,
    `Generated: ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}  ·  Generated by: ${generatedBy}`,
  ];
  y = metaBlock(doc, y, profile);

  // ---- 1. Summary ----
  const eventGroups = groupBy(ratings, (r) => r.eventId || r.eventName || '__standalone__');
  const realEvents = Array.from(eventGroups.keys()).filter((k) => k !== '__standalone__');
  const final = buildStudentFinalScores(ratings)[0];
  y = sectionTitle(doc, y, '1. Performance Summary', 'How your work was evaluated across the selected period.');
  y = kpiRow(doc, y, [
    { label: 'Overall average', value: `${averages.overall.toFixed(1)} / 5`, sub: scoreBand(averages.overall), color: scoreColor(averages.overall) },
    { label: 'Final score', value: final ? `${final.finalScore.toFixed(2)} / 5` : '—', sub: 'average of all ratings', color: final ? scoreColor(final.finalScore) : BRAND_ACCENT },
    { label: 'Tasks evaluated', value: String(ratings.length), sub: `${raw.length} evaluator score${raw.length === 1 ? '' : 's'}` },
    { label: 'Events', value: String(realEvents.length), sub: 'taken part in' },
  ]);

  // competency radar + table side by side
  const radarTop = ensureSpace(doc, y, 190);
  const cx = PAGE_MARGIN + usable * 0.27;
  radarChart(doc, cx, radarTop + 82, 62, [
    { label: 'Quality', value: averages.quality },
    { label: 'Timeliness', value: averages.timeliness },
    { label: 'Initiative', value: averages.initiative },
    { label: 'Collaboration', value: averages.collaboration },
  ]);
  autoTable(doc, {
    startY: radarTop + 8,
    margin: { left: PAGE_MARGIN + usable * 0.55, right: PAGE_MARGIN },
    head: [['Competency', 'Average', 'Band']],
    body: COMP_ROWS(averages).map((r) => [r.label, `${r.value.toFixed(1)} / 5`, scoreBand(r.value)]).concat([['Overall', `${averages.overall.toFixed(1)} / 5`, scoreBand(averages.overall)]]),
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 4, textColor: TEXT_DARK },
    headStyles: { fillColor: BRAND_ACCENT, textColor: [255, 255, 255], fontSize: 8.5 },
    didParseCell: (d) => {
      if (d.section === 'body' && d.row.index === 4) d.cell.styles.fontStyle = 'bold';
    },
  });
  y = Math.max(radarTop + 178, lastY(doc) + 16);

  // rubric criteria averages (the 5-criterion rubrics each task was actually scored against)
  const criteria = new Map<string, number[]>();
  raw.forEach((r) => {
    if (!r.criteriaSet || !r.scores) return;
    for (const c of RATING_CRITERIA[r.criteriaSet]) {
      const v = r.scores[c.key];
      if (typeof v === 'number') {
        const k = `${c.label}`;
        criteria.set(k, [...(criteria.get(k) || []), v]);
      }
    }
  });
  if (criteria.size) {
    y = barChart(doc, y, Array.from(criteria.entries()).map(([label, vals]) => ({ label: `${label} (${vals.length})`, value: average(vals) })).sort((a, b) => b.value - a.value), 'Rubric criteria — average score per criterion (number of evaluations in brackets)');
  }

  // highlights
  const comps = COMP_ROWS(averages).filter(() => ratings.length > 0).sort((a, b) => b.value - a.value);
  const eventAvgs = Array.from(eventGroups.entries()).map(([k, rs]) => ({ name: rs[0].eventName || 'Standalone tasks', value: average(rs.map((r) => r.overallScore)), n: rs.length, k }));
  const sortedEvents = [...eventAvgs].sort((a, b) => b.value - a.value);
  const sortedTasks = [...ratings].sort((a, b) => b.overallScore - a.overallScore);
  const lines: string[] = [];
  if (comps.length) lines.push(`Strongest competency: ${comps[0].label} (${comps[0].value.toFixed(1)} / 5). Area to develop: ${comps[comps.length - 1].label} (${comps[comps.length - 1].value.toFixed(1)} / 5).`);
  if (sortedEvents.length > 1) lines.push(`Best event: ${sortedEvents[0].name} (${sortedEvents[0].value.toFixed(1)}). Lowest event: ${sortedEvents[sortedEvents.length - 1].name} (${sortedEvents[sortedEvents.length - 1].value.toFixed(1)}).`);
  if (sortedTasks.length) lines.push(`Highest-scoring task: "${sortedTasks[0].taskTitle}" (${sortedTasks[0].overallScore.toFixed(1)}). ${sortedTasks.length > 1 ? `Lowest: "${sortedTasks[sortedTasks.length - 1].taskTitle}" (${sortedTasks[sortedTasks.length - 1].overallScore.toFixed(1)}).` : ''}`);
  const late = ratings.filter((r) => r.lateNote).length;
  if (late) lines.push(`${late} task${late === 1 ? ' was' : 's were'} completed late — see the task-wise section for details.`);
  if (lines.length) {
    y = subTitle(doc, y, 'Highlights');
    y = bullets(doc, y + 6, lines);
  }

  // monthly trend
  const byMonth = groupBy(ratings, (r) => (r.createdAt || '').slice(0, 7));
  const months = Array.from(byMonth.keys()).filter(Boolean).sort();
  if (months.length >= 2) {
    y = lineChart(doc, y + 4, months.map((m) => ({ label: new Date(`${m}-01`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), value: average(byMonth.get(m)!.map((r) => r.overallScore)) })), 'Month-by-month overall average');
  }
  y = distributionTable(doc, y + 4, ratings);

  // ---- 2. Event-wise ----
  if (reportType === 'overall' || reportType === 'event' || reportType === 'student') {
    y = sectionTitle(doc, y, `2. Event-wise Breakdown (${eventAvgs.length} ${eventAvgs.length === 1 ? 'event' : 'events'})`, 'Your average score in each event, then the tasks you were evaluated on in it.');
    y = barChart(doc, y, eventAvgs.map((e) => ({ label: `${e.name} (${e.n} task${e.n === 1 ? '' : 's'})`, value: e.value })).sort((a, b) => b.value - a.value), 'Average score per event');
    const orderedKeys = Array.from(eventGroups.keys()).sort((a, b) => (eventGroups.get(a)![0].eventName || 'zzz').localeCompare(eventGroups.get(b)![0].eventName || 'zzz'));
    for (const key of orderedKeys) {
      const rs = eventGroups.get(key)!;
      const matched = events.find((e) => e.id === key) || events.find((e) => e.title === rs[0].eventName);
      const eventName = matched?.title || rs[0].eventName || 'Standalone tasks (not tied to an event)';
      y = eventHeader(doc, y + 4, eventName, matched, `Tasks evaluated: ${rs.length}  ·  Your average in this event: ${average(rs.map((r) => r.overallScore)).toFixed(1)} / 5.0 (${scoreBand(average(rs.map((r) => r.overallScore)))})`, key === '__standalone__');
      autoTable(doc, {
        startY: y,
        margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
        head: [['Task', 'Evaluator(s)', ...SCORE_HEAD, 'Date']],
        body: rs.map((r) => [r.taskTitle, r.raterName, ...scoreCells(r), fmtDate(r.createdAt)]),
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 3.5, textColor: TEXT_DARK, lineColor: BORDER_LIGHT },
        headStyles: { fillColor: BRAND_ACCENT, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: PANEL },
        columnStyles: { 0: { cellWidth: 120 } },
      });
      y = lastY(doc) + 6;
      const remarks = rs.filter((r) => r.notes || r.lateNote);
      if (remarks.length) {
        y = bullets(doc, y + 6, remarks.map((r) => `${r.taskTitle}: ${[r.lateNote, r.notes].filter(Boolean).join(' — ')}`));
      }
      y += 8;
    }
  }

  // ---- 3. Task-wise ----
  if (reportType === 'overall' || reportType === 'task') {
    const sectionNo = reportType === 'task' ? '2' : '3';
    y = sectionTitle(doc, y, `${sectionNo}. Task-wise Breakdown (${ratings.length} ${ratings.length === 1 ? 'task' : 'tasks'})`, 'Every evaluated task, with each evaluator\'s scores and remarks.');
    const byDate = [...ratings].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    y = barChart(doc, y, byDate.map((r) => ({ label: `${r.taskTitle}${r.eventName ? ` — ${r.eventName}` : ''}`, value: r.overallScore })), 'Score per task (oldest first)');
    for (const r of byDate) {
      const task = tasks.find((t) => t.id === r.taskId);
      const evals = raw.filter((x) => x.taskId === r.taskId && x.targetName === r.targetName);
      y = ensureSpace(doc, y, 90);
      doc.setFillColor(...PANEL);
      doc.setDrawColor(...BORDER_LIGHT);
      doc.roundedRect(PAGE_MARGIN, y - 10, usable, 30, 3, 3, 'FD');
      doc.setFillColor(...scoreColor(r.overallScore));
      doc.rect(PAGE_MARGIN, y - 10, 4, 30, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...TEXT_DARK);
      doc.text((doc.splitTextToSize(r.taskTitle, usable - 90) as string[])[0], PAGE_MARGIN + 12, y + 3);
      doc.text(`${r.overallScore.toFixed(1)} / 5.0`, PAGE_MARGIN + usable - 8, y + 3, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...TEXT_MUTED);
      const meta = [r.eventName ? `Event: ${r.eventName}` : 'Standalone task', task ? `Due ${fmtDate(task.dueDate)}` : '', task?.status ? `Status: ${task.status}` : '', `Evaluated ${fmtDate(r.createdAt)}`, scoreBand(r.overallScore)].filter(Boolean).join('  ·  ');
      doc.text(meta, PAGE_MARGIN + 12, y + 15);
      y += 26;
      autoTable(doc, {
        startY: y,
        margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
        head: [['Evaluator', 'Role', ...SCORE_HEAD]],
        body: evals.map((e) => [e.raterName, e.reviewerRole ? REVIEWER_LABEL[e.reviewerRole] || e.reviewerRole : '—', ...scoreCells(e)]),
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 3, textColor: TEXT_DARK, lineColor: BORDER_LIGHT },
        headStyles: { fillColor: BRAND_PRIMARY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      });
      y = lastY(doc) + 4;
      // rubric criteria this task was scored against, per evaluator
      const rubric = evals.filter((e) => e.criteriaSet && e.scores);
      if (rubric.length) {
        const set = rubric[0].criteriaSet!;
        autoTable(doc, {
          startY: y + 2,
          margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
          head: [['Rubric criterion', ...rubric.map((e) => e.raterName)]],
          body: RATING_CRITERIA[set].map((c) => [c.label, ...rubric.map((e) => (typeof e.scores![c.key] === 'number' ? `${e.scores![c.key]}` : '—'))]),
          theme: 'plain',
          styles: { fontSize: 7.5, cellPadding: 2.5, textColor: TEXT_DARK },
          headStyles: { fontStyle: 'bold', textColor: TEXT_MUTED, fontSize: 7.5 },
        });
        y = lastY(doc) + 4;
      }
      const notes = evals.filter((e) => e.notes).map((e) => `${e.raterName}: ${e.notes}`);
      if (r.lateNote) notes.unshift(r.lateNote);
      if (notes.length) y = bullets(doc, y + 6, notes);
      y += 10;
    }
  }

  y = reportWritingSection(doc, y, p.reportWriting, 'Report Writing — Final Score');

  fullLogAppendix(doc, ratings, false);
}

// ── team report ─────────────────────────────────────────────────────────────────

const TEAM_TITLE: Record<ReportType, string> = {
  overall: 'Overall Performance Report (Event-wise, Student-wise and Task-wise)',
  event: 'Event-wise Performance Report',
  student: 'Student-wise Performance Report',
  task: 'Task-wise Performance Report',
};

function buildTeam(doc: jsPDF, p: PerformanceReportParams) {
  const { ratings, averages, scope, generatedBy, reportType, events, members } = p;
  let y = letterhead(doc, TEAM_TITLE[reportType], 'Task Performance Evaluation');
  y = metaBlock(doc, y, [
    `Generated: ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
    `Generated by: ${generatedBy}`,
    `Scope: Division = ${scope.division} · Member = ${scope.member} · Period = ${scope.period}`,
    `Total Evaluations in Scope: ${ratings.length}`,
  ]);

  y = sectionTitle(doc, y, 'Executive Summary');
  y = kpiRow(doc, y, [
    { label: 'Overall average', value: `${averages.overall.toFixed(1)} / 5`, sub: scoreBand(averages.overall), color: scoreColor(averages.overall) },
    { label: 'Evaluations', value: String(ratings.length) },
    { label: 'Members', value: String(new Set(ratings.map((r) => r.targetName)).size) },
    { label: 'Events', value: String(new Set(ratings.map((r) => r.eventId || r.eventName).filter(Boolean)).size) },
  ]);
  const radarTop = ensureSpace(doc, y, 190);
  radarChart(doc, PAGE_MARGIN + 130, radarTop + 82, 62, [
    { label: 'Quality', value: averages.quality },
    { label: 'Timeliness', value: averages.timeliness },
    { label: 'Initiative', value: averages.initiative },
    { label: 'Collaboration', value: averages.collaboration },
  ]);
  autoTable(doc, {
    startY: radarTop + 8,
    margin: { left: PAGE_MARGIN + 290, right: PAGE_MARGIN },
    head: [['Metric', 'Average', 'Band']],
    body: COMP_ROWS(averages).map((r) => [r.label, `${r.value.toFixed(1)} / 5`, scoreBand(r.value)]).concat([['Overall', `${averages.overall.toFixed(1)} / 5`, scoreBand(averages.overall)]]),
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 4, textColor: TEXT_DARK },
    headStyles: { fillColor: BRAND_ACCENT, textColor: [255, 255, 255], fontSize: 8.5 },
    didParseCell: (d) => {
      if (d.section === 'body' && d.row.index === 4) d.cell.styles.fontStyle = 'bold';
    },
  });
  y = Math.max(radarTop + 178, lastY(doc) + 16);
  y = distributionTable(doc, y, ratings);

  // ---- Event-wise ----
  if (reportType === 'event' || reportType === 'overall') {
    const groups = groupBy(ratings, (r) => r.eventId || r.eventName || '__standalone__');
    const keys = Array.from(groups.keys()).sort((a, b) => (groups.get(a)![0].eventName || 'Standalone').localeCompare(groups.get(b)![0].eventName || 'Standalone'));
    y = sectionTitle(doc, y, `Event-wise Breakdown (${keys.length} event${keys.length === 1 ? '' : 's'})`, 'Average score of everyone evaluated in each event, then who contributed what.');
    y = barChart(doc, y, keys.map((k) => ({ label: groups.get(k)![0].eventName || 'Standalone / No Event', value: average(groups.get(k)!.map((r) => r.overallScore)) })).sort((a, b) => b.value - a.value), 'Average score per event');
    for (const key of keys) {
      const rs = groups.get(key)!;
      const matched = events.find((e) => e.id === key) || events.find((e) => e.title === rs[0].eventName);
      const eventName = matched?.title || rs[0].eventName || 'Standalone / No Event';
      y = eventHeader(doc, y + 4, eventName, matched, `Contributors: ${new Set(rs.map((r) => r.targetName)).size}  ·  Event Average: ${average(rs.map((r) => r.overallScore))} / 5.0`, key === '__standalone__');
      autoTable(doc, {
        startY: y,
        margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
        head: [['Contributor', 'Task', 'Evaluator', ...SCORE_HEAD]],
        body: rs.map((r) => [r.targetName, r.taskTitle, r.raterName, ...scoreCells(r)]),
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 3.5, textColor: TEXT_DARK, lineColor: BORDER_LIGHT },
        headStyles: { fillColor: BRAND_ACCENT, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: PANEL },
      });
      y = lastY(doc) + 20;
    }
  }

  // ---- Student-wise ----
  if (reportType === 'student' || reportType === 'overall') {
    const groups = groupBy(ratings, (r) => r.targetId || r.targetName);
    const keys = Array.from(groups.keys()).sort((a, b) => groups.get(a)![0].targetName.localeCompare(groups.get(b)![0].targetName));
    y = sectionTitle(doc, y, `Student-wise Breakdown (${keys.length} member${keys.length === 1 ? '' : 's'})`, 'Average score per student, then every student\'s tasks and events.');
    y = barChart(doc, y, keys.map((k) => ({ label: groups.get(k)![0].targetName, value: average(groups.get(k)!.map((r) => r.overallScore)) })).sort((a, b) => b.value - a.value), 'Average score per student');
    for (const key of keys) {
      const rs = groups.get(key)!;
      const targetName = rs[0].targetName;
      const member = members.find((m) => m.id === key || m.name === targetName);
      y = ensureSpace(doc, y + 4, 62);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...BRAND_ACCENT);
      doc.text(targetName, PAGE_MARGIN, y);
      y += 13;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...TEXT_MUTED);
      doc.text(member ? [member.division, member.role].filter(Boolean).join(' · ') : 'Not currently on the roster', PAGE_MARGIN, y);
      y += 11;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...TEXT_DARK);
      doc.text(`Evaluations: ${rs.length}  ·  Personal Average: ${average(rs.map((r) => r.overallScore))} / 5.0`, PAGE_MARGIN, y);
      y += 6;
      autoTable(doc, {
        startY: y,
        margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
        head: [['Event', 'Task', 'Evaluator', ...SCORE_HEAD]],
        body: rs.map((r) => [r.eventName || 'Standalone', r.taskTitle, r.raterName, ...scoreCells(r)]),
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 3.5, textColor: TEXT_DARK, lineColor: BORDER_LIGHT },
        headStyles: { fillColor: BRAND_PRIMARY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: PANEL },
      });
      y = lastY(doc) + 20;
    }
  }

  // ---- Task-wise ----
  if (reportType === 'task' || reportType === 'overall') {
    const groups = groupBy(ratings, (r) => r.taskId || r.taskTitle);
    const keys = Array.from(groups.keys()).sort((a, b) => groups.get(a)![0].taskTitle.localeCompare(groups.get(b)![0].taskTitle));
    y = sectionTitle(doc, y, `Task-wise Breakdown (${keys.length} task${keys.length === 1 ? '' : 's'})`, 'Average score per evaluated task, then who worked on it and how each person scored.');
    y = barChart(doc, y, keys.map((k) => ({ label: groups.get(k)![0].taskTitle, value: average(groups.get(k)!.map((r) => r.overallScore)) })).sort((a, b) => b.value - a.value), 'Average score per task');
    for (const key of keys) {
      const rs = groups.get(key)!;
      y = ensureSpace(doc, y + 4, 62);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...BRAND_ACCENT);
      doc.text(rs[0].taskTitle, PAGE_MARGIN, y);
      y += 12;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...TEXT_MUTED);
      doc.text(`${rs[0].eventName ? `Event: ${rs[0].eventName}  ·  ` : ''}${rs.length} evaluated  ·  Task average: ${average(rs.map((r) => r.overallScore))} / 5.0`, PAGE_MARGIN, y);
      y += 6;
      autoTable(doc, {
        startY: y,
        margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
        head: [['Student', 'Evaluator', ...SCORE_HEAD, 'Remarks']],
        body: rs.map((r) => [r.targetName, r.raterName, ...scoreCells(r), [r.lateNote, r.notes].filter(Boolean).join(' | ') || '—']),
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 3.5, textColor: TEXT_DARK, lineColor: BORDER_LIGHT },
        headStyles: { fillColor: BRAND_PRIMARY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: PANEL },
        columnStyles: { 7: { cellWidth: 90 } },
      });
      y = lastY(doc) + 20;
    }
  }

  y = reportWritingSection(doc, y, p.reportWriting, 'Report Writing — Final Score');

  fullLogAppendix(doc, ratings, true);
}

// ── entry point ─────────────────────────────────────────────────────────────────

export function generatePerformanceReportPdf(params: PerformanceReportParams): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  if (params.subject) buildPersonal(doc, params);
  else buildTeam(doc, params);
  footers(doc);
  const stamp = new Date().toISOString().split('T')[0];
  const who = params.subject ? `_${params.subject.replace(/[^\w]+/g, '_')}` : '';
  doc.save(`rtbi_performance_report_${params.reportType}${who}_${stamp}.pdf`);
}
