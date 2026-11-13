'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, RotateCw, X, Copy, Check } from 'lucide-react';
import { subscribeSyncStatus, getSyncEntries, getSyncSuccessFlash, dismissSyncEntry, type SyncEntry } from '@/lib/sync-status';

/** Modal showing the raw technical error for one failed sync entry, with a
 * one-click copy — so it can be pasted straight into a bug report instead of
 * retyped from a toast that scrolls away. */
function ErrorDetailsModal({ entry, onClose }: { entry: SyncEntry; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const detail = entry.message || `Failed to save ${entry.label}.`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — the text is still selectable in the box below
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg glass-panel border border-danger/30 rounded-2xl shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-danger shrink-0" />
            <h3 className="text-sm font-bold text-theme-text-primary">
              Failed to save {entry.label}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-theme-text-secondary hover:text-theme-text-primary p-0.5 shrink-0 cursor-pointer"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[11px] text-theme-text-secondary mb-2">Technical error details:</p>
        <pre className="text-xs font-mono text-theme-text-primary bg-black/20 border border-theme-border/30 rounded-lg p-3 whitespace-pre-wrap break-words max-h-64 overflow-y-auto select-text">
          {detail}
        </pre>
        <div className="flex justify-end gap-2 mt-4">
          {entry.retry && (
            <button
              type="button"
              onClick={() => { entry.retry?.(); onClose(); }}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-theme-border/40 text-theme-text-primary hover:bg-theme-border/20 cursor-pointer"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 cursor-pointer"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy error'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Corner-anchored, honest feedback for every background write in the app —
 * "Saving...", a brief "Saved" confirmation, or a persistent "failed to save"
 * with a real retry, instead of the silence a fire-and-forget write used to
 * leave behind. Mounted once in the dashboard shell.
 */
export function SyncStatusPill() {
  const [entries, setEntries] = useState<SyncEntry[]>([]);
  const [successFlash, setSuccessFlash] = useState<{ id: string; label: string } | null>(null);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setEntries(getSyncEntries());
      setSuccessFlash(getSyncSuccessFlash());
    };
    sync();
    return subscribeSyncStatus(sync);
  }, []);

  const pending = entries.filter(e => e.status === 'pending');
  const errors = entries.filter(e => e.status === 'error');
  const detailsEntry = errors.find(e => e.id === detailsFor) || null;

  if (pending.length === 0 && errors.length === 0 && !successFlash) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col-reverse items-end gap-2 pointer-events-none">
      {detailsEntry && (
        <ErrorDetailsModal entry={detailsEntry} onClose={() => setDetailsFor(null)} />
      )}
      {errors.map(entry => (
        <div
          key={entry.id}
          className="pointer-events-auto flex items-center gap-2 pl-3 pr-2 py-2 rounded-xl glass-panel border border-danger/30 shadow-lg text-xs animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <AlertCircle className="h-3.5 w-3.5 text-danger shrink-0" />
          <span className="text-theme-text-primary font-medium">{entry.message || `Failed to save ${entry.label}.`}</span>
          <button
            type="button"
            onClick={() => setDetailsFor(entry.id)}
            className="flex items-center gap-1 text-theme-text-secondary font-semibold hover:underline hover:text-theme-text-primary cursor-pointer shrink-0"
          >
            Details
          </button>
          {entry.retry && (
            <button
              type="button"
              onClick={entry.retry}
              className="flex items-center gap-1 text-accent font-semibold hover:underline cursor-pointer shrink-0"
            >
              <RotateCw className="h-3 w-3" />
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={() => dismissSyncEntry(entry.id)}
            className="text-theme-text-secondary hover:text-theme-text-primary p-0.5 shrink-0 cursor-pointer"
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {successFlash && errors.length === 0 && (
        <div className="pointer-events-none flex items-center gap-2 px-3 py-2 rounded-xl glass-panel border border-success/30 shadow-lg text-xs animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
          <span className="text-theme-text-primary font-medium">Saved</span>
        </div>
      )}

      {pending.length > 0 && errors.length === 0 && !successFlash && (
        <div className="pointer-events-none flex items-center gap-2 px-3 py-2 rounded-xl glass-panel border border-theme-border/30 shadow-lg text-xs animate-in fade-in slide-in-from-bottom-2 duration-200">
          <Loader2 className="h-3.5 w-3.5 text-accent shrink-0 animate-spin" />
          <span className="text-theme-text-secondary font-medium">
            {pending.length === 1 ? `${pending[0].verb} ${pending[0].label}...` : `Saving ${pending.length} changes...`}
          </span>
        </div>
      )}
    </div>
  );
}
