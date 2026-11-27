'use client';

import React, { useEffect, useSyncExternalStore } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';
export interface ToastItem { id: number; tone: ToastTone; message: string; description?: string }

/* Module-level store so toast.success(...) also works outside React (api helpers, event handlers). */
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const emit = () => listeners.forEach((l) => l());

function dismiss(id: number) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  items = items.filter((i) => i.id !== id);
  emit();
}

function push(tone: ToastTone, message: string, opts?: { description?: string; duration?: number }) {
  const id = nextId++;
  items = [...items.slice(-3), { id, tone, message, description: opts?.description }];
  emit();
  const duration = opts?.duration ?? (tone === 'error' ? 8000 : 4500);
  if (duration > 0 && typeof window !== 'undefined') timers.set(id, setTimeout(() => dismiss(id), duration));
  return id;
}

export const toast = {
  success: (m: string, o?: { description?: string; duration?: number }) => push('success', m, o),
  error: (m: string, o?: { description?: string; duration?: number }) => push('error', m, o),
  info: (m: string, o?: { description?: string; duration?: number }) => push('info', m, o),
  warning: (m: string, o?: { description?: string; duration?: number }) => push('warning', m, o),
  dismiss,
};

/** Hook form of the same API, for components that prefer hooks. */
export function useToast() {
  return toast;
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const getSnapshot = () => items;
const getServerSnapshot = () => [] as ToastItem[];

const TONES: Record<ToastTone, { icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'border-emerald-600 text-emerald-700 dark:text-emerald-300' },
  error: { icon: AlertCircle, cls: 'border-rose-600 text-rose-700 dark:text-rose-300' },
  info: { icon: Info, cls: 'border-primary text-primary dark:text-violet-300 dark:border-violet-300' },
  warning: { icon: AlertTriangle, cls: 'border-amber-600 text-amber-700 dark:text-amber-300' },
};

/** Mount once near the root. Success/info are announced politely, errors assertively. */
export function ToastViewport() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => () => { timers.forEach(clearTimeout); timers.clear(); }, []);
  return (
    <div className="fixed z-[300] bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 flex flex-col gap-2 pointer-events-none" role="region" aria-label="Notifications">
      {list.map((t) => {
        const { icon: Icon, cls } = TONES[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            aria-live={t.tone === 'error' ? 'assertive' : 'polite'}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border-l-4 border bg-theme-card shadow-lg p-3.5 animate-in fade-in slide-in-from-bottom-2 duration-200 ${cls}`}
          >
            <Icon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-theme-text-primary">{t.message}</p>
              {t.description && <p className="text-sm text-theme-text-secondary mt-0.5">{t.description}</p>}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="h-8 w-8 -mr-1 -mt-1 flex items-center justify-center rounded-lg text-theme-text-secondary hover:bg-theme-border/30">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
