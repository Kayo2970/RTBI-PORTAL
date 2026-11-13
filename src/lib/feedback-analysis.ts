import type { PublicFormItem, FormSubmissionItem } from '@/lib/local-data';

/**
 * Analysis of the Feedback Form Template's responses, following the plan in
 * "Feedback Form Analysis Guide" (summary statistics, combined measures,
 * learning outcomes/impact, segments, drivers, reliability, comment themes).
 *
 * Questions are located by their exact template label (applying a template
 * regenerates every field id, so labels are the only stable key — same
 * convention as src/lib/docx-fill.ts). Keep these in sync with
 * FEEDBACK_FORM_TEMPLATE_ID's fields in local-data.ts.
 */

export const RATING_PARAMS = [
  { key: 'relevance', label: 'Relevance of the topic', short: 'Relevance' },
  { key: 'clarity', label: 'Clarity of objectives', short: 'Clarity' },
  { key: 'content', label: 'Content quality & depth', short: 'Content depth' },
  { key: 'practical', label: 'Practical applicability', short: 'Practical use' },
  { key: 'resource', label: 'Effectiveness of resource person', short: 'Resource person' },
  { key: 'tools', label: 'Use of tools/technology', short: 'Tools / tech' },
  { key: 'interaction', label: 'Interaction & engagement', short: 'Interaction' },
  { key: 'organization', label: 'Organization & coordination', short: 'Organization' },
  { key: 'satisfaction', label: 'Overall satisfaction', short: 'Satisfaction' },
] as const;

export type ParamKey = typeof RATING_PARAMS[number]['key'];

export const OUTCOMES = [
  { key: 'lo1', label: 'Understand key concepts clearly', short: 'Key concepts' },
  { key: 'lo2', label: 'Apply learning in practical/academic context', short: 'Apply learning' },
  { key: 'lo3', label: 'Use relevant tools/techniques introduced', short: 'Use tools' },
  { key: 'lo4', label: 'Enhance problem-solving/decision-making ability', short: 'Problem solving' },
  { key: 'lo5', label: 'Relate concepts to industry practices', short: 'Industry link' },
] as const;

export const DIMENSIONS = [
  { key: 'design', label: 'Design', items: ['relevance', 'clarity'] },
  { key: 'content', label: 'Content', items: ['content', 'practical'] },
  { key: 'delivery', label: 'Delivery', items: ['resource', 'interaction'] },
  { key: 'support', label: 'Support', items: ['tools', 'organization'] },
] as const;

const L = {
  event: 'Name of Event',
  designation: 'Designation/Program/Semester',
  department: 'Department',
  participant: 'Participant Name',
  knowledge: 'Did the event enhance your knowledge/skills?',
  apply: 'Will you apply the learning in future?',
  overall: 'Overall Rating (Out of 5)',
  takeaways: 'Key Takeaways from the Session',
  valuable: 'Most Valuable Aspect of the Event',
  suggestions: 'Suggestions for Improvement',
  future: 'Topics you would like in future sessions',
};

export interface ResponseRow {
  id: string;
  submittedAt: string;
  participant: string;
  designation: string;
  department: string;
  ratings: Record<ParamKey, number | null>;
  outcomes: (0 | 1 | null)[];
  knowledge: 0 | 1 | null;
  apply: 0 | 1 | null;
  overall: number | null;
  index: number | null; // mean of the nine ratings
  straightLined: boolean;
  contradiction: boolean; // Overall satisfaction vs overall rating differ by 2+
  comments: { takeaways: string; valuable: string; suggestions: string; future: string };
}

function rawAnswer(form: PublicFormItem, sub: FormSubmissionItem, label: string): unknown {
  const field = form.fields.find(f => f.label === label);
  if (!field) return undefined;
  return sub.data[field.id] ?? sub.data[field.label];
}

function rating(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

function yesNo(v: unknown): 0 | 1 | null {
  if (v === true || v === 'true') return 1;
  if (v === false || v === 'false') return 0;
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'yes') return 1;
  if (s === 'no') return 0;
  return null;
}

const text = (v: unknown) => String(Array.isArray(v) ? v.join(', ') : v ?? '').trim();

export function buildRows(form: PublicFormItem, subs: FormSubmissionItem[]): ResponseRow[] {
  return subs.map(sub => {
    const ratings = {} as Record<ParamKey, number | null>;
    RATING_PARAMS.forEach(p => { ratings[p.key] = rating(rawAnswer(form, sub, p.label)); });
    const given = RATING_PARAMS.map(p => ratings[p.key]).filter((v): v is number => v !== null);
    const index = given.length > 0 ? mean(given) : null;
    const overall = rating(rawAnswer(form, sub, L.overall));
    const sat = ratings.satisfaction;
    return {
      id: sub.id,
      submittedAt: sub.submittedAt,
      participant: text(rawAnswer(form, sub, L.participant)),
      designation: text(rawAnswer(form, sub, L.designation)),
      department: text(rawAnswer(form, sub, L.department)),
      ratings,
      outcomes: OUTCOMES.map(o => yesNo(rawAnswer(form, sub, o.label))),
      knowledge: yesNo(rawAnswer(form, sub, L.knowledge)),
      apply: yesNo(rawAnswer(form, sub, L.apply)),
      overall,
      index,
      straightLined: given.length === RATING_PARAMS.length && given.every(v => v === given[0]),
      contradiction: sat !== null && overall !== null && Math.abs(sat - overall) >= 2,
      comments: {
        takeaways: text(rawAnswer(form, sub, L.takeaways)),
        valuable: text(rawAnswer(form, sub, L.valuable)),
        suggestions: text(rawAnswer(form, sub, L.suggestions)),
        future: text(rawAnswer(form, sub, L.future)),
      },
    };
  });
}

// ───────────────────────── basic statistics ─────────────────────────

export function mean(v: number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mode(v: number[]): number {
  const c: Record<number, number> = {};
  v.forEach(x => { c[x] = (c[x] || 0) + 1; });
  return Number(Object.entries(c).sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]))[0][0]);
}

/** Sample standard deviation (n − 1). */
export function sd(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

// Two-sided 95% t critical values for small df; 1.96 beyond 120.
const T95: Record<number, number> = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
  11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131, 16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086,
  21: 2.08, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.06, 26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
  40: 2.021, 60: 2.0, 120: 1.98,
};
function tCrit(df: number): number {
  if (df < 1) return NaN;
  if (T95[df]) return T95[df];
  if (df > 120) return 1.96;
  const keys = Object.keys(T95).map(Number).sort((a, b) => a - b);
  const upper = keys.find(k => k > df)!;
  const lower = [...keys].reverse().find(k => k < df)!;
  return T95[lower] + ((T95[upper] - T95[lower]) * (df - lower)) / (upper - lower);
}

/** Half-width of the 95% confidence interval of a mean (same as =CONFIDENCE.T). */
export function ciHalfWidth(v: number[]): number | null {
  if (v.length < 2) return null;
  return (tCrit(v.length - 1) * sd(v)) / Math.sqrt(v.length);
}

/** 95% interval for a proportion (normal approximation), clamped to 0–1. */
export function proportionCi(yes: number, n: number): { p: number; lo: number; hi: number } | null {
  if (n === 0) return null;
  const p = yes / n;
  const hw = 1.96 * Math.sqrt((p * (1 - p)) / n);
  return { p, lo: Math.max(0, p - hw), hi: Math.min(1, p + hw) };
}

const nums = (vals: (number | null)[]) => vals.filter((v): v is number => v !== null);

export interface ParamStats {
  key: ParamKey | 'overall';
  label: string;
  n: number;
  mean: number | null;
  median: number | null;
  mode: number | null;
  sd: number | null;
  ci: number | null;
  counts: [number, number, number, number, number];
  top2: number | null; // %
  bottom2: number | null; // %
  net: number | null;
  fivesPct: number | null;
  rank: number | null;
}

export function statsFor(key: ParamKey | 'overall', label: string, values: number[]): ParamStats {
  const n = values.length;
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  values.forEach(v => { counts[v - 1] += 1; });
  if (n === 0) {
    return { key, label, n, mean: null, median: null, mode: null, sd: null, ci: null, counts, top2: null, bottom2: null, net: null, fivesPct: null, rank: null };
  }
  const top2 = ((counts[3] + counts[4]) / n) * 100;
  const bottom2 = ((counts[0] + counts[1]) / n) * 100;
  return {
    key, label, n,
    mean: mean(values), median: median(values), mode: mode(values), sd: sd(values), ci: ciHalfWidth(values),
    counts, top2, bottom2, net: top2 - bottom2, fivesPct: (counts[4] / n) * 100, rank: null,
  };
}

// ───────────────────────── correlation / reliability / regression ─────────────────────────

function ranks(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(v.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function pearson(x: number[], y: number[]): number | null {
  if (x.length < 3 || x.length !== y.length) return null;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export function spearman(x: number[], y: number[]): number | null {
  return pearson(ranks(x), ranks(y));
}

/** Cronbach's alpha over complete cases of the nine rating columns. */
export function cronbachAlpha(rows: ResponseRow[]): { alpha: number; n: number } | null {
  const complete = rows.filter(r => RATING_PARAMS.every(p => r.ratings[p.key] !== null));
  const k = RATING_PARAMS.length;
  if (complete.length < 5) return null;
  const itemVar = RATING_PARAMS.map(p => {
    const col = complete.map(r => r.ratings[p.key] as number);
    return sd(col) ** 2;
  });
  const totals = complete.map(r => RATING_PARAMS.reduce((a, p) => a + (r.ratings[p.key] as number), 0));
  const totalVar = sd(totals) ** 2;
  if (totalVar === 0) return null;
  return { alpha: (k / (k - 1)) * (1 - itemVar.reduce((a, b) => a + b, 0) / totalVar), n: complete.length };
}

/**
 * Multiple regression of the overall rating on the eight non-satisfaction
 * ratings, returning standardised coefficients (betas) and R². Needs enough
 * forms per predictor; returns null when the system is singular or too small.
 */
export function driverRegression(rows: ResponseRow[]): { betas: { key: ParamKey; beta: number }[]; r2: number; n: number } | null {
  const predictors = RATING_PARAMS.filter(p => p.key !== 'satisfaction');
  const complete = rows.filter(r => r.overall !== null && predictors.every(p => r.ratings[p.key] !== null));
  const n = complete.length;
  const k = predictors.length;
  if (n < Math.max(30, k * 4)) return null;

  const X = predictors.map(p => complete.map(r => r.ratings[p.key] as number));
  const y = complete.map(r => r.overall as number);
  const z = (col: number[]) => {
    const m = mean(col), s = sd(col);
    return s === 0 ? null : col.map(v => (v - m) / s);
  };
  const Z = X.map(z);
  const zy = z(y);
  if (zy === null || Z.some(c => c === null)) return null;
  const ZZ = Z as number[][];

  // Normal equations on standardised data: (ZᵀZ) b = Zᵀy.
  const A: number[][] = ZZ.map(ci => ZZ.map(cj => ci.reduce((a, v, t) => a + v * cj[t], 0)));
  const b: number[] = ZZ.map(ci => ci.reduce((a, v, t) => a + v * zy[t], 0));
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-9) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j];
    }
  }
  const beta = M.map((row, i) => row[k] / row[i]);
  const fitted = zy.map((_, t) => beta.reduce((a, bt, i) => a + bt * ZZ[i][t], 0));
  const ssTot = zy.reduce((a, v) => a + v * v, 0);
  const ssRes = zy.reduce((a, v, t) => a + (v - fitted[t]) ** 2, 0);
  return {
    betas: predictors.map((p, i) => ({ key: p.key, beta: beta[i] })),
    r2: 1 - ssRes / ssTot,
    n,
  };
}

// ───────────────────────── combined analysis ─────────────────────────

export interface SegmentStats {
  name: string;
  n: number;
  indexMean: number;
  top2: number;
  paramMeans: Record<ParamKey, number | null>;
  applyYesPct: number | null;
}

function segmentBy(rows: ResponseRow[], pick: (r: ResponseRow) => string): SegmentStats[] {
  const groups = new Map<string, { name: string; rows: ResponseRow[] }>();
  rows.forEach(r => {
    const raw = pick(r).replace(/\s+/g, ' ').trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    const g = groups.get(key) ?? { name: raw, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  });
  return [...groups.values()]
    .map(g => {
      const idx = nums(g.rows.map(r => r.index));
      const all = nums(g.rows.flatMap(r => RATING_PARAMS.map(p => r.ratings[p.key])));
      const paramMeans = {} as Record<ParamKey, number | null>;
      RATING_PARAMS.forEach(p => {
        const col = nums(g.rows.map(r => r.ratings[p.key]));
        paramMeans[p.key] = col.length ? mean(col) : null;
      });
      const applyAns = g.rows.map(r => r.apply).filter((v): v is 0 | 1 => v !== null);
      return {
        name: g.name,
        n: g.rows.length,
        indexMean: idx.length ? mean(idx) : 0,
        top2: all.length ? (all.filter(v => v >= 4).length / all.length) * 100 : 0,
        paramMeans,
        applyYesPct: applyAns.length ? (applyAns.filter(v => v === 1).length / applyAns.length) * 100 : null,
      };
    })
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

export interface ThemeCount {
  theme: string;
  respondents: number;
  pct: number;
  quotes: string[];
}

/** Keyword-coded themes (a first-pass auto-code — the guide recommends a human second-coder check). */
const THEMES: { theme: string; re: RegExp }[] = [
  { theme: 'Content depth', re: /\b(depth|in-depth|detail|advanced|deeper|content|concept|basic|theory|syllabus)\b/i },
  { theme: 'Speaker / delivery', re: /\b(speaker|resource person|trainer|facilitator|session was|delivery|explain|explanation|presentation|teaching|knowledgeable|engaging)\b/i },
  { theme: 'Activities & case studies', re: /\b(case stud|activit|exercise|hands-on|hands on|practical|example|role.?play|simulation|game|demo)\b/i },
  { theme: 'Duration & timing', re: /\b(duration|time|timing|longer|shorter|schedule|too long|too short|more days|extend|break)\b/i },
  { theme: 'Venue & logistics', re: /\b(venue|room|hall|food|lunch|refreshment|snack|seating|sound|mic|audio|projector|wifi|wi-fi|ac\b|logistics|coordination|organi[sz]ation|registration)\b/i },
  { theme: 'Tools & technology', re: /\b(tool|software|technology|digital|ai\b|excel|app\b|platform|online)\b/i },
  { theme: 'Interaction & networking', re: /\b(interact|discussion|q&a|question|network|peer|group|participat|engage)\b/i },
  { theme: 'Follow-up & resources', re: /\b(follow.?up|material|notes|slides|resource|certificate|recording|handout|further|continue)\b/i },
  { theme: 'Leadership & management', re: /\b(leader|manage|decision|team|strateg|vision|ethic|gita|value)\b/i },
];

export function themeCounts(answers: string[]): ThemeCount[] {
  const nonEmpty = answers.filter(a => a.length > 2 && !/^(n\/?a|none|nil|no|nothing|-+)\.?$/i.test(a));
  const total = nonEmpty.length;
  if (total === 0) return [];
  const out: ThemeCount[] = THEMES.map(({ theme, re }) => {
    const hits = nonEmpty.filter(a => re.test(a));
    return {
      theme,
      respondents: hits.length,
      pct: (hits.length / total) * 100,
      quotes: [...hits].sort((a, b) => b.length - a.length).filter(q => q.length <= 220).slice(0, 2),
    };
  }).filter(t => t.respondents > 0);
  return out.sort((a, b) => b.respondents - a.respondents);
}

export interface Insight {
  tone: 'good' | 'warn' | 'bad' | 'info';
  title: string;
  detail: string;
}

export interface FeedbackAnalysis {
  rows: ResponseRow[];
  n: number;
  params: ParamStats[];
  overall: ParamStats;
  respondentIndex: { mean: number; sd: number; ci: number | null; hist: { bin: string; count: number }[] } | null;
  overallMean: number | null; // mean of the nine parameter means
  dimensions: { key: string; label: string; mean: number | null }[];
  outcomes: { key: string; label: string; short: string; n: number; yes: number; pct: number }[];
  outcomeIndex: number | null;
  fullAchievement: number | null;
  knowledge: { yes: number; n: number; ci: ReturnType<typeof proportionCi> };
  apply: { yes: number; n: number; ci: ReturnType<typeof proportionCi> };
  quality: { straightLined: number; contradictions: number; duplicates: number };
  alpha: ReturnType<typeof cronbachAlpha>;
  regression: ReturnType<typeof driverRegression>;
  designations: SegmentStats[];
  departments: SegmentStats[];
  comments: { key: string; title: string; answered: number; themes: ThemeCount[] }[];
  insights: Insight[];
}

export function analyseFeedback(form: PublicFormItem, subs: FormSubmissionItem[]): FeedbackAnalysis {
  const rows = buildRows(form, subs);
  const n = rows.length;

  const params = RATING_PARAMS.map(p => statsFor(p.key, p.short, nums(rows.map(r => r.ratings[p.key]))));
  const ranked = params.filter(p => p.mean !== null).sort((a, b) => (b.mean as number) - (a.mean as number));
  // Tied means share a rank (=RANK.EQ).
  ranked.forEach(p => { p.rank = ranked.findIndex(q => q.mean === p.mean) + 1; });
  const overall = statsFor('overall', 'Overall rating', nums(rows.map(r => r.overall)));

  const idxVals = nums(rows.map(r => r.index));
  const respondentIndex = idxVals.length
    ? {
        mean: mean(idxVals), sd: sd(idxVals), ci: ciHalfWidth(idxVals),
        hist: Array.from({ length: 8 }, (_, i) => {
          const lo = 1 + i * 0.5;
          const hi = lo + 0.5;
          const last = i === 7;
          return {
            bin: `${lo.toFixed(1)}${last ? '–5' : ''}`,
            count: idxVals.filter(v => v >= lo && (last ? v <= hi : v < hi)).length,
          };
        }),
      }
    : null;

  const paramMeans = params.map(p => p.mean).filter((v): v is number => v !== null);
  const overallMean = paramMeans.length ? mean(paramMeans) : null;

  const pm = (k: string) => params.find(p => p.key === k)?.mean ?? null;
  const dimensions = DIMENSIONS.map(d => {
    const vals = d.items.map(pm).filter((v): v is number => v !== null);
    return { key: d.key, label: d.label, mean: vals.length ? mean(vals) : null };
  });

  const outcomes = OUTCOMES.map((o, i) => {
    const ans = rows.map(r => r.outcomes[i]).filter((v): v is 0 | 1 => v !== null);
    const yes = ans.filter(v => v === 1).length;
    return { key: o.key, label: o.label, short: o.short, n: ans.length, yes, pct: ans.length ? (yes / ans.length) * 100 : 0 };
  });
  const answeredAll = rows.filter(r => r.outcomes.every(v => v !== null));
  const outcomeIndex = answeredAll.length
    ? (answeredAll.reduce((a, r) => a + r.outcomes.reduce<number>((s, v) => s + (v as number), 0), 0) / (5 * answeredAll.length)) * 100
    : null;
  const fullAchievement = answeredAll.length
    ? (answeredAll.filter(r => r.outcomes.every(v => v === 1)).length / answeredAll.length) * 100
    : null;

  const yn = (pick: (r: ResponseRow) => 0 | 1 | null) => {
    const ans = rows.map(pick).filter((v): v is 0 | 1 => v !== null);
    const yes = ans.filter(v => v === 1).length;
    return { yes, n: ans.length, ci: proportionCi(yes, ans.length) };
  };
  const knowledge = yn(r => r.knowledge);
  const apply = yn(r => r.apply);

  const nameCounts = new Map<string, number>();
  rows.forEach(r => {
    const key = r.participant.toLowerCase().replace(/\s+/g, ' ').trim();
    if (key) nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  });
  const quality = {
    straightLined: rows.filter(r => r.straightLined).length,
    contradictions: rows.filter(r => r.contradiction).length,
    duplicates: [...nameCounts.values()].filter(c => c > 1).reduce((a, c) => a + c - 1, 0),
  };

  const alpha = cronbachAlpha(rows);
  const regression = driverRegression(rows);
  const designations = segmentBy(rows, r => r.designation);
  const departments = segmentBy(rows, r => r.department);

  const comments = [
    { key: 'takeaways', title: 'Key takeaways', answers: rows.map(r => r.comments.takeaways) },
    { key: 'valuable', title: 'Most valuable aspect', answers: rows.map(r => r.comments.valuable) },
    { key: 'suggestions', title: 'Suggestions for improvement', answers: rows.map(r => r.comments.suggestions) },
    { key: 'future', title: 'Topics for future sessions', answers: rows.map(r => r.comments.future) },
  ].map(c => ({
    key: c.key,
    title: c.title,
    answered: c.answers.filter(a => a.length > 2).length,
    themes: themeCounts(c.answers),
  }));

  const analysis: FeedbackAnalysis = {
    rows, n, params, overall, respondentIndex, overallMean, dimensions, outcomes, outcomeIndex,
    fullAchievement, knowledge, apply, quality, alpha, regression, designations, departments, comments,
    insights: [],
  };
  analysis.insights = buildInsights(analysis);
  return analysis;
}

/** Section 4 of the guide — patterns on this form and what each lets you infer. */
function buildInsights(a: FeedbackAnalysis): Insight[] {
  const out: Insight[] = [];
  if (a.n === 0) return out;

  if (a.n < 10) {
    out.push({ tone: 'info', title: 'Too few forms for findings', detail: `Only ${a.n} form${a.n === 1 ? '' : 's'} so far — treat everything below as counts and individual comments, not findings. Averages, percentages and tests need at least 10 forms (30+ for confidence intervals, about 100 for regression and group tests).` });
  } else if (a.n < 30) {
    out.push({ tone: 'info', title: 'Indicative results only', detail: `With ${a.n} forms, means, distributions and themes are indicative. Group comparisons and regression need more responses.` });
  } else if (a.n < 100) {
    out.push({ tone: 'info', title: 'Confidence intervals available', detail: `With ${a.n} forms, confidence intervals and correlations are reliable. Comparing small groups, regression and factor analysis wait for about 100 forms.` });
  }

  const ov = a.overall;
  if (ov.mean !== null && ov.n >= 10 && ov.top2 !== null && ov.bottom2 !== null && ov.net !== null) {
    out.push({
      tone: ov.net >= 50 ? 'good' : ov.net >= 0 ? 'info' : 'bad',
      title: `Overall rating ${ov.mean.toFixed(2)}${ov.ci !== null ? ` ± ${ov.ci.toFixed(2)}` : ''}`,
      detail: `${Math.round(ov.top2)}% rated the event 4–5 and ${Math.round(ov.bottom2)}% rated it 1–2 (net ${ov.net > 0 ? '+' : ''}${Math.round(ov.net)}). The interval is the range the true mean of all attendees probably lies in.`,
    });
  }

  const splitParams = a.params.filter(p => p.n >= 10 && (p.sd ?? 0) > 1.1);
  if (splitParams.length) out.push({ tone: 'warn', title: 'Split opinions', detail: `${splitParams.map(p => p.label).join(', ')} ${splitParams.length === 1 ? 'has' : 'have'} a spread (SD) above 1.1 — the audience is divided, with two groups wanting different things. Check the segment table.` });

  const allScores = a.params.reduce((s, p) => s + p.n, 0);
  const fives = a.params.reduce((s, p) => s + p.counts[4], 0);
  if (allScores >= 30 && fives / allScores > 0.6) out.push({ tone: 'info', title: 'Ceiling effect', detail: `${Math.round((fives / allScores) * 100)}% of all scores are 5, so averages cannot separate strong from weak parameters. Rank by the share of 5s and read the comments.` });

  const mm = (k: ParamKey) => a.params.find(p => p.key === k)?.mean ?? null;
  const base = a.overallMean;
  if (base !== null && a.n >= 10) {
    const support = [mm('tools'), mm('organization')].filter((v): v is number => v !== null);
    if (support.length && mean(support) < base - 0.5) out.push({ tone: 'warn', title: 'Logistics / support lag the teaching', detail: 'Tools/technology and organization score well below the other parameters — a venue, equipment or scheduling problem separate from the teaching.' });
    const design = [mm('relevance'), mm('clarity')].filter((v): v is number => v !== null);
    const substance = [mm('content'), mm('practical')].filter((v): v is number => v !== null);
    if (design.length && substance.length && mean(design) - mean(substance) >= 0.4) out.push({ tone: 'warn', title: 'Right topic, thinner substance', detail: 'Relevance and clarity are high but content depth and practical applicability are lower — add depth, cases or exercises.' });
    const delivery = [mm('resource'), mm('interaction')].filter((v): v is number => v !== null);
    const content = mm('content');
    if (delivery.length && content !== null && mean(delivery) - content >= 0.4) out.push({ tone: 'warn', title: 'Good delivery, content may be thin', detail: 'Resource person and interaction score above content depth — consider raising the level of the content and keeping the speaker.' });
  }

  if (a.apply.n >= 10 && ov.top2 !== null && ov.top2 >= 60 && a.apply.ci && a.apply.ci.p < 0.7) out.push({ tone: 'warn', title: 'Enjoyed it, but not usable', detail: `Overall rating is high but only ${Math.round(a.apply.ci.p * 100)}% say they will apply the learning — add applied tasks and follow-up.` });
  if (a.knowledge.n >= 10 && a.knowledge.ci && a.knowledge.ci.p < 0.7) out.push({ tone: 'warn', title: 'Knowledge gain is low', detail: `Only ${Math.round(a.knowledge.ci.p * 100)}% say the event enhanced their knowledge/skills — the level may be too basic or too advanced. Check by designation, then re-pitch.` });

  const weakestOutcome = [...a.outcomes].filter(o => o.n >= 10).sort((x, y) => x.pct - y.pct)[0];
  const strongestOutcome = [...a.outcomes].filter(o => o.n >= 10).sort((x, y) => y.pct - x.pct)[0];
  if (weakestOutcome && strongestOutcome && strongestOutcome.pct - weakestOutcome.pct >= 20) out.push({ tone: 'warn', title: 'One learning outcome lags', detail: `"${weakestOutcome.short}" was ticked by ${Math.round(weakestOutcome.pct)}% against ${Math.round(strongestOutcome.pct)}% for "${strongestOutcome.short}" — that objective was not delivered as well; rework that part.` });

  if (a.regression) {
    const top = [...a.regression.betas].sort((x, y) => y.beta - x.beta)[0];
    const label = RATING_PARAMS.find(p => p.key === top.key)?.short ?? top.key;
    out.push({ tone: 'info', title: `"${label}" moves the overall rating most`, detail: `Largest standardised coefficient (β ${top.beta.toFixed(2)}; the eight ratings explain ${Math.round(a.regression.r2 * 100)}% of the overall rating). Correlation is not cause — put improvement effort there first, but don't assume it will raise satisfaction.` });
  }

  if (a.alpha && a.alpha.alpha < 0.7) out.push({ tone: 'warn', title: 'Items do not hang together', detail: `Cronbach's alpha is ${a.alpha.alpha.toFixed(2)} (below 0.70), so don't merge the nine ratings into a single index — read them separately.` });

  if (a.quality.straightLined > 0 || a.quality.contradictions > 0 || a.quality.duplicates > 0) {
    const bits = [
      a.quality.straightLined ? `${a.quality.straightLined} straight-lined form${a.quality.straightLined === 1 ? '' : 's'} (all nine ratings identical)` : '',
      a.quality.contradictions ? `${a.quality.contradictions} form${a.quality.contradictions === 1 ? '' : 's'} where Overall satisfaction and Overall rating differ by 2+ points` : '',
      a.quality.duplicates ? `${a.quality.duplicates} possible duplicate${a.quality.duplicates === 1 ? '' : 's'} (same participant name)` : '',
    ].filter(Boolean);
    out.push({ tone: 'warn', title: 'Data-quality flags', detail: `${bits.join('; ')}. They are kept in the figures above — review them in the table.` });
  }
  return out;
}
