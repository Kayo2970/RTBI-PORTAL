'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { UserPlus, Search, X, Mail, ShieldCheck, Ban, RotateCcw, Loader2, Copy, Check } from 'lucide-react';
import {
  getMembers,
  addMember,
  updateMember,
  terminateMember,
  reactivateMember,
  syncWithServer,
  authHeaders,
  isRootSuperUser,
  type Member,
  type MemberDivision,
} from '@/lib/local-data';
import { TIER_LABELS, tierLabel, isSuperUser } from '@/lib/permissions';

const TIERS: { tier: 1 | 2 | 3 | 4; label: MemberDivision; blurb: string }[] = [
  { tier: 1, label: 'Super User', blurb: 'Full system control' },
  { tier: 2, label: 'CEO', blurb: 'Leadership oversight' },
  { tier: 3, label: 'Employee', blurb: 'Day-to-day operations' },
  { tier: 4, label: 'Startup', blurb: 'Incubated startups' },
];

const tierBadge: Record<number, string> = {
  1: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  2: 'bg-accent/15 text-accent border-accent/30',
  3: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  4: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
};

export default function UsersPage() {
  const [user, setUser] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<number | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string; link?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [tier, setTier] = useState<1 | 2 | 3 | 4>(3);
  const [role, setRole] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const refresh = useCallback(() => setMembers(getMembers()), []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('user');
      if (saved) setUser(JSON.parse(saved));
    } catch { /* ignore */ }
    refresh();
    syncWithServer().then(refresh).catch(() => {});
  }, [refresh]);

  const actorName = user?.name || 'Super User';
  const allowed = isSuperUser(user);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter(m => tierFilter === 'all' || m.tier === tierFilter)
      .filter(m => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || (m.role || '').toLowerCase().includes(q))
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }, [members, query, tierFilter]);

  const counts = useMemo(() => {
    const c: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    members.forEach(m => { if (m.status !== 'Terminated' && c[m.tier] !== undefined) c[m.tier]++; });
    return c;
  }, [members]);

  const resetForm = () => { setName(''); setEmail(''); setTier(3); setRole(''); setFormError(''); };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!name.trim() || !email.trim()) { setFormError('Name and email are required.'); return; }
    setSubmitting(true);
    try {
      const label = TIER_LABELS[tier];
      const created = await addMember({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        tier,
        division: label,
        role: role.trim() || label,
        status: 'Active',
        createdBy: user?.email,
        createdAt: new Date().toISOString(),
      });
      refresh();
      setShowForm(false);
      resetForm();
      setNotice(
        created.activationEmailSent
          ? { kind: 'ok', text: `${created.name} was added as ${label}. A set-up email has been sent to ${created.email}.` }
          : { kind: 'error', text: `${created.name} was added as ${label}, but the set-up email could not be delivered${created.activationEmailError ? ` (${created.activationEmailError})` : ''}. Share this link with them directly:`, link: created.activationLink }
      );
    } catch (err: any) {
      setFormError(err?.message || 'Could not add the user.');
    } finally {
      setSubmitting(false);
    }
  };

  const changeTier = (m: Member, next: 1 | 2 | 3 | 4) => {
    if (m.tier === next) return;
    try {
      updateMember(m.id, { tier: next, division: TIER_LABELS[next], ...(m.role === tierLabel(m.tier) ? { role: TIER_LABELS[next] } : {}) }, actorName);
      refresh();
      setNotice({ kind: 'ok', text: `${m.name} is now ${TIER_LABELS[next]}.` });
    } catch (err: any) {
      setNotice({ kind: 'error', text: err?.message || 'Could not change the tier.' });
    }
  };

  const toggleStatus = (m: Member) => {
    try {
      if (m.status === 'Terminated') reactivateMember(m.id, actorName);
      else terminateMember(m.id, actorName);
      refresh();
    } catch (err: any) {
      setNotice({ kind: 'error', text: err?.message || 'Action failed.' });
    }
  };

  const resend = async (m: Member) => {
    setBusyId(m.id);
    try {
      const res = await fetch(`/api/members/${m.id}/resend-activation`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not resend the email.');
      setNotice({ kind: data.emailSent ? 'ok' : 'error', text: data.message, link: data.emailSent ? undefined : data.activationLink });
    } catch (err: any) {
      setNotice({ kind: 'error', text: err?.message || 'Could not resend the email.' });
    } finally {
      setBusyId(null);
    }
  };

  const copyLink = async (link: string) => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  if (user && !allowed) {
    return (
      <div className="glass-panel rounded-2xl p-8 text-center border border-white/10">
        <ShieldCheck className="h-8 w-8 text-accent mx-auto mb-3" />
        <h1 className="text-lg font-bold text-theme-text-primary">Super User access required</h1>
        <p className="text-xs text-theme-text-secondary mt-1">Only a Super User can manage portal users.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary">Users</h1>
          <p className="text-xs text-theme-text-secondary">Create accounts and assign each person to one of the four portal tiers.</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer"
        >
          <UserPlus className="h-4 w-4" /> Add User
        </button>
      </div>

      {/* Tier summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {TIERS.map(t => (
          <button
            key={t.tier}
            onClick={() => setTierFilter(tierFilter === t.tier ? 'all' : t.tier)}
            className={`glass-panel rounded-2xl p-4 text-left border transition-all cursor-pointer ${tierFilter === t.tier ? 'border-accent/60' : 'border-white/10 hover:border-white/25'}`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tierBadge[t.tier]}`}>Tier {t.tier}</span>
              <span className="text-xl font-bold text-theme-text-primary">{counts[t.tier]}</span>
            </div>
            <div className="mt-2 text-sm font-bold text-theme-text-primary">{t.label}</div>
            <div className="text-[11px] text-theme-text-secondary">{t.blurb}</div>
          </button>
        ))}
      </div>

      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-xs flex items-start justify-between gap-3 ${notice.kind === 'ok' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-200'}`}>
          <div className="space-y-2 min-w-0">
            <p>{notice.text}</p>
            {notice.link && (
              <div className="flex items-center gap-2">
                <code className="px-2 py-1 rounded-lg bg-black/30 truncate max-w-[60vw] md:max-w-lg">{notice.link}</code>
                <button onClick={() => copyLink(notice.link!)} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer">
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>
          <button onClick={() => setNotice(null)} className="shrink-0 cursor-pointer" aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-secondary" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search name, email or role"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-theme-sidebar/50 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent"
        />
      </div>

      {/* Table */}
      <div className="glass-panel rounded-2xl border border-white/10 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-theme-text-secondary border-b border-theme-border/20">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-theme-text-secondary">No users match.</td></tr>
            )}
            {visible.map(m => {
              const root = isRootSuperUser(m);
              const terminated = m.status === 'Terminated';
              const pending = !terminated && !m.hasPassword;
              return (
                <tr key={m.id} className={`border-b border-theme-border/10 ${terminated ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-theme-text-primary">{m.name}{root && <span className="ml-2 text-[10px] text-amber-400">(root)</span>}</div>
                    <div className="text-theme-text-secondary">{m.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {root ? (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tierBadge[1]}`}>Super User</span>
                    ) : (
                      <select
                        value={m.tier}
                        onChange={e => changeTier(m, Number(e.target.value) as 1 | 2 | 3 | 4)}
                        disabled={terminated}
                        className="px-2 py-1.5 rounded-lg bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent cursor-pointer"
                      >
                        {TIERS.map(t => <option key={t.tier} value={t.tier}>{t.tier} · {t.label}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {terminated ? <span className="text-danger font-semibold">Terminated</span>
                      : pending ? <span className="text-amber-400 font-semibold">Awaiting set-up</span>
                      : <span className="text-emerald-400 font-semibold">Active</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {pending && (
                        <button onClick={() => resend(m)} disabled={busyId === m.id} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 font-semibold cursor-pointer disabled:opacity-60">
                          {busyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Resend set-up email
                        </button>
                      )}
                      {!root && (
                        <button onClick={() => toggleStatus(m)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${terminated ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25' : 'bg-danger/15 text-danger hover:bg-danger/25'}`}>
                          {terminated ? <><RotateCcw className="h-3.5 w-3.5" /> Reactivate</> : <><Ban className="h-3.5 w-3.5" /> Terminate</>}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add user modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <form onSubmit={handleAdd} onClick={e => e.stopPropagation()} className="glass-panel w-full max-w-md rounded-3xl p-6 space-y-4 border border-white/15 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-theme-text-primary">Add User</h2>
              <button type="button" onClick={() => setShowForm(false)} className="cursor-pointer" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-theme-text-secondary">Full name</span>
              <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent" />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-theme-text-secondary">Email</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent" />
            </label>
            <div className="space-y-1">
              <span className="text-[11px] font-semibold text-theme-text-secondary">Tier</span>
              <div className="grid grid-cols-2 gap-2">
                {TIERS.map(t => (
                  <button
                    key={t.tier}
                    type="button"
                    onClick={() => setTier(t.tier)}
                    className={`px-3 py-2 rounded-xl border text-left text-xs cursor-pointer transition-all ${tier === t.tier ? 'border-accent bg-accent/15 text-theme-text-primary' : 'border-theme-border/30 text-theme-text-secondary hover:border-white/30'}`}
                  >
                    <div className="font-bold">{t.tier} · {t.label}</div>
                    <div className="text-[10px] opacity-80">{t.blurb}</div>
                  </button>
                ))}
              </div>
            </div>
            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-theme-text-secondary">Designation (optional)</span>
              <input value={role} onChange={e => setRole(e.target.value)} placeholder={TIER_LABELS[tier]} className="w-full px-3 py-2.5 rounded-xl bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent" />
            </label>
            {formError && <p className="text-xs text-danger">{formError}</p>}
            <p className="text-[11px] text-theme-text-secondary">They receive an email with a link to set their own password.</p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-xs font-semibold text-theme-text-secondary hover:text-theme-text-primary cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-60">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Add User
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
