'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Rocket, Plus, X, Search, Settings2, Loader2 } from 'lucide-react';
import { Chip } from '@/components/ui';
import { Badge, Panel, ragClass } from '@/components/incubation/ui';
import {
  fetchStartups, createStartup, updateStartup, fetchFounderCandidates, fetchRecords, fetchAlerts, type FounderCandidate,
} from '@/lib/incubation/client';
import { STARTUP_PATHWAYS, STARTUP_MODES, type Startup } from '@/lib/incubation/types';
import type { IncubationAlert } from '@/lib/incubation/alerts-server';

const statusColor: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'primary'> = {
  Applicant: 'default', Selected: 'primary', Waitlisted: 'warning', Onboarding: 'warning', Active: 'success', Graduated: 'primary', Exited: 'danger',
};

const inputCls = 'w-full bg-theme-background/40 border border-theme-border/40 rounded-xl px-3 py-2 text-xs';

export default function IncubationPage() {
  const [user, setUser] = useState<any>(null);
  const [startups, setStartups] = useState<Startup[]>([]);
  const [candidates, setCandidates] = useState<FounderCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Startup | 'new' | null>(null);

  const canManage = !!user && typeof user.tier === 'number' && user.tier <= 2;
  const isStartupUser = user?.tier === 4;

  const load = useCallback(async () => {
    try {
      setStartups(await fetchStartups());
      setError('');
    } catch (e: any) {
      setError(e.message || 'Could not load startups.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } catch { /* ignore */ }
    load();
  }, [load]);

  useEffect(() => {
    if (canManage) fetchFounderCandidates().then(setCandidates).catch(() => setCandidates([]));
  }, [canManage]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return startups.filter(s => !q || [s.id, s.name, s.sector, s.cohort, s.status].some(v => (v || '').toLowerCase().includes(q)));
  }, [startups, query]);

  const founderNames = (s: Startup) => s.founderMemberIds.map(id => candidates.find(c => c.id === id)?.name || id).join(', ') || '—';

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Rocket size={20} /> {isStartupUser ? 'My Startup' : 'Startup Registry'}</h1>
          <p className="text-xs text-theme-text-secondary">{isStartupUser ? 'Your incubation record.' : 'Startup master record. Active status is reserved for the onboarding activation gate.'}</p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Link href="/dashboard/incubation/settings" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-theme-border/40 text-xs font-semibold hover:bg-theme-background/40">
              <Settings2 size={14} /> Settings
            </Link>
          )}
          {canManage && (
            <button onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-white text-xs font-semibold">
              <Plus size={14} /> Add startup
            </button>
          )}
        </div>
      </div>

      {isStartupUser && startups.map(st => <MyStartup key={st.id} startup={st} />)}

      {!isStartupUser && (
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-secondary" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search ID, name, sector, cohort…" className={inputCls + ' pl-8'} />
        </div>
      )}

      {error && <div className="text-xs text-red-400">{error}</div>}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-theme-text-secondary"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel rounded-2xl p-8 text-center text-xs text-theme-text-secondary">
          {isStartupUser ? 'No startup is linked to your account yet. Ask the RTBI team to link it.' : 'No startups yet.'}
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-theme-text-secondary border-b border-theme-border/30">
                <th className="p-3">ID</th><th className="p-3">Name</th><th className="p-3">Status</th><th className="p-3">Pathway</th>
                <th className="p-3">Cohort</th><th className="p-3">Founders</th>{canManage && <th className="p-3" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="border-b border-theme-border/20">
                  <td className="p-3 font-mono">{s.id}</td>
                  <td className="p-3 font-semibold">{s.name}</td>
                  <td className="p-3"><Chip color={statusColor[s.status] || 'default'}>{s.status}</Chip></td>
                  <td className="p-3">{s.pathway}</td>
                  <td className="p-3">{s.cohort || '—'}</td>
                  <td className="p-3">{founderNames(s)}</td>
                  {canManage && <td className="p-3 text-right whitespace-nowrap"><Link href={`/dashboard/incubation/onboarding?startup=${s.id}`} className="text-accent font-semibold mr-3">Onboarding</Link><button onClick={() => setEditing(s)} className="text-accent font-semibold">Edit</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <StartupEditor
          startup={editing === 'new' ? null : editing}
          candidates={candidates}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function StartupEditor({ startup, candidates, onClose, onSaved }: {
  startup: Startup | null; candidates: FounderCandidate[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: startup?.name || '', sector: startup?.sector || '', stage: startup?.stage || '', technology: startup?.technology || '',
    legalStatus: startup?.legalStatus || '', website: startup?.website || '', cohort: startup?.cohort || '',
    pathway: startup?.pathway || STARTUP_PATHWAYS[1], mode: startup?.mode || '', notes: startup?.notes || '',
  });
  const [founders, setFounders] = useState<string[]>(startup?.founderMemberIds || []);
  const [consent, setConsent] = useState(startup?.consent || { externalDisclosure: false, photos: false, caseStudies: false });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.value }));
  const toggleFounder = (id: string) => setFounders(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const payload: any = { ...f, mode: f.mode || undefined, founderMemberIds: founders };
      if (startup) { payload.consent = consent; await updateStartup(startup.id, payload); }
      else await createStartup(payload);
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-panel rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-sm">{startup ? `Edit ${startup.id}` : 'Add startup'}</h2>
          <button onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs space-y-1 md:col-span-2">Startup name *<input className={inputCls} value={f.name} onChange={set('name')} /></label>
          <label className="text-xs space-y-1">Sector<input className={inputCls} value={f.sector} onChange={set('sector')} /></label>
          <label className="text-xs space-y-1">Stage<input className={inputCls} value={f.stage} onChange={set('stage')} /></label>
          <label className="text-xs space-y-1">Technology<input className={inputCls} value={f.technology} onChange={set('technology')} /></label>
          <label className="text-xs space-y-1">Legal status (record “Not incorporated” if so)<input className={inputCls} value={f.legalStatus} onChange={set('legalStatus')} /></label>
          <label className="text-xs space-y-1">Website<input className={inputCls} value={f.website} onChange={set('website')} /></label>
          <label className="text-xs space-y-1">Cohort<input className={inputCls} value={f.cohort} onChange={set('cohort')} /></label>
          <label className="text-xs space-y-1">Pathway
            <select className={inputCls} value={f.pathway} onChange={set('pathway')}>{STARTUP_PATHWAYS.map(p => <option key={p}>{p}</option>)}</select>
          </label>
          <label className="text-xs space-y-1">Mode
            <select className={inputCls} value={f.mode} onChange={set('mode')}><option value="">—</option>{STARTUP_MODES.map(p => <option key={p}>{p}</option>)}</select>
          </label>
          <label className="text-xs space-y-1 md:col-span-2">Notes<textarea className={inputCls} rows={2} value={f.notes} onChange={set('notes')} /></label>
        </div>

        <div className="space-y-1">
          <div className="text-xs font-semibold">Founder accounts (Startup tier)</div>
          {candidates.length === 0 ? (
            <div className="text-xs text-theme-text-secondary">No active Startup-tier users. Add them under Users first.</div>
          ) : (
            <div className="max-h-36 overflow-y-auto rounded-xl border border-theme-border/30 p-2 space-y-1">
              {candidates.map(c => (
                <label key={c.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={founders.includes(c.id)} onChange={() => toggleFounder(c.id)} /> {c.name} <span className="text-theme-text-secondary">{c.email}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {startup && (
          <div className="space-y-1">
            <div className="text-xs font-semibold">Consent for external disclosure</div>
            {([['externalDisclosure', 'Startup data'], ['photos', 'Photos'], ['caseStudies', 'Case studies / pitches']] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={consent[k]} onChange={e => setConsent(p => ({ ...p, [k]: e.target.checked }))} /> {label}
              </label>
            ))}
          </div>
        )}

        {err && <div className="text-xs text-red-400">{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-xl border border-theme-border/40 text-xs">Cancel</button>
          <button onClick={save} disabled={saving || !f.name.trim()} className="px-4 py-2 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "My Startup" — a founder's read-only view of their own record: status, latest RAG, confirmed TRL, milestones, deadlines. */
function MyStartup({ startup }: { startup: Startup }) {
  const [reviews, setReviews] = useState<any[]>([]);
  const [trls, setTrls] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<IncubationAlert[]>([]);
  useEffect(() => {
    Promise.all([fetchRecords('review'), fetchRecords('trl'), fetchRecords('milestone'), fetchAlerts()]).then(([r, t, m, a]) => {
      setReviews(r.filter(x => x.startupId === startup.id)); setTrls(t.filter(x => x.startupId === startup.id));
      setMilestones(m.filter(x => x.startupId === startup.id)); setAlerts(a.filter(x => x.id.includes(startup.id)));
    }).catch(() => {});
  }, [startup.id]);
  const latestReview = [...reviews].sort((a, b) => String(b.periodEnd || '').localeCompare(String(a.periodEnd || '')))[0];
  const confirmed = trls.filter(t => t.status === 'Confirmed').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const upcoming = milestones.filter(m => m.status !== 'Done').sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  return (
    <div className="space-y-4">
      <Panel title={`${startup.name} · ${startup.id}`}>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone={startup.status === 'Active' ? 'green' : 'amber'}>{startup.status}</Badge>
          <Badge>{startup.pathway}</Badge>
          {startup.cohort && <Badge>{startup.cohort}</Badge>}
        </div>
      </Panel>
      <div className="grid md:grid-cols-3 gap-4">
        <Panel title="Latest quarterly status">
          {latestReview ? <div className="space-y-1 text-xs"><span className={`inline-block px-2 py-0.5 rounded-full border font-semibold ${ragClass[latestReview.rag] || ''}`}>{latestReview.rag}</span>
            <div className="text-theme-text-secondary">{latestReview.quarter}</div><div>{latestReview.ragRationale}</div></div> : <p className="text-xs text-theme-text-secondary">No review recorded yet.</p>}
        </Panel>
        <Panel title="Technology readiness">
          {confirmed ? <div className="text-xs space-y-1"><div className="text-2xl font-bold">TRL {confirmed.assessedTrl}</div><div className="text-theme-text-secondary">{confirmed.technology} · confidence {confirmed.confidence}</div><div className="font-mono text-[11px]">{confirmed.assessmentId}</div></div>
            : <p className="text-xs text-theme-text-secondary">No confirmed assessment yet.</p>}
        </Panel>
        <Panel title="Deadlines & actions">
          {alerts.length ? <ul className="text-xs space-y-1">{alerts.map(a => <li key={a.id}><b>{a.title}</b><div className="text-theme-text-secondary">{a.detail}</div></li>)}</ul> : <p className="text-xs text-theme-text-secondary">Nothing due.</p>}
        </Panel>
      </div>
      <Panel title="Milestones">
        {upcoming.length ? <ul className="text-xs space-y-1">{upcoming.map(m => <li key={m.id} className="flex justify-between"><span>{m.title}</span><span className="text-theme-text-secondary">{m.dueDate} · {m.status}</span></li>)}</ul> : <p className="text-xs text-theme-text-secondary">No open milestones.</p>}
      </Panel>
    </div>
  );
}
