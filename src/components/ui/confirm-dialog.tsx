'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from './dialog';

export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
let pending: Pending | null = null;
let setter: ((p: Pending | null) => void) | null = null;

/** Promise-based replacement for window.confirm(): `if (!(await confirmDialog({title:'Delete?'}))) return;` */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!setter) { resolve(typeof window !== 'undefined' ? window.confirm(opts.title) : false); return; }
    pending?.resolve(false);
    pending = { ...opts, resolve };
    setter(pending);
  });
}

/** Mount once near the root. */
export function ConfirmHost() {
  const [p, setP] = useState<Pending | null>(null);
  useEffect(() => { setter = setP; return () => { setter = null; }; }, []);
  const done = (ok: boolean) => { p?.resolve(ok); pending = null; setP(null); };
  const danger = (p?.tone ?? 'danger') === 'danger';
  return (
    <Dialog
      open={!!p}
      onClose={() => done(false)}
      title={p?.title ?? ''}
      size="sm"
      footer={
        <>
          <button type="button" onClick={() => done(false)} className="min-h-11 px-4 rounded-xl border border-theme-border text-sm font-semibold hover:bg-theme-border/20">
            {p?.cancelLabel ?? 'Cancel'}
          </button>
          <button type="button" data-autofocus onClick={() => done(true)} className={`min-h-11 px-5 rounded-xl text-sm font-bold text-white ${danger ? 'bg-rose-700 hover:bg-rose-800' : 'bg-accent hover:bg-primary-light'}`}>
            {p?.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        {danger && <AlertTriangle className="h-6 w-6 text-rose-600 shrink-0" aria-hidden="true" />}
        <div className="text-sm text-theme-text-secondary leading-relaxed">{p?.message ?? 'Are you sure?'}</div>
      </div>
    </Dialog>
  );
}
