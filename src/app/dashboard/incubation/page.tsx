'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Rocket, Plus, X, Search, Settings2, Loader2, Edit3, Globe, MapPin, Users, Calendar, Building2, ExternalLink, Sparkles } from 'lucide-react';
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

  // Only managers can load the Startup-tier member list; everyone else sees a count rather than raw member ids.
  const founderNames = (s: Startup) => (candidates.length ? (s.founderMemberIds.map(id => candidates.find(c => c.id === id)?.name || id).join(', ') || '—') : s.founderMemberIds.length ? `${s.founderMemberIds.length} founder account${s.founderMemberIds.length === 1 ? '' : 's'}` : '—');

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

      {isStartupUser && startups.map(st => <MyStartup key={st.id} startup={st} onUpdate={load} />)}

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

/** "My Startup" — a founder's self-service portal: company profile, status, TRL, reviews, milestones, and direct editing. */
function MyStartup({ startup, onUpdate }: { startup: Startup; onUpdate?: () => void }) {
  const [reviews, setReviews] = useState<any[]>([]);
  const [trls, setTrls] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<IncubationAlert[]>([]);
  const [editingProfile, setEditingProfile] = useState(false);

  useEffect(() => {
    Promise.all([fetchRecords('review'), fetchRecords('trl'), fetchRecords('milestone'), fetchAlerts()]).then(([r, t, m, a]) => {
      setReviews(r.filter(x => x.startupId === startup.id));
      setTrls(t.filter(x => x.startupId === startup.id));
      setMilestones(m.filter(x => x.startupId === startup.id));
      setAlerts(a.filter(x => x.id.includes(startup.id)));
    }).catch(() => {});
  }, [startup.id]);

  const latestReview = [...reviews].sort((a, b) => String(b.periodEnd || '').localeCompare(String(a.periodEnd || '')))[0];
  const confirmed = trls.filter(t => t.status === 'Confirmed').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const upcoming = milestones.filter(m => m.status !== 'Done').sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

  return (
    <div className="space-y-6">
      {/* Startup Profile Header */}
      <div className="glass-panel rounded-3xl p-6 border border-white/10 shadow-lg space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {startup.logoUrl ? (
              <img
                src={startup.logoUrl}
                alt={startup.name}
                className="w-16 h-16 rounded-2xl object-cover border border-white/15 bg-black/20"
              />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
                <Rocket className="h-8 w-8" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-theme-text-primary">{startup.name}</h2>
                <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-white/10 text-theme-text-secondary border border-white/10">
                  {startup.id}
                </span>
              </div>
              {startup.tagline && (
                <p className="text-xs text-accent mt-0.5 font-medium">{startup.tagline}</p>
              )}
              <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-theme-text-secondary">
                {startup.sector && (
                  <span className="flex items-center gap-1 font-semibold text-theme-text-primary">
                    <Building2 className="h-3.5 w-3.5 text-accent" /> {startup.sector}
                  </span>
                )}
                {startup.stage && (
                  <span className="px-2 py-0.5 rounded-full bg-primary/15 text-primary-light border border-primary/25 font-semibold text-[10px]">
                    {startup.stage}
                  </span>
                )}
                {startup.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {startup.location}
                  </span>
                )}
                {startup.teamSize && (
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> {startup.teamSize} members
                  </span>
                )}
                {startup.foundedYear && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Founded {startup.foundedYear}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditingProfile(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent hover:bg-primary-light text-white text-xs font-semibold shadow-md shadow-accent/20 transition-all cursor-pointer"
            >
              <Edit3 size={14} /> Edit Startup Profile
            </button>
          </div>
        </div>

        {/* Badges & Links */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-theme-border/20 text-xs">
          <div className="flex flex-wrap gap-2">
            <Badge tone={startup.status === 'Active' ? 'green' : 'amber'}>{startup.status}</Badge>
            <Badge>{startup.pathway}</Badge>
            {startup.mode && <Badge>{startup.mode}</Badge>}
            {startup.cohort && <Badge>Cohort: {startup.cohort}</Badge>}
          </div>

          <div className="flex items-center gap-3 text-xs">
            {startup.website && (
              <a
                href={startup.website.startsWith('http') ? startup.website : `https://${startup.website}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-accent hover:underline font-semibold"
              >
                <Globe className="h-3.5 w-3.5" /> Website <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {startup.socials?.linkedin && (
              <a
                href={startup.socials.linkedin}
                target="_blank"
                rel="noreferrer"
                className="text-theme-text-secondary hover:text-accent font-semibold"
              >
                LinkedIn
              </a>
            )}
            {startup.socials?.twitter && (
              <a
                href={startup.socials.twitter}
                target="_blank"
                rel="noreferrer"
                className="text-theme-text-secondary hover:text-accent font-semibold"
              >
                Twitter/X
              </a>
            )}
          </div>
        </div>
      </div>

      {/* About & Problem / Solution Cards */}
      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="About the Company">
          <p className="text-xs text-theme-text-secondary whitespace-pre-line leading-relaxed">
            {startup.aboutUs || startup.notes || 'No description provided yet. Click "Edit Startup Profile" to add details about your company.'}
          </p>
        </Panel>

        <Panel title="Problem & Solution">
          <div className="space-y-3 text-xs">
            {startup.problem && (
              <div>
                <span className="font-bold text-theme-text-primary block mb-0.5">Problem Statement</span>
                <p className="text-theme-text-secondary">{startup.problem}</p>
              </div>
            )}
            {startup.solution && (
              <div>
                <span className="font-bold text-theme-text-primary block mb-0.5">Solution &amp; Innovation</span>
                <p className="text-theme-text-secondary">{startup.solution}</p>
              </div>
            )}
            {!startup.problem && !startup.solution && (
              <p className="text-theme-text-secondary">No problem/solution details entered yet.</p>
            )}
          </div>
        </Panel>
      </div>

      {/* Incubation Metrics Grid */}
      <div className="grid md:grid-cols-3 gap-4">
        <Panel title="Latest quarterly status">
          {latestReview ? (
            <div className="space-y-1 text-xs">
              <span className={`inline-block px-2 py-0.5 rounded-full border font-semibold ${ragClass[latestReview.rag] || ''}`}>
                {latestReview.rag}
              </span>
              <div className="text-theme-text-secondary">{latestReview.quarter}</div>
              <div>{latestReview.ragRationale}</div>
            </div>
          ) : (
            <p className="text-xs text-theme-text-secondary">No review recorded yet.</p>
          )}
        </Panel>

        <Panel title="Technology readiness">
          {confirmed ? (
            <div className="text-xs space-y-1">
              <div className="text-2xl font-bold">TRL {confirmed.assessedTrl}</div>
              <div className="text-theme-text-secondary">{confirmed.technology} · confidence {confirmed.confidence}</div>
              <div className="font-mono text-[11px]">{confirmed.assessmentId}</div>
            </div>
          ) : (
            <p className="text-xs text-theme-text-secondary">No confirmed assessment yet.</p>
          )}
        </Panel>

        <Panel title="Deadlines & actions">
          {alerts.length ? (
            <ul className="text-xs space-y-1">
              {alerts.map(a => (
                <li key={a.id}>
                  <b>{a.title}</b>
                  <div className="text-theme-text-secondary">{a.detail}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-theme-text-secondary">Nothing due.</p>
          )}
        </Panel>
      </div>

      <Panel title="Milestones">
        {upcoming.length ? (
          <ul className="text-xs space-y-1">
            {upcoming.map(m => (
              <li key={m.id} className="flex justify-between py-1 border-b border-theme-border/10 last:border-none">
                <span>{m.title}</span>
                <span className="text-theme-text-secondary">{m.dueDate} · {m.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-theme-text-secondary">No open milestones.</p>
        )}
      </Panel>

      {/* Founder Profile Self-Service Editor Modal */}
      {editingProfile && (
        <FounderProfileModal
          startup={startup}
          onClose={() => setEditingProfile(false)}
          onSaved={() => {
            setEditingProfile(false);
            if (onUpdate) onUpdate();
          }}
        />
      )}
    </div>
  );
}

/** Modal allowing founders to self-update their company profile information in the Startup Registry */
function FounderProfileModal({ startup, onClose, onSaved }: { startup: Startup; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: startup.name || '',
    tagline: startup.tagline || '',
    sector: startup.sector || '',
    stage: startup.stage || '',
    website: startup.website || '',
    location: startup.location || '',
    teamSize: startup.teamSize || '',
    foundedYear: startup.foundedYear || '',
    aboutUs: startup.aboutUs || startup.notes || '',
    problem: startup.problem || '',
    solution: startup.solution || '',
    linkedin: startup.socials?.linkedin || '',
    twitter: startup.socials?.twitter || '',
    instagram: startup.socials?.instagram || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF(p => ({ ...p, [k]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) {
      setErr('Startup name is required.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      await updateStartup(startup.id, {
        name: f.name.trim(),
        tagline: f.tagline.trim() || undefined,
        sector: f.sector.trim() || undefined,
        stage: f.stage.trim() || undefined,
        website: f.website.trim() || undefined,
        location: f.location.trim() || undefined,
        teamSize: f.teamSize.trim() || undefined,
        foundedYear: f.foundedYear.trim() || undefined,
        aboutUs: f.aboutUs.trim() || undefined,
        problem: f.problem.trim() || undefined,
        solution: f.solution.trim() || undefined,
        socials: {
          linkedin: f.linkedin.trim() || undefined,
          twitter: f.twitter.trim() || undefined,
          instagram: f.instagram.trim() || undefined,
        },
      });
      onSaved();
    } catch (e: any) {
      setErr(e.message || 'Failed to update startup profile.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={e => e.stopPropagation()}
        className="glass-panel rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4 border border-white/15 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-theme-border/20 pb-3">
          <div>
            <h2 className="font-bold text-sm text-theme-text-primary flex items-center gap-2">
              <Rocket className="h-4 w-4 text-accent" /> Edit Startup Profile
            </h2>
            <p className="text-[11px] text-theme-text-secondary">
              Update your company information stored in the Startup Registry.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 hover:bg-white/10 rounded-lg cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1 md:col-span-2">
            <span className="font-semibold text-theme-text-secondary">Startup Name *</span>
            <input required className={inputCls} value={f.name} onChange={set('name')} />
          </label>

          <label className="space-y-1 md:col-span-2">
            <span className="font-semibold text-theme-text-secondary">Tagline / One-liner</span>
            <input className={inputCls} placeholder="e.g. Next-gen Agritech IoT Solutions" value={f.tagline} onChange={set('tagline')} />
          </label>

          <label className="space-y-1">
            <span className="font-semibold text-theme-text-secondary">Sector</span>
            <input className={inputCls} placeholder="e.g. DeepTech, AgriTech, SaaS" value={f.sector} onChange={set('sector')} />
          </label>

          <label className="space-y-1">
            <span className="font-semibold text-theme-text-secondary">Development Stage</span>
            <input className={inputCls} placeholder="e.g. Prototype / MVP, Early Revenue" value={f.stage} onChange={set('stage')} />
          </label>

          <label className="space-y-1">
            <span className="font-semibold text-theme-text-secondary">Website</span>
            <input className={inputCls} placeholder="https://example.com" value={f.website} onChange={set('website')} />
          </label>

          <label className="space-y-1">
            <span className="font-semibold text-theme-text-secondary">Location</span>
            <input className={inputCls} placeholder="e.g. Chennai, India" value={f.location} onChange={set('location')} />
          </label>

          <label className="space-y-1">
            <span className="font-semibold text-theme-text-secondary">Team Size</span>
            <input className={inputCls} placeholder="e.g. 5 members" value={f.teamSize} onChange={set('teamSize')} />
          </label>

          <label className="space-y-1">
            <span className="font-semibold text-theme-text-secondary">Founded Year</span>
            <input className={inputCls} placeholder="e.g. 2025" value={f.foundedYear} onChange={set('foundedYear')} />
          </label>

          <label className="space-y-1 md:col-span-2">
            <span className="font-semibold text-theme-text-secondary">About the Company</span>
            <textarea rows={3} className={inputCls} placeholder="Briefly describe what your startup does..." value={f.aboutUs} onChange={set('aboutUs')} />
          </label>

          <label className="space-y-1 md:col-span-2">
            <span className="font-semibold text-theme-text-secondary">Problem Statement</span>
            <textarea rows={2} className={inputCls} placeholder="What problem are you solving?" value={f.problem} onChange={set('problem')} />
          </label>

          <label className="space-y-1 md:col-span-2">
            <span className="font-semibold text-theme-text-secondary">Solution Description</span>
            <textarea rows={2} className={inputCls} placeholder="How does your technology/solution address this problem?" value={f.solution} onChange={set('solution')} />
          </label>

          <label className="space-y-1">
            <span className="font-semibold text-theme-text-secondary">LinkedIn Profile</span>
            <input className={inputCls} placeholder="https://linkedin.com/company/..." value={f.linkedin} onChange={set('linkedin')} />
          </label>

          <label className="space-y-1">
            <span className="font-semibold text-theme-text-secondary">Twitter / X</span>
            <input className={inputCls} placeholder="https://x.com/..." value={f.twitter} onChange={set('twitter')} />
          </label>
        </div>

        {err && <div className="text-xs text-red-400">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-theme-border/20">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-theme-border/40 text-xs text-theme-text-secondary hover:text-theme-text-primary cursor-pointer">
            Cancel
          </button>
          <button type="submit" disabled={saving || !f.name.trim()} className="px-5 py-2 rounded-xl bg-accent hover:bg-primary-light text-white text-xs font-semibold disabled:opacity-50 shadow-md shadow-accent/20 cursor-pointer">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
