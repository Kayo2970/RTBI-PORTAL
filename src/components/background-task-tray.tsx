'use client';

import React, { useEffect } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, XCircle, X, Square } from 'lucide-react';
import { dismissTask, useBackgroundTasks } from '@/lib/background-tasks';

/**
 * Bottom-left status tray: every long job that is running (or just finished) with live progress, wherever the person
 * navigates. Mounted once in the dashboard shell, so it persists across modules.
 */
export function BackgroundTaskTray({ offsetClass = 'md:left-4' }: { offsetClass?: string }) {
  const tasks = useBackgroundTasks();
  const running = tasks.filter((t) => t.state === 'running').length;

  // Closing or reloading the tab would cut a running job off half way — ask first.
  useEffect(() => {
    if (running === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  if (tasks.length === 0) return null;
  const shown = tasks.slice(-4);

  return (
    <div className={`fixed bottom-4 left-3 ${offsetClass} z-[60] w-[min(22rem,calc(100vw-1.5rem))] space-y-2 pointer-events-none`} aria-live="polite" role="status">
      {tasks.length > shown.length && (
        <div className="pointer-events-auto text-[10px] font-bold text-theme-text-secondary px-2">+{tasks.length - shown.length} more running or finished</div>
      )}
      {shown.map((t) => {
        const pct = t.total > 0 ? Math.min(100, Math.round((t.done / t.total) * 100)) : 0;
        const tone = t.state === 'failed' ? 'border-rose-500/40' : t.state === 'done' ? (t.warn ? 'border-amber-500/40' : 'border-emerald-500/40') : 'border-accent/40';
        return (
          <div key={t.id} className={`pointer-events-auto glass-panel rounded-2xl p-3 border ${tone} bg-white/95 dark:bg-[#0B1B2E]/95 backdrop-blur-xl shadow-2xl shadow-black/30 text-theme-text-primary animate-in slide-in-from-bottom-3 fade-in duration-200`}>
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0">
                {t.state === 'running' ? <Loader2 className="h-4 w-4 text-accent animate-spin" /> : t.state === 'failed' ? <XCircle className="h-4 w-4 text-rose-500" /> : t.warn ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold truncate">{t.label}</span>
                  {t.total > 0 && t.state === 'running' && <span className="text-[10px] font-mono text-theme-text-secondary shrink-0">{t.done}/{t.total}</span>}
                </div>
                <p className="text-[11px] text-theme-text-secondary break-words">
                  {t.state === 'running' ? t.detail || (t.total > 0 ? 'Working…' : 'In progress — you can keep using other modules.') : t.message || (t.state === 'failed' ? 'Failed.' : 'Done.')}
                </p>
                {t.state === 'running' && (
                  <div className="mt-1.5 h-1.5 rounded-full bg-theme-border/30 overflow-hidden">
                    <div className={`h-full rounded-full bg-accent transition-[width] duration-300 ${t.total > 0 ? '' : 'w-1/3 animate-pulse'}`} style={t.total > 0 ? { width: `${pct}%` } : undefined} />
                  </div>
                )}
                {t.state === 'running' && t.cancel && !t.stopping && (
                  <button type="button" onClick={t.cancel} className="mt-1.5 text-[10px] font-bold text-rose-500 hover:underline cursor-pointer flex items-center gap-1"><Square className="h-2.5 w-2.5" /> Stop after this one</button>
                )}
              </div>
              {t.state !== 'running' && (
                <button type="button" onClick={() => dismissTask(t.id)} className="shrink-0 p-0.5 text-theme-text-secondary hover:text-theme-text-primary cursor-pointer" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default BackgroundTaskTray;
