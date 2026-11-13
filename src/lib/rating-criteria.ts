/**
 * Category-specific rating rubrics. Each task category is scored against its
 * own set of 5 criteria (all on the existing 1-5 scale) instead of the single
 * generic 4-criteria form used previously.
 */
export type RatingCriteriaSet = 'general' | 'design' | 'reportWriting';

export interface RatingCriterion {
  key: string;
  label: string;
  description: string;
}

export const RATING_CRITERIA: Record<RatingCriteriaSet, RatingCriterion[]> = {
  general: [
    { key: 'accuracy', label: 'Accuracy', description: 'Correctness of information provided' },
    { key: 'timeliness', label: 'Timeliness', description: 'Adherence to set deadlines' },
    { key: 'collaboration', label: 'Collaboration', description: 'Effective teamwork and communication with others' },
    { key: 'reliability', label: 'Reliability', description: 'Dependability in completing assigned duties' },
    { key: 'communication', label: 'Communication', description: 'Clarity and effectiveness in transmitting information' },
  ],
  design: [
    { key: 'originality', label: 'Originality', description: 'Creativity and uniqueness of the design' },
    { key: 'technicalExecution', label: 'Technical Execution and Polish', description: 'Professionalism, cleanliness, and formatting of the file' },
    { key: 'functionality', label: 'Functionality', description: 'Effectiveness of the design in serving its purpose across media' },
    { key: 'presentation', label: 'Presentation', description: 'Overall visual appeal and engagement' },
    { key: 'attentionToDetail', label: 'Attention to Detail', description: 'Precision in design elements' },
  ],
  reportWriting: [
    { key: 'clarity', label: 'Clarity', description: 'Ease of understanding the written content' },
    { key: 'flowStructure', label: 'Flow / Structure of the Event Report', description: 'Logical flow and organization of the report from start to finish' },
    { key: 'timeliness', label: 'Timeliness of Submission', description: 'Report submitted within the expected deadline after the event' },
    { key: 'errors', label: 'Number of Errors', description: 'Fewer spelling, grammar, and factual errors scores higher' },
    { key: 'photos', label: 'Geotagged Photos & Other Pictures Attached', description: 'Geotagged photos and other supporting pictures are attached and relevant' },
  ],
};

export function criteriaSetForTaskCategory(taskCategory: string | undefined): RatingCriteriaSet {
  if (taskCategory === 'design') return 'design';
  if (taskCategory === 'reportWriting') return 'reportWriting';
  return 'general';
}

export function averageScore(scores: Record<string, number>): number {
  const values = Object.values(scores);
  if (values.length === 0) return 0;
  return parseFloat((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(1));
}

/**
 * Bayesian-weighted ("confidence-adjusted") rating score — the same idea
 * IMDb uses for its Top 250: a handful of ratings shouldn't outrank a track
 * record. A person's raw average is pulled toward the org-wide baseline in
 * proportion to how few ratings they've received; it converges to their
 * real average once they've accumulated `confidenceThreshold` ratings.
 *
 *   weighted = (n / (n + k)) * rawAverage + (k / (n + k)) * baseline
 *
 * At n=k it's a 50/50 blend; as n grows past k it approaches rawAverage.
 * `confidenceThreshold` (k) defaults to 5. Someone with zero ratings hasn't
 * contributed anything to weight in the first place, so n=0 is 0, not the
 * baseline — that would credit them for an org-wide average they never
 * actually earned.
 */
export function computeWeightedRatingScore(
  ratingCount: number,
  rawAverage: number,
  baseline: number,
  confidenceThreshold: number = 5
): number {
  if (ratingCount <= 0) return 0;
  const weight = ratingCount / (ratingCount + confidenceThreshold);
  const weighted = weight * rawAverage + (1 - weight) * baseline;
  return parseFloat(weighted.toFixed(1));
}

const RECENCY_HALF_LIFE_DAYS = 90; // a rating "loses half its weight" after ~3 months
const RECENCY_LAMBDA = Math.log(2) / RECENCY_HALF_LIFE_DAYS;
const CONSISTENCY_UNIT_DAYS = 7; // consistency is measured in calendar weeks
const CONSISTENCY_FLOOR = 0.8; // a totally inconsistent contributor loses at most 20%, never zeroed out

export interface DatedScore {
  score: number;
  date: string; // ISO date string (RatingItem.createdAt)
}

/**
 * Recency-weighted average: each individual rating's influence decays
 * exponentially with age (half-life ~90 days), so a student's displayed
 * average reflects how they're performing *now*, not a high mark scored
 * a year ago that they've since coasted on.
 */
export function computeRecencyWeightedAverage(entries: DatedScore[], now: Date = new Date()): number {
  if (entries.length === 0) return 0;
  let weightedSum = 0;
  let weightTotal = 0;
  entries.forEach(({ score, date }) => {
    const ageDays = Math.max(0, (now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
    const weight = Math.exp(-RECENCY_LAMBDA * ageDays);
    weightedSum += weight * score;
    weightTotal += weight;
  });
  if (weightTotal === 0) return 0;
  return parseFloat((weightedSum / weightTotal).toFixed(2));
}

/**
 * Consistency ratio: how much of the time BETWEEN A STUDENT'S FIRST RATING
 * AND TODAY has actually had contribution in it, measured in calendar weeks.
 * Anchoring the denominator to "today" (not to their last rating) means a
 * student who was active early on and then went quiet keeps losing ground
 * as time passes, even with no new ratings — consistency is relative to the
 * present, not just to their own history.
 *
 * activeWeeks = number of distinct weeks (since their first rating) that
 *   contain at least one rating.
 * expectedWeeks = number of weeks elapsed from their first rating to now.
 *
 * Returns a ratio in [0, 1]: 1.0 = rated in every single week since they
 * started; closer to 0 = a single burst of activity long ago, then nothing.
 */
export function computeConsistencyRatio(dates: string[], now: Date = new Date()): number {
  if (dates.length === 0) return 0;
  const sorted = [...dates].map(d => new Date(d).getTime()).sort((a, b) => a - b);
  const firstMs = sorted[0];
  const unitMs = CONSISTENCY_UNIT_DAYS * 24 * 60 * 60 * 1000;

  const expectedWeeks = Math.max(1, Math.ceil((now.getTime() - firstMs) / unitMs));
  const activeWeeks = new Set(sorted.map(t => Math.floor((t - firstMs) / unitMs))).size;

  return Math.min(1, activeWeeks / expectedWeeks);
}

export interface DatedRatingRow extends DatedScore {
  /** Groups independent reviewer submissions on the same deliverable — see groupRatingsByTask. */
  taskKey: string;
}

/**
 * The 4-way Multi-Reviewer rubric (Super User / Centre Head / Advisor / GG
 * Campus Events Head, see resolveRatingReviewerRole in permissions.ts) has
 * each reviewer submit their OWN separate rating row for the same task —
 * so one task reviewed by 4 people produces 4 rows, while an identical task
 * reviewed by 1 person produces 1 row. Feeding raw rows into the volume-
 * and-consistency scoring above would reward reviewer redundancy, not task
 * volume: two students who each did 10 tasks would score differently
 * purely because one of them happened to get multi-reviewed more often.
 *
 * This collapses every row for the same (task, target) pair into a single
 * data point — its score is the average across reviewers, its date is the
 * latest of theirs — so `n` always reflects DISTINCT EVALUATED TASKS,
 * consistent across events regardless of how many reviewers each one had.
 */
export function groupRatingsByTask(rows: DatedRatingRow[]): DatedScore[] {
  const byTask = new Map<string, DatedRatingRow[]>();
  rows.forEach(row => {
    const group = byTask.get(row.taskKey);
    if (group) group.push(row); else byTask.set(row.taskKey, [row]);
  });
  return Array.from(byTask.values()).map(group => ({
    score: group.reduce((sum, r) => sum + r.score, 0) / group.length,
    date: group.reduce((latest, r) => (r.date > latest ? r.date : latest), group[0].date),
  }));
}

const SCORING_CYCLE_START_MONTH = 8; // August, 1-indexed
const SCORING_CYCLE_START_DAY = 1;

/**
 * 'YYYY-MM-DD' for the most recent 1 August on or before `now` — the start
 * of the current annual scoring cycle. Everything the scoring functions
 * above compute (raw/recency average, rating count, consistency) should be
 * fed only ratings on or after this date, so every student's volume,
 * recency, and consistency history resets to a clean slate each 1 August
 * rather than accumulating across academic years forever.
 */
export function currentScoringCycleStart(now: Date = new Date()): string {
  const year = now.getFullYear();
  const isOnOrAfterCycleStart =
    now.getMonth() + 1 > SCORING_CYCLE_START_MONTH ||
    (now.getMonth() + 1 === SCORING_CYCLE_START_MONTH && now.getDate() >= SCORING_CYCLE_START_DAY);
  const cycleYear = isOnOrAfterCycleStart ? year : year - 1;
  return `${cycleYear}-08-01`;
}

/** Whether a 'YYYY-MM-DD' (or full ISO) date string falls in the current scoring cycle (see currentScoringCycleStart). */
export function isWithinCurrentScoringCycle(dateStr: string, now: Date = new Date()): boolean {
  return dateStr.slice(0, 10) >= currentScoringCycleStart(now);
}

export interface FinalStudentScoreBreakdown {
  finalScore: number;
  rawAverage: number;
  recencyAverage: number;
  confidenceWeighted: number;
  consistencyRatio: number;
  consistencyMultiplier: number;
  ratingCount: number;
}

/**
 * Combines all three signals into the score the Leaderboard ranks and
 * displays by:
 *
 *   1. Recency-weighted average  — recent performance counts more than old.
 *   2. Confidence weighting (n)  — few ratings get pulled toward the
 *      org-wide baseline; this is also where volume ("amount of tasks")
 *      does the heavy lifting — the more a student has been rated, the
 *      closer their score sits to their real (recency-weighted) average.
 *   3. Consistency multiplier    — steady week-over-week contribution
 *      relative to TODAY is rewarded; a single old burst is not, even if
 *      the raw volume was high. Ranges 0.8–1.0, so it fine-tunes rather
 *      than overrides the volume-driven confidence weighting above.
 *
 * Net effect: a student who does many tasks AND stays consistently active
 * scores highest; high volume with no consistency, or high consistency
 * with barely any volume, both land below that — exactly the "scales up
 * with the amount of tasks, but only if it's kept up" behavior requested.
 */
export function computeFinalStudentScore(
  ratings: DatedScore[],
  baseline: number,
  now: Date = new Date(),
  confidenceThreshold: number = 5
): FinalStudentScoreBreakdown {
  const ratingCount = ratings.length;
  const rawAverage = ratingCount > 0
    ? parseFloat((ratings.reduce((sum, r) => sum + r.score, 0) / ratingCount).toFixed(2))
    : 0;

  if (ratingCount === 0) {
    return {
      finalScore: 0,
      rawAverage: 0,
      recencyAverage: 0,
      confidenceWeighted: 0,
      consistencyRatio: 0,
      consistencyMultiplier: CONSISTENCY_FLOOR,
      ratingCount: 0,
    };
  }

  const recencyAverage = computeRecencyWeightedAverage(ratings, now);
  const confidenceWeighted = computeWeightedRatingScore(ratingCount, recencyAverage, baseline, confidenceThreshold);
  const consistencyRatio = computeConsistencyRatio(ratings.map(r => r.date), now);
  const consistencyMultiplier = CONSISTENCY_FLOOR + (1 - CONSISTENCY_FLOOR) * consistencyRatio;
  const finalScore = parseFloat((confidenceWeighted * consistencyMultiplier).toFixed(1));

  return {
    finalScore,
    rawAverage,
    recencyAverage,
    confidenceWeighted,
    consistencyRatio: parseFloat(consistencyRatio.toFixed(2)),
    consistencyMultiplier: parseFloat(consistencyMultiplier.toFixed(2)),
    ratingCount,
  };
}

/**
 * Projects the new per-criterion scores onto the legacy fixed
 * quality/timeliness/initiative/collaboration fields so existing analytics
 * (report-generator.ts, reports/page.tsx, student-profile-modal.tsx) that
 * were built around exactly those 4 fields keep working without a rewrite.
 * The mapping is an approximation, not a semantic equivalence — the real
 * per-criterion breakdown lives in `scores`/`criteriaSet`.
 */
export function projectLegacyRatingFields(
  criteriaSet: RatingCriteriaSet,
  scores: Record<string, number>
): { quality: number; timeliness: number; initiative: number; collaboration: number } {
  const overall = averageScore(scores);
  if (criteriaSet === 'general') {
    return {
      quality: scores.accuracy ?? overall,
      timeliness: scores.timeliness ?? overall,
      initiative: scores.reliability ?? overall,
      collaboration: scores.collaboration ?? overall,
    };
  }
  if (criteriaSet === 'design') {
    return {
      quality: scores.technicalExecution ?? overall,
      timeliness: overall,
      initiative: scores.originality ?? overall,
      collaboration: scores.presentation ?? overall,
    };
  }
  return {
    quality: scores.errors ?? overall,
    timeliness: scores.timeliness ?? overall,
    initiative: scores.photos ?? overall,
    collaboration: scores.flowStructure ?? overall,
  };
}
