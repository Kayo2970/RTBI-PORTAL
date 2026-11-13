import { EventReportItem } from './local-data';

export interface ScoredReport {
  score: number;
  submittedAt: string;
}

/**
 * A submitter's report score is the plain average of their scored reports
 * (100% of the score). Returns null when there is nothing scored yet.
 */
export function computeFinalReportScore(reports: ScoredReport[]): number | null {
  if (reports.length === 0) return null;
  return parseFloat((reports.reduce((sum, r) => sum + r.score, 0) / reports.length).toFixed(2));
}

export interface SubmitterReportScore {
  submittedBy: string;
  reportCount: number;
  lastSubmittedAt: string;
  finalScore: number;
}

/**
 * Groups scored event reports by submitter and computes each one's average
 * Final Score, for the Ratings page's report-scoring leaderboard.
 * Professors/Faculty are strictly excluded per core rating policy.
 */
export function groupScoredReportsBySubmitter(reports: EventReportItem[], members?: any[]): SubmitterReportScore[] {
  const bySubmitter = new Map<string, EventReportItem[]>();

  reports
    .filter((r): r is EventReportItem & { reportScore: number } => typeof r.reportScore === 'number')
    .forEach(r => {
      const key = r.submittedBy || 'Unknown';
      if (members && members.length > 0) {
        const m = members.find((mb: any) =>
          (r.submittedByEmail && mb.email && mb.email.toLowerCase() === r.submittedByEmail.toLowerCase()) ||
          (mb.name && mb.name.toLowerCase() === key.toLowerCase())
        );
        if (m && (m.division === 'Faculty' || /prof\.|professor|faculty/i.test(m.role || ''))) {
          return;
        }
      }
      if (/prof\.|professor|faculty/i.test(key)) return;

      if (!bySubmitter.has(key)) bySubmitter.set(key, []);
      bySubmitter.get(key)!.push(r);
    });

  const results: SubmitterReportScore[] = [];
  bySubmitter.forEach((submitterReports, submittedBy) => {
    const scored: ScoredReport[] = submitterReports.map(r => ({ score: r.reportScore as number, submittedAt: r.submittedAt }));
    const finalScore = computeFinalReportScore(scored);
    if (finalScore === null) return;
    const lastSubmittedAt = submitterReports
      .map(r => r.submittedAt)
      .sort()
      .slice(-1)[0];
    results.push({ submittedBy, reportCount: submitterReports.length, lastSubmittedAt, finalScore });
  });

  return results.sort((a, b) => b.finalScore - a.finalScore);
}
