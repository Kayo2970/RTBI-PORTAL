'use client';

import React, { useId } from 'react';

export const inputClass =
  'w-full min-h-11 rounded-xl border border-theme-border bg-theme-card px-3.5 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary/80 disabled:opacity-60 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-600';

export interface FieldControlProps { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean }

/** Label + control + hint + inline error, wired with ids so screen readers announce all of it. */
export function FormField({ label, hint, error, required, className = '', children }: {
  label: string; hint?: string; error?: string; required?: boolean; className?: string;
  children: (p: FieldControlProps) => React.ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="block text-sm font-semibold text-theme-text-primary">
        {label}
        {required && <span className="text-rose-600 dark:text-rose-300 ml-1" aria-hidden="true">*</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, 'aria-required': required || undefined })}
      {hint && <p id={hintId} className="text-sm text-theme-text-secondary">{hint}</p>}
      {error && <p id={errId} role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}
