'use client';

import React, { useEffect, useId, useState } from 'react';
import { readFileAsDataUrl } from '@/lib/incubation/client';
import type { FieldDef } from '@/lib/incubation/kinds';
import { Dialog } from '@/components/ui/dialog';
import { Badge as KitBadge, type BadgeTone } from '@/components/ui/badge';
import { PageHeader as KitPageHeader } from '@/components/ui/page-header';
import { inputClass } from '@/components/ui/form-field';

/* Thin layer over the shared UI kit so every incubation page looks and behaves like the rest of the portal. */

export const inputCls = inputClass;
export const btnPrimary = 'inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-xl bg-accent text-white text-sm font-bold hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed';
export const btnGhost = 'inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl border border-theme-border text-theme-text-primary text-sm font-semibold hover:bg-theme-border/20 disabled:opacity-50 disabled:cursor-not-allowed';

export function useCurrentUser() {
  const [user, setUser] = useState<any>(null);
  useEffect(() => { try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } catch { /* ignore */ } }, []);
  return user;
}
export const isManagerUi = (u: any) => !!u && typeof u.tier === 'number' && u.tier <= 2;
export const isStaffUi = (u: any) => !!u && typeof u.tier === 'number' && u.tier <= 3;

export function PageHeader({ icon, title, subtitle, actions }: { icon?: React.ReactNode; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return <KitPageHeader icon={icon} title={title} description={subtitle} actions={actions} />;
}

export function Panel({ title, hint, children, actions }: { title?: string; hint?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="glass-panel rounded-2xl p-5 space-y-3">
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3">
          <div>{title && <h2 className="font-bold text-base text-theme-text-primary">{title}</h2>}{hint && <p className="text-sm text-theme-text-secondary mt-0.5">{hint}</p>}</div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Accessible modal (focus trap, Esc, labelled). Kept as a drop-in for the old `Modal`. */
export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  return <Dialog open onClose={onClose} title={title} size={wide ? 'lg' : 'md'} footer={footer}>{children}</Dialog>;
}

/** Renders one registry field with a real label/hint/error association. `startups` / `members` feed the two reference selects. */
export function FieldInput({ f, value, onChange, startups, members, records, disabled, error }: {
  f: FieldDef; value: any; onChange: (v: any) => void;
  startups: { id: string; name: string }[]; members: { id: string; name: string }[]; records?: Record<string, { id: string; label: string }[]>; disabled?: boolean; error?: string;
}) {
  const id = useId();
  const hintId = f.hint ? `${id}-h` : undefined;
  const errId = error ? `${id}-e` : undefined;
  const aria = { id, disabled, 'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined, 'aria-invalid': error ? true : undefined, 'aria-required': f.required || undefined, className: inputCls } as const;
  const wide = f.type === 'textarea' || f.type === 'file' || f.type === 'checkbox';
  const wrap = (control: React.ReactNode) => (
    <div className={`space-y-1.5 ${wide ? 'md:col-span-2' : ''}`}>
      <label htmlFor={id} className="block text-sm font-semibold text-theme-text-primary">
        {f.label}{f.managerOnly ? ' (manager)' : ''}
        {f.required && <><span className="text-rose-700 dark:text-rose-300 ml-1" aria-hidden="true">*</span><span className="sr-only"> (required)</span></>}
      </label>
      {control}
      {f.hint && <p id={hintId} className="text-sm text-theme-text-secondary">{f.hint}</p>}
      {error && <p id={errId} role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
  switch (f.type) {
    case 'textarea': return wrap(<textarea rows={3} {...aria} value={value ?? ''} onChange={e => onChange(e.target.value)} />);
    case 'select': return wrap(<select {...aria} value={value ?? ''} onChange={e => onChange(e.target.value)}><option value="">—</option>{f.options?.map(o => <option key={o}>{o}</option>)}</select>);
    case 'number': return wrap(<input type="number" min={f.min} max={f.max} {...aria} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />);
    case 'date': return wrap(<input type="date" {...aria} value={value ?? ''} onChange={e => onChange(e.target.value || undefined)} />);
    case 'checkbox': return (
      <label className="md:col-span-2 flex items-center gap-3 min-h-11 px-3 rounded-xl border border-theme-border text-sm font-medium cursor-pointer hover:bg-theme-border/10">
        <input type="checkbox" className="h-5 w-5 accent-[var(--color-primary)]" disabled={disabled} checked={!!value} onChange={e => onChange(e.target.checked)} />
        <span>{f.label}{f.managerOnly ? ' (manager)' : ''}</span>
      </label>
    );
    case 'startup': return wrap(<select {...aria} value={value ?? ''} onChange={e => onChange(e.target.value || undefined)}><option value="">—</option>{startups.map(s => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}</select>);
    case 'member': return wrap(<select {...aria} value={value ?? ''} onChange={e => onChange(e.target.value || undefined)}><option value="">—</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>);
    case 'record': return wrap(<select {...aria} value={value ?? ''} onChange={e => onChange(e.target.value || undefined)}><option value="">—</option>{(records?.[f.refKind || ''] || []).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>);
    case 'file': return wrap(
      <>
        {value?.name && !value?.dataUrl && <p className="text-sm text-theme-text-secondary">Current file: {value.name}</p>}
        <input type="file" {...aria} onChange={async e => { const file = e.target.files?.[0]; if (file) onChange({ name: file.name, type: file.type, dataUrl: await readFileAsDataUrl(file) }); }} />
      </>);
    default: return wrap(<input {...aria} value={value ?? ''} onChange={e => onChange(e.target.value)} />);
  }
}

/** RAG status classes (light + dark, AA contrast). */
export const ragClass: Record<string, string> = {
  Green: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-400/40',
  Amber: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-400/40',
  Red: 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-500/20 dark:text-rose-200 dark:border-rose-400/40',
};

const LEGACY_TONE: Record<string, BadgeTone> = { default: 'neutral', green: 'success', amber: 'warning', red: 'danger', blue: 'brand' };
export function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'green' | 'amber' | 'red' | 'blue' }) {
  return <KitBadge tone={LEGACY_TONE[tone]}>{children}</KitBadge>;
}
