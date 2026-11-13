'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A progress value that never sits on a blank spinner: it climbs to ~95% over `expectedMs`, then crawls towards 99%
 * until the real work finishes, at which point it jumps to 100%.
 */
export function useWalletProgress(expectedMs = 5000) {
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  /** Runs `work` behind the bar; resolves with its result after the bar has shown 100%. */
  const run = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      stop();
      setProgress(1);
      setRunning(true);
      const started = Date.now();
      timer.current = setInterval(() => {
        const t = Date.now() - started;
        const p =
          t < expectedMs
            ? 95 * (1 - Math.pow(1 - t / expectedMs, 2))
            : Math.min(99, 95 + ((t - expectedMs) / 1000) * 0.4);
        setProgress(p);
      }, 80);
      try {
        const result = await work();
        stop();
        setProgress(100);
        await new Promise((r) => setTimeout(r, 450));
        return result;
      } catch (err) {
        stop();
        throw err;
      } finally {
        setRunning(false);
      }
    },
    [expectedMs]
  );

  const reset = useCallback(() => {
    stop();
    setRunning(false);
    setProgress(0);
  }, []);

  return { progress, running, run, reset };
}

export function WalletProgressBar({ progress, label }: { progress: number; label: string }) {
  const pct = Math.round(progress);
  return (
    <div className="w-full max-w-md my-3 p-4 bg-accent/15 border border-accent/40 rounded-2xl text-accent shadow-lg shadow-accent/10 animate-in fade-in zoom-in-95" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-xs font-semibold mb-2.5">
        <span>{label}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-accent transition-[width] duration-150 ease-out" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

export type WalletTarget = 'apple' | 'google';

/** Builds the wallet pass (behind the progress bar) and then hands the finished file / link to the device. */
export async function fetchWalletPrepared(serial: string): Promise<{ apple: boolean; googleSaveUrl: string }> {
  const res = await fetch(`/api/pass/${encodeURIComponent(serial)}/wallet/prepare`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Wallet pass could not be created. Please try again in a minute.');
  return data;
}

export function openWalletPass(serial: string, target: WalletTarget, prepared: { apple: boolean; googleSaveUrl: string }): void {
  if (target === 'apple') {
    if (!prepared.apple) throw new Error('No Apple Wallet pass file was returned.');
    window.location.href = `/api/pass/${encodeURIComponent(serial)}/wallet/apple`;
  } else {
    if (!prepared.googleSaveUrl) throw new Error('No Google Wallet save link available.');
    window.location.href = prepared.googleSaveUrl;
  }
}
