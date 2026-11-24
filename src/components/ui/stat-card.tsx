import React from 'react';

/** Single headline number with label; value is the largest thing on the card. */
export function StatCard({ label, value, hint, icon, tone = 'neutral' }: {
  label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode; tone?: 'neutral' | 'danger' | 'warning' | 'success';
}) {
  const ring = { neutral: '', danger: 'border-l-4 border-l-rose-600', warning: 'border-l-4 border-l-amber-600', success: 'border-l-4 border-l-emerald-600' }[tone];
  return (
    <div className={`glass-panel rounded-2xl p-4 ${ring}`}>
      <div className="flex items-center justify-between gap-2 text-sm font-semibold text-theme-text-secondary">
        <span>{label}</span>{icon}
      </div>
      <div className="text-3xl font-bold text-theme-text-primary mt-1">{value}</div>
      {hint && <p className="text-sm text-theme-text-secondary mt-1">{hint}</p>}
    </div>
  );
}
