import JSZip from 'jszip';
import type { FeedbackAnalysis, ParamStats, SegmentStats } from '@/lib/feedback-analysis';
import { RATING_PARAMS, DIMENSIONS } from '@/lib/feedback-analysis';
import type { ChartImage, ReportCharts } from '@/lib/feedback-report-charts';

/**
 * Builds the Feedback Analysis Report as a real .docx (written straight to WordprocessingML with JSZip, so no extra
 * dependency). The report follows section 7 of the Feedback Form Analysis Guide: profile → headline results →
 * parameter results → segments → outcomes & impact → open comments → conclusions → recommendations → annexure.
 * Every observation is generated from the figures in `FeedbackAnalysis`; nothing here is invented.
 */

export interface ReportMeta {
  formTitle: string;
  eventName?: string;
  preparedBy?: string;
}

// ───────────────────────── block model ─────────────────────────

type Run = { t: string; b?: boolean; i?: boolean; color?: string };
type EmbeddedImage = ChartImage & { rid: number };
type Block =
  | { k: 'title'; text: string }
  | { k: 'subtitle'; text: string }
  | { k: 'h1'; text: string }
  | { k: 'h2'; text: string }
  | { k: 'p'; runs: Run[] }
  | { k: 'bullet'; runs: Run[] }
  | { k: 'quote'; text: string }
  | { k: 'table'; header: string[]; rows: string[][]; widths: number[]; align?: ('l' | 'r' | 'c')[] }
  | { k: 'image'; img: EmbeddedImage }
  | { k: 'pagebreak' };

const t = (text: string, o: Omit<Run, 't'> = {}): Run => ({ t: text, ...o });
const P = (...runs: (Run | string)[]): Block => ({ k: 'p', runs: runs.map(r => (typeof r === 'string' ? t(r) : r)) });
const B = (...runs: (Run | string)[]): Block => ({ k: 'bullet', runs: runs.map(r => (typeof r === 'string' ? t(r) : r)) });

const f2 = (v: number | null) => (v === null ? '—' : v.toFixed(2));
const pc = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`);
const bar = (pctVal: number) => '█'.repeat(Math.max(0, Math.round(pctVal / 10))) + '░'.repeat(10 - Math.max(0, Math.round(pctVal / 10)));
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function buildBlocks(a: FeedbackAnalysis, meta: ReportMeta, ch: ReportCharts): Block[] {
  const out: Block[] = [];
  const fig = (img?: ChartImage) => { if (img) out.push({ k: 'image', img: { ...img, rid: ++imgCount } }); };
  let imgCount = 0;
  const n = a.n;
  const reliable = n >= 30;
  const caveat = n < 10
    ? 'With fewer than 10 forms these figures are counts and individual comments, not findings.'
    : n < 30
      ? `With ${n} forms the figures are indicative only.`
      : '';
  const withMean = a.params.filter((p): p is ParamStats & { mean: number } => p.mean !== null);
  const sorted = [...withMean].sort((x, y) => y.mean - x.mean);
  const best = sorted.slice(0, 2);
  const worst = sorted.slice(-2).reverse();
  // Strengths/weaknesses are judged against the event's own average, not an externally set target.
  const evAvg = a.overallMean;
  const below = evAvg === null ? [] : sorted.filter(p => p.mean < evAvg - 0.25);
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // ── Cover ──
  out.push({ k: 'title', text: 'Feedback Analysis Report' });
  out.push({ k: 'subtitle', text: meta.formTitle });
  if (meta.eventName) out.push(P(t('Event: ', { b: true }), meta.eventName));
  out.push(P(t('Forms analysed: ', { b: true }), String(n), t('   Generated: ', { b: true }), today, meta.preparedBy ? t('   Prepared by: ', { b: true }) : '', meta.preparedBy || ''));
  if (caveat) out.push(P(t(caveat, { i: true, color: 'B45309' })));

  // ── 1. Event and response profile ──
  out.push({ k: 'h1', text: '1. Event and response profile' });
  out.push(P(`${n} feedback form${n === 1 ? ' was' : 's were'} received. Results describe the people who responded.`));
  const mix = (segs: SegmentStats[], label: string) => segs.length
    ? P(t(`${label}: `, { b: true }), segs.slice(0, 8).map(s => `${s.name} (${s.n})`).join(', ') + (segs.length > 8 ? `, and ${segs.length - 8} more` : '') + '.')
    : null;
  [mix(a.designations, 'By designation / programme / semester'), mix(a.departments, 'By department')].forEach(b => { if (b) out.push(b); });
  const q = a.quality;
  if (q.straightLined || q.contradictions || q.duplicates) {
    out.push(P(t('Data-quality checks: ', { b: true }),
      list([
        q.straightLined ? `${q.straightLined} form${q.straightLined === 1 ? '' : 's'} with all nine ratings identical` : '',
        q.contradictions ? `${q.contradictions} form${q.contradictions === 1 ? '' : 's'} where “Overall satisfaction” and “Overall rating” differ by 2 or more points` : '',
        q.duplicates ? `${q.duplicates} possible duplicate${q.duplicates === 1 ? '' : 's'} (same participant name)` : '',
      ].filter(Boolean)),
      '. These forms were kept in all figures; consider re-running the main results without them.'));
  } else {
    out.push(P(t('Data-quality checks: ', { b: true }), 'no straight-lined, contradictory or duplicate forms were found.'));
  }

  // ── 2. Headline results ──
  out.push({ k: 'h1', text: '2. Headline results' });
  const ov = a.overall;
  out.push({
    k: 'table',
    header: ['Measure', 'Result', 'Base'],
    widths: [4200, 2800, 2000],
    align: ['l', 'r', 'r'],
    rows: [
      ['Overall rating (out of 5)', ov.mean === null ? '—' : `${f2(ov.mean)}${ov.ci !== null ? ` ± ${f2(ov.ci)}` : ''}`, `n = ${ov.n}`],
      ['Participants rating the event 4 or 5', pc(ov.top2), `n = ${ov.n}`],
      ['Average across the nine parameters', a.overallMean === null ? '—' : f2(a.overallMean), `n = ${n}`],
      ['Knowledge / skills enhanced (Yes)', a.knowledge.ci ? `${pc(a.knowledge.ci.p * 100)} (${pc(a.knowledge.ci.lo * 100)}–${pc(a.knowledge.ci.hi * 100)})` : '—', `n = ${a.knowledge.n}`],
      ['Will apply the learning (Yes)', a.apply.ci ? `${pc(a.apply.ci.p * 100)} (${pc(a.apply.ci.lo * 100)}–${pc(a.apply.ci.hi * 100)})` : '—', `n = ${a.apply.n}`],
      ['Learning-outcome achievement index', pc(a.outcomeIndex), `n = ${n}`],
      ['Met all five learning outcomes', pc(a.fullAchievement), `n = ${n}`],
    ],
  });
  fig(ch.overall);
  const verdict: string[] = [];
  if (ov.mean !== null && ov.n >= 2 && ov.top2 !== null && ov.bottom2 !== null) {
    verdict.push(`The overall rating is ${f2(ov.mean)} out of 5${ov.ci !== null ? ` (95% interval ${f2(ov.mean - ov.ci)}–${f2(ov.mean + ov.ci)})` : ''}: ${pc(ov.top2)} of respondents rated the event 4 or 5 and ${pc(ov.bottom2)} rated it 1 or 2.`);
  }
  if (best.length) verdict.push(`Strongest parameters: ${list(best.map(p => `${p.label} (${f2(p.mean)})`))}.`);
  if (worst.length && sorted.length > 2) verdict.push(`Weakest parameters: ${list(worst.map(p => `${p.label} (${f2(p.mean)})`))}.`);
  if (verdict.length) {
    out.push(P(t('In brief', { b: true })));
    verdict.forEach(v => out.push(B(v)));
  }
  if (caveat) out.push(P(t(caveat, { i: true, color: 'B45309' })));

  // ── 3. Parameter results ──
  out.push({ k: 'h1', text: '3. Parameter results' });
  out.push({
    k: 'table',
    header: ['Parameter', 'n', 'Mean', '95% CI', 'Median', 'SD', 'Top-2', 'Bottom-2', 'vs avg', 'Rank'],
    widths: [2200, 500, 700, 800, 750, 650, 800, 900, 750, 600],
    align: ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    rows: [...a.params, a.overall].map(p => [
      p.label, String(p.n), f2(p.mean), p.ci === null ? '—' : `±${f2(p.ci)}`, p.median === null ? '—' : p.median.toFixed(1),
      f2(p.sd), pc(p.top2), pc(p.bottom2), p.mean === null || evAvg === null ? '—' : `${p.mean - evAvg >= 0 ? '+' : ''}${(p.mean - evAvg).toFixed(2)}`,
      p.rank === null ? '—' : String(p.rank),
    ]),
  });
  out.push(P(t(`vs avg = mean minus the event's own average across the nine parameters${evAvg === null ? '' : ` (${f2(evAvg)})`}. Top-2 / Bottom-2 = share of scores of 4–5 / 1–2. SD = spread of answers (above about 1.1 means opinions are split).`, { i: true, color: '64748B' })));

  fig(ch.means);
  fig(ch.distribution);
  out.push({ k: 'h2', text: 'What the parameters show' });
  if (sorted.length === 0) {
    out.push(P('No ratings have been submitted yet.'));
  } else {
    out.push(B(t('Highest: ', { b: true }), `${sorted[0].label} at ${f2(sorted[0].mean)}, with ${pc(sorted[0].top2)} of respondents scoring 4 or 5.`));
    const low = sorted[sorted.length - 1];
    out.push(B(t('Lowest: ', { b: true }), `${low.label} at ${f2(low.mean)}, with ${pc(low.top2)} scoring 4 or 5 and ${pc(low.bottom2)} scoring 1 or 2.`));
    out.push(B(t('Against the event average: ', { b: true }), evAvg === null ? 'not available.' : below.length === 0 ? `no parameter sits clearly below the event's own average of ${f2(evAvg)}; ratings are fairly even.` : `${list(below.map(p => p.label))} ${below.length === 1 ? 'sits' : 'sit'} at least 0.25 below the event's own average of ${f2(evAvg)}.`));
    const split = a.params.filter(p => p.n >= 10 && (p.sd ?? 0) > 1.1);
    if (split.length) out.push(B(t('Split opinions: ', { b: true }), `${list(split.map(p => p.label))} ${split.length === 1 ? 'shows' : 'show'} a wide spread of answers — the audience is divided and the average hides two groups.`));
    const allScores = a.params.reduce((s, p) => s + p.n, 0);
    const fives = a.params.reduce((s, p) => s + p.counts[4], 0);
    if (allScores >= 30 && fives / allScores > 0.6) out.push(B(t('Ceiling effect: ', { b: true }), `${Math.round((fives / allScores) * 100)}% of all scores are 5, so averages cannot separate strong from weak parameters; compare the share of 5s and read the comments.`));
  }

  out.push({ k: 'h2', text: 'Dimension scores' });
  fig(ch.dimensions);
  out.push({
    k: 'table', header: ['Dimension', 'Made up of', 'Mean'], widths: [1800, 5400, 1800], align: ['l', 'l', 'r'],
    rows: a.dimensions.map(d => [
      d.label,
      DIMENSIONS.find(x => x.key === d.key)!.items.map(k => RATING_PARAMS.find(p => p.key === k)!.short).join(' + '),
      f2(d.mean),
    ]),
  });
  const dims = a.dimensions.filter((d): d is typeof d & { mean: number } => d.mean !== null).sort((x, y) => y.mean - x.mean);
  if (dims.length >= 2) {
    out.push(P(`${dims[0].label} is the strongest dimension (${f2(dims[0].mean)}) and ${dims[dims.length - 1].label.toLowerCase()} the weakest (${f2(dims[dims.length - 1].mean)})${dims[0].mean - dims[dims.length - 1].mean >= 0.4 ? ', a gap large enough to act on' : ', a modest gap'}.`));
  }
  const mm = (k: string) => a.params.find(p => p.key === k)?.mean ?? null;
  const avg = (ks: string[]) => { const v = ks.map(mm).filter((x): x is number => x !== null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const sup = avg(['tools', 'organization']), des = avg(['relevance', 'clarity']), sub = avg(['content', 'practical']), del = avg(['resource', 'interaction']), cont = mm('content');
  if (a.overallMean !== null && n >= 10) {
    if (sup !== null && sup < a.overallMean - 0.5) out.push(B(t('Logistics: ', { b: true }), 'tools/technology and organization score well below the other parameters — a venue, equipment or scheduling issue separate from the teaching.'));
    if (des !== null && sub !== null && des - sub >= 0.4) out.push(B(t('Substance: ', { b: true }), 'the topic and objectives are rated higher than content depth and practical applicability — the aims are right but the substance or usability falls short.'));
    if (del !== null && cont !== null && del - cont >= 0.4) out.push(B(t('Delivery vs content: ', { b: true }), 'delivery and interaction are rated above content depth — good delivery of material that may be thin for this audience.'));
  }

  // ── 4. Segment results ──
  out.push({ k: 'h1', text: '4. Segment results' });
  const segSection = (title: string, segs: SegmentStats[]) => {
    if (segs.length === 0) return;
    out.push({ k: 'h2', text: title });
    out.push({
      k: 'table', header: ['Group', 'n', 'Respondent index', 'Top-2', 'Will apply'], widths: [3400, 700, 2000, 1400, 1500], align: ['l', 'r', 'r', 'r', 'r'],
      rows: segs.map(s => [s.n < 10 ? `${s.name} (n<10)` : s.name, String(s.n), f2(s.indexMean), pc(s.top2), pc(s.applyYesPct)]),
    });
    const big = segs.filter(s => s.n >= 10).sort((x, y) => y.indexMean - x.indexMean);
    if (big.length >= 2) {
      const hi = big[0], lo = big[big.length - 1];
      out.push(P(`Among groups with at least 10 responses, ${hi.name} rated the event highest (${f2(hi.indexMean)}) and ${lo.name} lowest (${f2(lo.indexMean)}), a difference of ${(hi.indexMean - lo.indexMean).toFixed(2)} points. This is a descriptive comparison; no significance test has been run, so treat it as a pointer rather than proof.`));
    } else {
      out.push(P(t('No group has 10 or more responses yet, so groups are listed for reference and no comparison is drawn.', { i: true })));
    }
  };
  segSection('By designation / programme / semester', a.designations);
  segSection('By department', a.departments);
  fig(ch.segments);
  fig(ch.respondentIndex);
  if (a.designations.length === 0 && a.departments.length === 0) out.push(P('No designation or department answers are available to segment on.'));

  // ── 5. Learning outcomes and impact ──
  out.push({ k: 'h1', text: '5. Learning outcomes and impact' });
  out.push({
    k: 'table', header: ['Learning outcome', 'Respondents ticking Yes', '', 'n'], widths: [4400, 1500, 2200, 900], align: ['l', 'r', 'l', 'r'],
    rows: a.outcomes.map(o => [o.label, pc(o.pct), bar(o.pct), String(o.n)]),
  });
  fig(ch.outcomes);
  const ocs = a.outcomes.filter(o => o.n > 0).sort((x, y) => y.pct - x.pct);
  if (ocs.length >= 2) {
    out.push(P(`The outcome achievement index is ${pc(a.outcomeIndex)}, and ${pc(a.fullAchievement)} of respondents met all five outcomes. “${ocs[0].short}” was met most often (${pc(ocs[0].pct)}) and “${ocs[ocs.length - 1].short}” least often (${pc(ocs[ocs.length - 1].pct)})${ocs[0].pct - ocs[ocs.length - 1].pct >= 20 ? ' — that learning objective was not delivered as well as the others and needs reworking' : ''}.`));
  }
  if (a.knowledge.ci && a.apply.ci) {
    out.push(P(
      `${pc(a.knowledge.ci.p * 100)} of respondents said the event enhanced their knowledge or skills (95% interval ${pc(a.knowledge.ci.lo * 100)}–${pc(a.knowledge.ci.hi * 100)}), and ${pc(a.apply.ci.p * 100)} said they will apply the learning (${pc(a.apply.ci.lo * 100)}–${pc(a.apply.ci.hi * 100)}).`,
      ov.top2 !== null && ov.top2 >= 60 && a.apply.ci.p < 0.7 ? ' Satisfaction is high but the share intending to apply the learning is under 70%: participants enjoyed the event but may not find it usable — add applied tasks and follow-up.' : '',
      a.knowledge.ci.p < 0.7 ? ' The knowledge-gain rate is under 70%, which suggests the level was too basic or too advanced for part of the audience — check by designation before re-pitching.' : '',
    ));
  }
  fig(ch.impact);
  out.push(P(t('Note: these are self-reported measures of satisfaction and learning, not a test of learning itself. To show actual learning, add a short pre-test and post-test.', { i: true, color: '64748B' })));

  // ── 6. Drivers and reliability ──
  if (a.regression || a.alpha) {
    out.push({ k: 'h1', text: '6. Drivers and reliability' });
    if (a.regression) {
      fig(ch.drivers);
      const bs = [...a.regression.betas].sort((x, y) => y.beta - x.beta);
      const name = (k: string) => RATING_PARAMS.find(p => p.key === k)?.short ?? k;
      out.push(P(`A regression of the overall rating on the other eight ratings (n = ${a.regression.n}) explains ${Math.round(a.regression.r2 * 100)}% of the variation. The largest standardised coefficients are ${list(bs.slice(0, 3).map(b => `${name(b.key)} (β ${b.beta.toFixed(2)})`))}, so those ratings move the overall rating most. This shows association, not cause: a link between an item and overall satisfaction does not prove that improving it will raise satisfaction.`));
    }
    if (a.alpha) {
      out.push(P(`Cronbach's alpha for the nine ratings is ${a.alpha.alpha.toFixed(2)} (n = ${a.alpha.n}). ${a.alpha.alpha >= 0.8 ? 'This is good: the nine ratings measure one consistent thing and can be combined into the respondent index.' : a.alpha.alpha >= 0.7 ? 'This is acceptable: the respondent index is reasonable to use.' : 'This is below 0.70, so the nine ratings should be read separately rather than merged into one index.'}`));
    }
  }

  // ── 7. Open comments ──
  out.push({ k: 'h1', text: '7. Open comments' });
  out.push(P(t('Comments were grouped into themes by keyword as a first pass; one respondent can appear under several themes. Spot-check against the raw answers before quoting figures externally.', { i: true, color: '64748B' })));
  a.comments.forEach(c => {
    out.push({ k: 'h2', text: `${c.title} (${c.answered} of ${n} answered)` });
    if (c.themes.length === 0) { out.push(P('No recurring themes were detected.')); return; }
    fig(ch.comments[c.key]);
    out.push({
      k: 'table', header: ['Theme', 'Respondents', 'Share'], widths: [4600, 1800, 1800], align: ['l', 'r', 'r'],
      rows: c.themes.slice(0, 6).map(th => [th.theme, String(th.respondents), pc(th.pct)]),
    });
    c.themes.slice(0, 3).forEach(th => th.quotes.slice(0, 1).forEach(qt => out.push({ k: 'quote', text: `“${qt}” — ${th.theme}` })));
    if (c.key === 'future') {
      const demand = c.themes.filter(th => th.pct >= 10);
      if (demand.length) out.push(P(`Topics named by 10% or more of respondents indicate real demand: ${list(demand.map(th => th.theme))}.`));
    }
  });

  // ── 8. Conclusions ──
  out.push({ k: 'h1', text: '8. Conclusions' });
  out.push(P(t('What worked', { b: true })));
  const worked: string[] = [];
  best.forEach(p => worked.push(`${p.label} scored ${f2(p.mean)} (${pc(p.top2)} rated it 4 or 5).`));
  if (a.knowledge.ci && a.knowledge.ci.p >= 0.8) worked.push(`${pc(a.knowledge.ci.p * 100)} said the event enhanced their knowledge or skills.`);
  if (a.apply.ci && a.apply.ci.p >= 0.8) worked.push(`${pc(a.apply.ci.p * 100)} intend to apply the learning.`);
  const topValuable = a.comments.find(c => c.key === 'valuable')?.themes[0];
  if (topValuable) worked.push(`The most-cited valuable aspect was “${topValuable.theme}” (${topValuable.respondents} respondents).`);
  (worked.length ? worked : ['No clear strengths can be reported yet.']).forEach(w => out.push(B(w)));
  out.push(P(t('What did not work as well', { b: true })));
  const weak: string[] = [];
  below.slice(0, 4).forEach(p => weak.push(`${p.label} scored ${f2(p.mean)}, ${((evAvg ?? p.mean) - p.mean).toFixed(2)} below the event's own average.`));
  if (ocs.length && ocs[ocs.length - 1].pct < 70) weak.push(`“${ocs[ocs.length - 1].short}” was met by only ${pc(ocs[ocs.length - 1].pct)} of respondents.`);
  if (a.apply.ci && a.apply.ci.p < 0.7) weak.push(`Only ${pc(a.apply.ci.p * 100)} intend to apply the learning.`);
  const topSuggestion = a.comments.find(c => c.key === 'suggestions')?.themes[0];
  if (topSuggestion) weak.push(`The most frequent improvement theme was “${topSuggestion.theme}” (${topSuggestion.respondents} respondents).`);
  (weak.length ? weak : ['No parameter stands out as weaker than the rest on the forms received.']).forEach(w => out.push(B(w)));
  if (!reliable) out.push(P(t(`These conclusions rest on ${n} form${n === 1 ? '' : 's'} and describe respondents only; confirm them as more forms arrive.`, { i: true, color: 'B45309' })));

  // ── 9. Recommendations ──
  out.push({ k: 'h1', text: '9. Recommendations and action plan' });
  const recs: [string, string][] = [];
  below.slice(0, 3).forEach(p => {
    const adv: Record<string, string> = {
      content: 'Add depth, cases or exercises to the content.',
      practical: 'Add applied tasks, case studies and hands-on exercises.',
      tools: 'Review the tools/technology used and the venue equipment.',
      organization: 'Fix scheduling, coordination and venue arrangements.',
      interaction: 'Build in more discussion, Q&A and participant activities.',
      resource: 'Review the choice of resource person and session design with them.',
      relevance: 'Re-check the topic against the audience’s needs before the next edition.',
      clarity: 'State objectives more clearly at the start of the programme.',
      satisfaction: 'Read the improvement comments for the cause of lower satisfaction.',
    };
    recs.push([adv[p.key as string] ?? `Review ${p.label}.`, `${p.label} mean ${f2(p.mean)} vs event average ${f2(evAvg)}`]);
  });
  if (ocs.length && ocs[ocs.length - 1].pct < 70) recs.push([`Rework the part of the programme that delivers “${ocs[ocs.length - 1].short}”.`, `Met by ${pc(ocs[ocs.length - 1].pct)} of respondents`]);
  if (a.apply.ci && a.apply.ci.p < 0.7) recs.push(['Add applied tasks and a follow-up after the event.', `${pc(a.apply.ci.p * 100)} intend to apply the learning`]);
  if (a.knowledge.ci && a.knowledge.ci.p < 0.7) recs.push(['Re-pitch the level of the content after checking by designation.', `${pc(a.knowledge.ci.p * 100)} report enhanced knowledge`]);
  a.comments.find(c => c.key === 'suggestions')?.themes.slice(0, 2).forEach(th => recs.push([`Address “${th.theme}” raised in suggestions.`, `${th.respondents} respondent${th.respondents === 1 ? '' : 's'} (${pc(th.pct)})`]));
  a.comments.find(c => c.key === 'future')?.themes.filter(th => th.pct >= 10).slice(0, 2).forEach(th => recs.push([`Plan a future session on “${th.theme}”.`, `${th.respondents} respondent${th.respondents === 1 ? '' : 's'} (${pc(th.pct)}) asked for it`]));
  if (recs.length === 0) {
    out.push(P('No corrective action is indicated by the forms received. Keep the current design and continue collecting feedback.'));
  } else {
    out.push({
      k: 'table', header: ['#', 'Action', 'Evidence', 'Owner', 'Due'], widths: [400, 3600, 2900, 1100, 1000], align: ['c', 'l', 'l', 'l', 'l'],
      rows: recs.map((r, i) => [String(i + 1), r[0], r[1], '', '']),
    });
    out.push(P(t('Owner and due date are left blank to be agreed with the programme team.', { i: true, color: '64748B' })));
  }

  // ── Annexure ──
  out.push({ k: 'h1', text: 'Annexure: method and limitations' });
  [
    'Ratings use a 1–5 scale. Mean, median, SD and top-2/bottom-2 shares are computed over the answers given; n is reported for each because it can differ by question.',
    '95% confidence interval of a mean = t(n−1) × SD ÷ √n. For a Yes/No percentage the interval is p ± 1.96 × √(p(1−p)/n). Intervals are only shown for 2 or more answers and are most reliable from about 30 forms.',
    'Net score = top-2-box % minus bottom-2-box %. vs avg = mean minus the event’s own average across the nine parameters. Rank 1 is the highest mean.',
    'Respondent index = each person’s average of their nine ratings. Dimension scores average related items (design, content, delivery, support).',
    'Outcome achievement index = total outcome ticks ÷ (5 × forms with all five answered). “Met all five” counts forms with every outcome ticked.',
    'Segment comparisons are descriptive and shown only for groups of 10 or more; no significance test has been applied.',
    'Comment themes are assigned by keyword matching and are a first pass for a human reviewer to confirm.',
    'Results describe the people who responded. Correlation and regression show association, not cause.',
  ].forEach(x => out.push(B(x)));
  return out;
}

// ───────────────────────── WordprocessingML writer ─────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function runXml(r: Run, extra = ''): string {
  if (!r.t) return '';
  const props = `${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}${r.color ? `<w:color w:val="${r.color}"/>` : ''}${extra}`;
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(r.t)}</w:t></w:r>`;
}

function tableXml(b: Extract<Block, { k: 'table' }>): string {
  const total = b.widths.reduce((a, c) => a + c, 0);
  const jc = (i: number) => ({ l: 'left', r: 'right', c: 'center' }[b.align?.[i] ?? 'l']);
  const cell = (text: string, i: number, header: boolean, shade?: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="${b.widths[i]}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="0F2A47"/>' : shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:jc w:val="${jc(i)}"/></w:pPr>${runXml({ t: text, b: header, color: header ? 'FFFFFF' : undefined }, '<w:sz w:val="18"/>')}</w:p></w:tc>`;
  const rows = [
    `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${b.header.map((h, i) => cell(h, i, true)).join('')}</w:tr>`,
    ...b.rows.map((r, ri) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => cell(c, i, false, ri % 2 ? 'F6F9FC' : undefined)).join('')}</w:tr>`),
  ];
  const border = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${b.widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl><w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>`;
}

function blockXml(b: Block): string {
  switch (b.k) {
    case 'title': return `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${runXml({ t: b.text })}</w:p>`;
    case 'subtitle': return `<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr>${runXml({ t: b.text })}</w:p>`;
    case 'h1': return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${runXml({ t: b.text })}</w:p>`;
    case 'h2': return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${runXml({ t: b.text })}</w:p>`;
    case 'p': return `<w:p>${b.runs.map(r => runXml(r)).join('')}</w:p>`;
    case 'bullet': return `<w:p><w:pPr><w:ind w:left="400" w:hanging="260"/><w:spacing w:after="60"/></w:pPr>${runXml({ t: '•  ' })}${b.runs.map(r => runXml(r)).join('')}</w:p>`;
    case 'quote': return `<w:p><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="2E75B6"/></w:pBdr><w:ind w:left="300"/></w:pPr>${runXml({ t: b.text, i: true, color: '475569' })}</w:p>`;
    case 'table': return tableXml(b);
    case 'image': {
      const cx = 5900000;
      const cy = Math.round((cx * b.img.height) / b.img.width);
      const n = b.img.rid;
      return `<w:p><w:pPr><w:keepNext/><w:spacing w:before="80" w:after="120"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Chart ${n}" descr="${esc(b.img.alt)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="chart${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    }
    case 'pagebreak': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="1E293B"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr><w:rPr><w:b/><w:color w:val="0F2A47"/><w:sz w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="2E75B6"/></w:pBdr><w:spacing w:after="200"/></w:pPr><w:rPr><w:color w:val="2E75B6"/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="0F2A47"/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2E75B6"/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`;

export async function buildFeedbackReportDocx(a: FeedbackAnalysis, meta: ReportMeta, charts: ReportCharts = { comments: {} }): Promise<Blob> {
  const blocks = buildBlocks(a, meta, charts);
  const body = blocks.map(blockXml).join('');
  const images = blocks.filter((b): b is Extract<Block, { k: 'image' }> => b.k === 'image').map(b => b.img);
  const sect = '<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567"/></w:sectPr>';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">Feedback Analysis Report · Page </w:t></w:r><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${images.map(i => `<Relationship Id="rIdImg${i.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart${i.rid}.png"/>`).join('')}</Relationships>`);
  images.forEach(i => zip.file(`word/media/chart${i.rid}.png`, i.png));
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', STYLES);
  zip.file('word/footer1.xml', footerXml);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
