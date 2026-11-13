'use client';

import { PeriodFilterValue, monthLabel } from '@/lib/period-filter';

interface PeriodFilterProps {
  value: PeriodFilterValue;
  onChange: (value: PeriodFilterValue) => void;
  /** Distinct 'YYYY-MM' months to offer, newest first — see extractAvailableMonths(). */
  availableMonths: string[];
  className?: string;
}

/** Month picker + custom date range control — the shared replacement for the old fixed-quarter dropdowns. */
export function PeriodFilter({ value, onChange, availableMonths, className }: PeriodFilterProps) {
  const selectValue = value.mode === 'MONTH' ? value.month : value.mode;

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className || ''}`}>
      <select
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'ALL') onChange({ mode: 'ALL' });
          else if (v === 'CUSTOM') onChange({ mode: 'CUSTOM', from: '', to: '' });
          else onChange({ mode: 'MONTH', month: v });
        }}
        className="px-3 py-2 bg-theme-background/30 border border-theme-border/40 rounded-xl text-xs text-theme-text-primary focus:outline-none focus:border-accent"
      >
        <option value="ALL">All Time</option>
        {availableMonths.map(m => (
          <option key={m} value={m}>{monthLabel(m)}</option>
        ))}
        <option value="CUSTOM">Custom Date Range&hellip;</option>
      </select>

      {value.mode === 'CUSTOM' && (
        <>
          <input
            type="date"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            className="px-3 py-2 bg-theme-background/30 border border-theme-border/40 rounded-xl text-xs text-theme-text-primary focus:outline-none focus:border-accent"
          />
          <span className="text-[11px] text-theme-text-secondary">to</span>
          <input
            type="date"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className="px-3 py-2 bg-theme-background/30 border border-theme-border/40 rounded-xl text-xs text-theme-text-primary focus:outline-none focus:border-accent"
          />
        </>
      )}
    </div>
  );
}
