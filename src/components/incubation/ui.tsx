'use client';

import React, { useEffect, useState } from 'react';
import { readFileAsDataUrl } from '@/lib/incubation/client';
import type { FieldDef } from '@/lib/incubation/kinds';

export const inputCls = 'w-full bg-theme-background/40 border border-theme-border/40 rounded-xl px-3 py-2 text-xs';
export const btnPrimary = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-50';
export const btnGhost = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-theme-border/40 text-xs font-semibold hover:bg-theme-background/40 disabled:opacity-50';

export function useCurrentUser() {
  const [user, setUser] = useState<any>(null);
  useEffect(() => { try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } catch { /* ignore */ } }, []);
  return user;
}
export const isManagerUi = (u: any) => !!u && typeof u.tier === 'number' && u.tier <= 2;
export const isStaffUi = (u: any) => !!u && typeof u.tier === 'number' && u.tier <= 3;

export function PageHeader({ icon, title, subtitle, actions }: { icon?: React.ReactNode; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">{icon} {title}</h1>
        {subtitle && <p className="text-xs text-theme-text-secondary max-w-3xl">{subtitle}</p>}
      </div>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}

export function Panel({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="glass-panel rounded-2xl p-5 space-y-3">
      {title && <div><h2 className="font-bold text-sm">{title}</h2>{hint && <p className="text-xs text-theme-text-secondary">{hint}</p>}</div>}
      {children}
    </section>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`glass-panel rounded-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} max-h-[90vh] overflow-y-auto p-6 space-y-4`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="font-bold text-sm">{title}</h2><button onClick={onClose} aria-label="Close" className="text-lg leading-none">×</button></div>
        {children}
      </div>
    </div>
  );
}

/** Renders one registry field. `startups` / `members` feed the two reference selects. */
export function FieldInput({ f, value, onChange, startups, members, records, disabled }: {
  f: FieldDef; value: any; onChange: (v: any) => void;
  startups: { id: string; name: string }[]; members: { id: string; name: string }[]; records?: Record<string, { id: string; label: string }[]>; disabled?: boolean;
}) {
  const label = <span className="block mb-1">{f.label}{f.required ? ' *' : ''}</span>;
  const hint = f.hint ? <span className="block text-[11px] text-theme-text-secondary mt-0.5">{f.hint}</span> : null;
  const common = { disabled, className: inputCls };
  switch (f.type) {
    case 'textarea': return <label className="text-xs block md:col-span-2">{label}<textarea rows={3} {...common} value={value ?? ''} onChange={e => onChange(e.target.value)} />{hint}</label>;
    case 'select': return <label className="text-xs block">{label}<select {...common} value={value ?? ''} onChange={e => onChange(e.target.value)}><option value="">—</option>{f.options?.map(o => <option key={o}>{o}</option>)}</select>{hint}</label>;
    case 'number': return <label className="text-xs block">{label}<input type="number" min={f.min} max={f.max} {...common} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />{hint}</label>;
    case 'date': return <label className="text-xs block">{label}<input type="date" {...common} value={value ?? ''} onChange={e => onChange(e.target.value || undefined)} />{hint}</label>;
    case 'checkbox': return <label className="text-xs flex items-center gap-2 md:col-span-2"><input type="checkbox" disabled={disabled} checked={!!value} onChange={e => onChange(e.target.checked)} /> {f.label}{f.managerOnly ? ' (manager)' : ''}</label>;
    case 'startup': return <label className="text-xs block">{label}<select {...common} value={value ?? ''} onChange={e => onChange(e.target.value || undefined)}><option value="">—</option>{startups.map(s => <option key={s.id} value={s.id}>{s.id} — {s.name}</option>)}</select></label>;
    case 'member': return <label className="text-xs block">{label}<select {...common} value={value ?? ''} onChange={e => onChange(e.target.value || undefined)}><option value="">—</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>;
    case 'record': return <label className="text-xs block">{label}<select {...common} value={value ?? ''} onChange={e => onChange(e.target.value || undefined)}><option value="">—</option>{(records?.[f.refKind || ''] || []).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>{hint}</label>;
    case 'file': return (
      <label className="text-xs block md:col-span-2">{label}
        {value?.name && !value?.dataUrl && <span className="block text-theme-text-secondary mb-1">Current: {value.name}</span>}
        <input type="file" disabled={disabled} className={inputCls} onChange={async e => { const file = e.target.files?.[0]; if (file) onChange({ name: file.name, type: file.type, dataUrl: await readFileAsDataUrl(file) }); }} />
      </label>
    );
    default: return <label className="text-xs block">{label}<input {...common} value={value ?? ''} onChange={e => onChange(e.target.value)} />{hint}</label>;
  }
}

export const ragClass: Record<string, string> = {
  Green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Red: 'bg-red-500/15 text-red-400 border-red-500/30',
};
export function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'green' | 'amber' | 'red' | 'blue' }) {
  const t = { default: 'bg-theme-background/40 border-theme-border/40', green: ragClass.Green, amber: ragClass.Amber, red: ragClass.Red, blue: 'bg-accent/15 text-accent border-accent/30' }[tone];
  return <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${t}`}>{children}</span>;
}
