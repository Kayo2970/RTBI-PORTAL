'use client';
import React from 'react';
import { X, CheckCircle, AlertTriangle } from 'lucide-react';

export const inputCls = 'w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary text-xs focus:outline-none focus:border-accent';
export const btnPrimary = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-white text-xs font-bold hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all';
export const btnGhost = 'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-theme-card-border text-theme-text-secondary text-xs font-semibold hover:text-theme-text-primary hover:bg-theme-border/20 disabled:opacity-50 cursor-pointer transition-all';
export const btnDanger = 'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-red-500/30 text-red-500 text-xs font-semibold hover:bg-red-500/10 disabled:opacity-50 cursor-pointer transition-all';

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-theme-text-secondary">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-theme-text-secondary">{hint}</p>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className={`glass-panel w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-3xl p-6 space-y-5 relative border border-white/15 shadow-2xl max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-theme-text-primary">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const TONES: Record<string, string> = {
  green: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  red: 'bg-red-500/15 text-red-500 border-red-500/30',
  blue: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  grey: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
};
export function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${TONES[tone]}`}>{children}</span>;
}

export function Banner({ kind, children }: { kind: 'ok' | 'error'; children: React.ReactNode }) {
  const ok = kind === 'ok';
  return (
    <div role={ok ? 'status' : 'alert'} className={`flex items-center gap-3 p-3 rounded-2xl text-xs border ${ok ? 'bg-success/15 border-success/20' : 'bg-red-500/10 border-red-500/30'} text-theme-text-primary`}>
      {ok ? <CheckCircle className="h-4 w-4 text-success shrink-0" /> : <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

export function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`glass-panel rounded-3xl p-5 border border-theme-card-border ${className}`}>{children}</div>;
}

/** Convert a Date to the value format <input type="datetime-local"> wants (local time). */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}
export function fmtDate(day: string): string {
  return new Date(day + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
