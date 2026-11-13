/**
 * Final performance score for a student: simply the average of their
 * evaluation scores (0-5). It is 100% of the rating.
 */
export function computeFinalScore(avgScore: number, taskCount: number): number {
  if (taskCount <= 0) return 0;
  return parseFloat(avgScore.toFixed(2));
}

export interface StudentFinalScore {
  name: string;
  taskCount: number;
  eventCount: number;
  avgScore: number;
  finalScore: number;
}

/**
 * The final score is the plain average of all of a student's evaluation
 * scores, taken as-is (not averaged per event first).
 */
export function buildStudentFinalScores(
  items: { targetName: string; overallScore: number; eventName?: string }[],
  /** Students with no rating at all: listed with a final score of 0 instead of being left out. */
  unratedNames: string[] = []
): StudentFinalScore[] {
  const byStudent = new Map<string, { scores: number[]; events: Set<string> }>();
  items.forEach(r => {
    const entry = byStudent.get(r.targetName) ?? { scores: [], events: new Set<string>() };
    entry.scores.push(r.overallScore);
    entry.events.add(r.eventName || '__standalone__');
    byStudent.set(r.targetName, entry);
  });
  return Array.from(byStudent.entries())
    .map(([name, { scores, events }]) => {
      const taskCount = scores.length;
      const avgScore = parseFloat((scores.reduce((a, b) => a + b, 0) / taskCount).toFixed(2));
      return {
        name,
        taskCount,
        eventCount: events.size,
        avgScore,
        finalScore: computeFinalScore(avgScore, taskCount),
      };
    })
    .concat(
      unratedNames
        .filter(n => !byStudent.has(n))
        .map(name => ({ name, taskCount: 0, eventCount: 0, avgScore: 0, finalScore: 0 }))
    )
    .sort((a, b) => b.finalScore - a.finalScore || a.name.localeCompare(b.name));
}
