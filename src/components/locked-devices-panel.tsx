'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { LockKeyhole, Unlock, RefreshCw, Loader2, ShieldCheck } from 'lucide-react';
import { authHeaders } from '@/lib/local-data';

interface LockView {
  id: string;
  scope: 'device' | 'account-on-device';
  account?: string;
  lockedUntil: number;
  level: number;
  ip: string;
  userAgent: string;
  lastFailureAt: number;
}

/** Short, readable device label from a user-agent string (e.g. "Chrome on Windows"). */
function deviceLabel(ua: string): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

function remaining(until: number, now: number): string {
  const s = Math.max(0, Math.ceil((until - now) / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** Super-User panel: devices currently locked out of signing in, with an unlock action. */
export function LockedDevicesPanel() {
  const [locks, setLocks] = useState<LockView[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/device-locks', { headers: authHeaders(), cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load locked devices.');
      setLocks(data.locks || []);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Could not load locked devices.');
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = setInterval(load, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(refresh); clearInterval(tick); };
  }, [load]);

  const unlock = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/device-locks?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not unlock that device.');
      await load();
    } catch (e: any) {
      setError(e.message || 'Could not unlock that device.');
    } finally {
      setBusyId(null);
    }
  };

  const active = (locks || []).filter((l) => l.lockedUntil > now);

  return (
    <section className="glass-panel rounded-2xl border border-theme-card-border p-4 md:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center">
            <LockKeyhole className="h-4 w-4 text-accent" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-theme-text-primary">Locked devices</h2>
            <p className="text-[11px] text-theme-text-secondary">Devices blocked from signing in after repeated wrong passwords or codes. Locks lift on their own; unlock one early if it&apos;s a genuine user.</p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-border/20 cursor-pointer" title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && <p className="text-xs text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}

      {locks === null && !error ? (
        <div className="flex items-center gap-2 text-xs text-theme-text-secondary py-3"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
      ) : active.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-theme-text-secondary py-3">
          <ShieldCheck className="h-4 w-4 text-success" /> No devices are locked right now.
        </div>
      ) : (
        <ul className="divide-y divide-theme-border/30">
          {active.map((l) => (
            <li key={l.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold text-theme-text-primary truncate">
                  {l.scope === 'device' ? 'All accounts' : l.account}
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-danger/10 text-danger border border-danger/20">
                    {l.scope === 'device' ? 'Whole device' : 'One account'}
                  </span>
                </p>
                <p className="text-[11px] text-theme-text-secondary">
                  {deviceLabel(l.userAgent)} · IP {l.ip} · lock level {l.level} · unlocks in <span className="font-mono text-theme-text-primary">{remaining(l.lockedUntil, now)}</span>
                </p>
              </div>
              <button
                onClick={() => unlock(l.id)}
                disabled={busyId === l.id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-theme-border/15 hover:bg-theme-border/25 border border-theme-card-border text-theme-text-primary font-semibold cursor-pointer disabled:opacity-60"
              >
                {busyId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />} Unlock
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
