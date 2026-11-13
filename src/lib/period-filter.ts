/**
 * Shared month / custom-date-range filtering — replaces the old fixed
 * quarter dropdowns (Ratings, Reports) with something people actually
 * reach for: a specific calendar month, or an arbitrary "from -> to" range.
 */

export type PeriodFilterValue =
  | { mode: 'ALL' }
  | { mode: 'MONTH'; month: string } // 'YYYY-MM'
  | { mode: 'CUSTOM'; from: string; to: string }; // 'YYYY-MM-DD' each, either may be empty (open-ended)

/** Distinct 'YYYY-MM' months present across the given ISO/date-only strings, newest first. */
export function extractAvailableMonths(dates: string[]): string[] {
  const months = new Set<string>();
  for (const d of dates) {
    if (!d) continue;
    months.add(d.slice(0, 7));
  }
  return Array.from(months).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/** Human label for a 'YYYY-MM' string, e.g. "August 2026". */
export function monthLabel(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Short label for the current filter selection, for display / PDF metadata. */
export function periodLabel(period: PeriodFilterValue): string {
  if (period.mode === 'ALL') return 'All Time (Cumulative)';
  if (period.mode === 'MONTH') return monthLabel(period.month);
  const from = period.from || '(start)';
  const to = period.to || '(today)';
  return `${from} to ${to}`;
}

/** Whether a 'YYYY-MM-DD' (or full ISO) date string falls inside the selected period. */
export function isWithinPeriod(dateStr: string | undefined, period: PeriodFilterValue): boolean {
  if (period.mode === 'ALL') return true;
  if (!dateStr) return false;
  const datePart = dateStr.slice(0, 10);

  if (period.mode === 'MONTH') {
    return datePart.slice(0, 7) === period.month;
  }

  // CUSTOM
  if (period.from && datePart < period.from) return false;
  if (period.to && datePart > period.to) return false;
  return true;
}
