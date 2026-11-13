'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { UserCheck, Loader2, Check } from 'lucide-react';
import { authHeaders } from '@/lib/local-data';

interface Candidate { id: string; name: string; role: string; tier: number }

/** Super-User card in the Approvals module: choose who automatic approval requests are sent to. */
export function DefaultApproversPanel() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/approval-settings', { headers: authHeaders(), cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load approvers.');
      setCandidates(data.candidates || []);
      setSelected(data.approverIds || []);
      setSaved(data.approverIds || []);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Could not load approvers.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const dirty = selected.slice().sort().join(',') !== saved.slice().sort().join(',');

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/approval-settings', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ approverIds: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      setSaved(data.approverIds || []);
      setError('');
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (e: any) {
      setError(e.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="glass-panel rounded-2xl border border-theme-card-border p-4 md:p-5 space-y-3">
      <div className="flex items-start gap-2.5">
        <div className="h-9 w-9 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
          <UserCheck className="h-4 w-4 text-accent" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-theme-text-primary">Who approves</h2>
          <p className="text-[11px] text-theme-text-secondary">
            Choose who automatic approval requests (events, tasks, designs, announcements, forms) are sent to. Leave everyone unticked and they go to all
            CEOs and Super Users. Anyone can also ask specific people directly from an item using <strong>Request approval</strong>.
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}

      {candidates === null && !error ? (
        <div className="flex items-center gap-2 text-xs text-theme-text-secondary"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
      ) : candidates && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-y-auto">
            {candidates.map((c) => {
              const on = selected.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  className={`flex items-center justify-between gap-2 text-left px-3 py-2 rounded-xl border text-xs transition-colors cursor-pointer ${on ? 'bg-accent/15 border-accent/40 text-accent font-semibold' : 'bg-theme-border/10 border-theme-card-border text-theme-text-primary hover:bg-theme-border/20'}`}
                >
                  <span className="truncate">{c.name}<span className="block text-[10px] font-normal text-theme-text-secondary truncate">{c.role || (c.tier === 1 ? 'Super User' : c.tier === 2 ? 'CEO' : 'Employee')}</span></span>
                  {on && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-theme-text-secondary">{selected.length === 0 ? 'Currently: all CEOs and Super Users.' : `${selected.length} selected.`}</p>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent hover:bg-primary-light text-white text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : justSaved ? <Check className="h-3.5 w-3.5" /> : null}
              {justSaved ? 'Saved' : 'Save approvers'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
