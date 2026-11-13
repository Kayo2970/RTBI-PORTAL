'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { HardDrive, RefreshCw, Trash2 } from 'lucide-react';
import { authHeaders } from '@/lib/local-data';

interface Report {
  totalBytes: number;
  fileCount: number;
  categories: Array<{ category: string; bytes: number; files: number }>;
  orphanBytes: number;
  orphanCount: number;
  orphans: Array<{ key: string; bytes: number; modifiedAt: string }>;
  preRestoreSnapshots: Array<{ name: string; bytes: number }>;
  largest: Array<{ key: string; bytes: number }>;
}

const fmt = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export function StoragePanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/storage', { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load storage report');
      setReport(data);
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: 'delete-orphans' | 'delete-snapshots', confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/storage', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cleanup failed');
      setMessage(
        action === 'delete-orphans'
          ? `Removed ${data.deleted} orphaned file(s), freed ${fmt(data.bytes)}.`
          : `Removed ${data.deleted} pre-restore snapshot(s).`
      );
      await load();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const snapshotBytes = (report?.preRestoreSnapshots || []).reduce((n, s) => n + s.bytes, 0);

  return (
    <div className="glass-panel rounded-2xl p-5 border border-theme-border space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-accent" /> Server Storage
        </h2>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border border-theme-border hover:bg-white/5 flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {report && (
        <>
          <p className="text-xs text-theme-text-secondary">
            <strong className="text-theme-text-primary">{fmt(report.totalBytes)}</strong> of uploads across {report.fileCount} files.{' '}
            {report.orphanCount > 0 ? (
              <span className="text-amber-400 font-semibold">
                {report.orphanCount} orphaned file(s) ({fmt(report.orphanBytes)}) are not referenced by any record.
              </span>
            ) : (
              <span className="text-emerald-400 font-semibold">No orphaned files.</span>
            )}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {report.categories.map((c) => (
              <div key={c.category} className="rounded-xl border border-theme-border p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-theme-text-secondary">{c.category}</div>
                <div className="text-sm font-bold">{fmt(c.bytes)}</div>
                <div className="text-[10px] text-theme-text-secondary">{c.files} files</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {report.orphanCount > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run('delete-orphans', `Permanently delete ${report.orphanCount} orphaned file(s) (${fmt(report.orphanBytes)})? Take a backup first if unsure.`)
                }
                className="text-xs px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete orphaned files
              </button>
            )}
            {report.preRestoreSnapshots.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run('delete-snapshots', `Delete ${report.preRestoreSnapshots.length} old pre-restore snapshot folder(s) (${fmt(snapshotBytes)})?`)
                }
                className="text-xs px-3 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete {report.preRestoreSnapshots.length} pre-restore snapshot(s) ({fmt(snapshotBytes)})
              </button>
            )}
          </div>

          {report.largest.length > 0 && (
            <details className="text-[11px] text-theme-text-secondary">
              <summary className="cursor-pointer font-semibold">Largest files</summary>
              <ul className="mt-1.5 space-y-0.5 font-mono">
                {report.largest.map((f) => (
                  <li key={f.key} className="flex justify-between gap-3">
                    <span className="truncate">{f.key}</span>
                    <span>{fmt(f.bytes)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {message && <p className="text-xs font-semibold text-accent">{message}</p>}
    </div>
  );
}
