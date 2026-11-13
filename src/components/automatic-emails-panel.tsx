'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, PauseCircle, Loader2 } from 'lucide-react';
import { authHeaders } from '@/lib/local-data';

interface TypeView { key: string; label: string; description: string; enabled: boolean; defaultEnabled: boolean }
interface PolicyView { paused: boolean; types: TypeView[]; updatedBy?: string }

function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${on ? 'bg-accent' : 'bg-theme-border/50'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

/** Super-User switches for the portal's automatic emails (pause everything, or turn individual types on/off). */
export function AutomaticEmailsPanel() {
  const [policy, setPolicy] = useState<PolicyView | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/email/automatic', { headers: authHeaders(), cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load automatic email settings.');
      setPolicy(data);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Could not load automatic email settings.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (patch: { paused?: boolean; overrides?: Record<string, boolean> }) => {
    setSaving(true);
    try {
      const res = await fetch('/api/email/automatic', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      setPolicy(data);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="glass-panel p-6 rounded-3xl space-y-4 border border-theme-card-border">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
          <BellRing className="h-4 w-4 text-accent" />
        </div>
        <div>
          <h3 className="text-base font-bold text-theme-text-primary">Automatic emails</h3>
          <p className="text-xs text-theme-text-secondary mt-0.5">
            Choose which emails the portal sends on its own. Sign-in codes, account activation links and anything a person sends deliberately
            (direct messages, event passes, certificates) are never blocked.
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}

      {!policy && !error ? (
        <div className="flex items-center gap-2 text-xs text-theme-text-secondary"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
      ) : policy && (
        <>
          <div className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${policy.paused ? 'bg-warning/10 border-warning/30' : 'bg-theme-border/10 border-theme-card-border'}`}>
            <div className="flex items-center gap-2.5">
              <PauseCircle className={`h-5 w-5 ${policy.paused ? 'text-warning' : 'text-theme-text-secondary'}`} />
              <div>
                <p className="text-sm font-semibold text-theme-text-primary">Pause all automatic emails</p>
                <p className="text-[11px] text-theme-text-secondary">{policy.paused ? 'Paused: none of the types below will send until you resume.' : 'Everything below follows its own switch.'}</p>
              </div>
            </div>
            <Switch on={policy.paused} disabled={saving} label="Pause all automatic emails" onChange={(v) => save({ paused: v })} />
          </div>

          <ul className={`divide-y divide-theme-border/30 ${policy.paused ? 'opacity-50' : ''}`}>
            {policy.types.map((t) => (
              <li key={t.key} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-theme-text-primary">
                    {t.label}
                    {!t.defaultEnabled && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-theme-border/25 text-theme-text-secondary">Off by default</span>}
                  </p>
                  <p className="text-[11px] text-theme-text-secondary">{t.description}</p>
                </div>
                <Switch on={t.enabled} disabled={saving} label={t.label} onChange={(v) => save({ overrides: { [t.key]: v } })} />
              </li>
            ))}
          </ul>
          {policy.updatedBy && <p className="text-[10px] text-theme-text-secondary">Last changed by {policy.updatedBy}.</p>}
        </>
      )}
    </section>
  );
}
