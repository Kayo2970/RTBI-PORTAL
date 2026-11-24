import React from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-white/10 dark:text-slate-100 dark:border-white/25',
  success: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-400/40',
  warning: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-400/40',
  danger: 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-500/20 dark:text-rose-200 dark:border-rose-400/40',
  info: 'bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-500/20 dark:text-sky-200 dark:border-sky-400/40',
  brand: 'bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-500/25 dark:text-violet-100 dark:border-violet-300/40',
};

/** Status pill. Always carries a text label (never colour-only). */
export function Badge({ children, tone = 'neutral', className = '' }: { children: React.ReactNode; tone?: BadgeTone; className?: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONES[tone]} ${className}`}>{children}</span>;
}

/** Maps common status words to a tone so every module colours status the same way. */
export function statusTone(status: string | undefined | null): BadgeTone {
  const s = (status || '').toLowerCase();
  if (/(approved|active|complete|completed|paid|green|graduated|selected|verified|done|met|accepted)/.test(s)) return 'success';
  if (/(pending|proposed|draft|amber|review|progress|scheduled|submitted|provisional|open)/.test(s)) return 'warning';
  if (/(rejected|overdue|red|terminated|failed|exit|closed|declined|breach|incident)/.test(s)) return 'danger';
  if (/(info|new|invited|shortlisted)/.test(s)) return 'info';
  return 'neutral';
}
