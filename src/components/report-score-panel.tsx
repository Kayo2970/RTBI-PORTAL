'use client';

import React, { useState } from 'react';
import { RATING_CRITERIA, averageScore } from '@/lib/rating-criteria';
import { scoreEventReport, EventReportItem } from '@/lib/local-data';

interface ReportScorePanelProps {
  report: EventReportItem;
  actorName: string;
  onSaved: (updated: EventReportItem) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

/**
 * Report Writing rubric form (Clarity, Flow/Structure, Timeliness of Submission,
 * Number of Errors, Geotagged Photos & Pictures). Shared by the Event Reports page and the Ratings page so a score
 * entered in either place lands on the same report record and feeds the same
 * Final Score leaderboard.
 */
export function ReportScorePanel({ report, actorName, onSaved, onCancel, onError }: ReportScorePanelProps) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    RATING_CRITERIA.reportWriting.forEach(c => { initial[c.key] = report.reportScores?.[c.key] ?? 5; });
    return initial;
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await scoreEventReport(report.id, values, actorName);
      if (!result) { onError('Failed to save the report score.'); return; }
      onSaved(result);
    } catch (err: any) {
      onError(err?.message || 'Failed to save the report score.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2.5 p-3 bg-accent/5 border border-accent/20 rounded-xl">
      {RATING_CRITERIA.reportWriting.map(criterion => (
        <div className="space-y-1" key={criterion.key} title={criterion.description}>
          <div className="flex justify-between items-center text-[11px]">
            <span className="font-semibold text-theme-text-primary">{criterion.label}</span>
            <span className="font-bold text-accent">{(values[criterion.key] ?? 5).toFixed(1)} / 5</span>
          </div>
          <input
            type="range" min="1" max="5" step="0.5"
            value={values[criterion.key] ?? 5}
            onChange={(e) => setValues(v => ({ ...v, [criterion.key]: parseFloat(e.target.value) }))}
            className="w-full accent-accent h-1.5 bg-theme-border/40 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      ))}
      <p className="text-[11px] font-semibold text-theme-text-secondary">
        Overall: <span className="text-theme-text-primary">{averageScore(values).toFixed(1)} / 5.0</span>
      </p>
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-1.5 bg-accent hover:bg-primary-light text-white text-[11px] font-bold rounded-lg transition-all cursor-pointer disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Score'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 bg-theme-border/20 hover:bg-theme-border/30 text-theme-text-secondary text-[11px] font-bold rounded-lg transition-all cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  );
}
