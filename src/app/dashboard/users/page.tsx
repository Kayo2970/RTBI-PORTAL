'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UserPlus,
  Search,
  X,
  Mail,
  ShieldCheck,
  Ban,
  RotateCcw,
  Loader2,
  Copy,
  Check,
  Shield,
  Key,
  Sparkles,
  Info,
} from 'lucide-react';
import {
  getMembers,
  addMember,
  updateMember,
  terminateMember,
  reactivateMember,
  syncWithServer,
  authHeaders,
  isRootSuperUser,
  getGroupPolicies,
  getEffectiveMemberPolicies,
  syncMemberPolicies,
  generateNextEmployeeId,
  type Member,
  type MemberDivision,
  type GroupPolicy,
} from '@/lib/local-data';
import { TIER_LABELS, tierLabel, isSuperUser, CAPABILITY_CATALOG } from '@/lib/permissions';
import { LockedDevicesPanel } from '@/components/locked-devices-panel';

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
  const [policies, setPolicies] = useState<GroupPolicy[]>([]);
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<number | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string; link?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Form state for creating user
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [tier, setTier] = useState<1 | 2 | 3 | 4>(3);
  const [role, setRole] = useState('');
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Access Management Modal for existing user
  const [managingMember, setManagingMember] = useState<Member | null>(null);
  const [editEmployeeId, setEditEmployeeId] = useState('');
  const [editPolicyIds, setEditPolicyIds] = useState<string[]>([]);
  const [isSavingAccess, setIsSavingAccess] = useState(false);

  const refresh = useCallback(() => {
    setMembers(getMembers());
    setPolicies(getGroupPolicies());
  }, []);

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
      .filter(m =>
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        (m.employeeId || '').toLowerCase().includes(q) ||
        (m.role || '').toLowerCase().includes(q)
      )
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }, [members, query, tierFilter]);

  const counts = useMemo(() => {
    const c: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    members.forEach(m => { if (m.status !== 'Terminated' && c[m.tier] !== undefined) c[m.tier]++; });
    return c;
  }, [members]);

  const resetForm = () => {
    setName('');
    setEmail('');
    setEmployeeId(generateNextEmployeeId(members));
    setTier(3);
    setRole('');
    setSelectedPolicyIds([]);
    setFormError('');
  };

  const handleOpenAddForm = () => {
    resetForm();
    setShowForm(true);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!name.trim() || !email.trim()) {
      setFormError('Name and email are required.');
      return;
    }
    setSubmitting(true);
    try {
      const label = TIER_LABELS[tier];
      const finalEmpId = employeeId.trim() || generateNextEmployeeId(members);
      const created = await addMember({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        employeeId: finalEmpId,
        policyIds: selectedPolicyIds,
        tier,
        division: label,
        role: role.trim() || label,
        status: 'Active',
        createdBy: user?.email,
        createdAt: new Date().toISOString(),
      });

      // Synchronize policies with targetMemberIds in group policies
      if (created?.id && selectedPolicyIds.length > 0) {
        syncMemberPolicies(created.id, selectedPolicyIds, actorName);
      }

      refresh();
      setShowForm(false);
      resetForm();
      setNotice(
        created.activationEmailSent
          ? { kind: 'ok', text: `${created.name} (${finalEmpId}) was added as ${label} with ${selectedPolicyIds.length} policy tag(s). A set-up email has been sent to ${created.email}.` }
          : { kind: 'error', text: `${created.name} (${finalEmpId}) was added as ${label}, but the set-up email could not be delivered${created.activationEmailError ? ` (${created.activationEmailError})` : ''}. Share this link with them directly:`, link: created.activationLink }
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
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const openManageAccess = (m: Member) => {
    setManagingMember(m);
    setEditEmployeeId(m.employeeId || '');
    const effective = getEffectiveMemberPolicies(m, policies);
    setEditPolicyIds(effective.map(p => p.id));
  };

  const handleSaveAccess = async () => {
    if (!managingMember) return;
    setIsSavingAccess(true);
    try {
      const trimmedEmpId = editEmployeeId.trim();
      updateMember(
        managingMember.id,
        {
          employeeId: trimmedEmpId || undefined,
          policyIds: editPolicyIds,
        },
        actorName
      );
      syncMemberPolicies(managingMember.id, editPolicyIds, actorName);
      refresh();
      setNotice({
        kind: 'ok',
        text: `Access permissions & Employee ID for ${managingMember.name} updated (${editPolicyIds.length} active policy tag${editPolicyIds.length === 1 ? '' : 's'}).`,
      });
      setManagingMember(null);
    } catch (err: any) {
      setNotice({ kind: 'error', text: err?.message || 'Failed to update access.' });
    } finally {
      setIsSavingAccess(false);
    }
  };

  const togglePolicySelection = (policyId: string, isCreateForm: boolean) => {
    if (isCreateForm) {
      setSelectedPolicyIds(prev =>
        prev.includes(policyId) ? prev.filter(id => id !== policyId) : [...prev, policyId]
      );
    } else {
      setEditPolicyIds(prev =>
        prev.includes(policyId) ? prev.filter(id => id !== policyId) : [...prev, policyId]
      );
    }
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
          <h1 className="text-xl font-bold text-theme-text-primary">Users & Access Management</h1>
          <p className="text-xs text-theme-text-secondary">
            Assign Employee IDs, set portal tiers, and grant fine-grained group policy permissions at creation time.
          </p>
        </div>
        <button
          onClick={handleOpenAddForm}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer"
        >
          <UserPlus className="h-4 w-4" /> Add User / Employee
        </button>
      </div>

      {/* Tier summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {TIERS.map(t => (
          <button
            key={t.tier}
            onClick={() => setTierFilter(tierFilter === t.tier ? 'all' : t.tier)}
            className={`glass-panel rounded-2xl p-4 text-left border transition-all cursor-pointer ${
              tierFilter === t.tier ? 'border-accent/60' : 'border-white/10 hover:border-white/25'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tierBadge[t.tier]}`}>
                Tier {t.tier}
              </span>
              <span className="text-xl font-bold text-theme-text-primary">{counts[t.tier]}</span>
            </div>
            <div className="mt-2 text-sm font-bold text-theme-text-primary">{t.label}</div>
            <div className="text-[11px] text-theme-text-secondary">{t.blurb}</div>
          </button>
        ))}
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs flex items-start justify-between gap-3 ${
            notice.kind === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
          }`}
        >
          <div className="space-y-2 min-w-0">
            <p>{notice.text}</p>
            {notice.link && (
              <div className="flex items-center gap-2">
                <code className="px-2 py-1 rounded-lg bg-black/30 truncate max-w-[60vw] md:max-w-lg">
                  {notice.link}
                </code>
                <button
                  onClick={() => copyLink(notice.link!)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{' '}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>
          <button onClick={() => setNotice(null)} className="shrink-0 cursor-pointer" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-secondary" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name, Employee ID, email or role"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-theme-sidebar/50 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent"
        />
      </div>

      {/* Table */}
      <div className="glass-panel rounded-2xl border border-white/10 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-theme-text-secondary border-b border-theme-border/20">
              <th className="px-4 py-3">User &amp; Email</th>
              <th className="px-4 py-3">Employee ID</th>
              <th className="px-4 py-3">Tier &amp; Role</th>
              <th className="px-4 py-3">Active Policies &amp; Grants</th>
              <th className="px-4 py-3">Account Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-theme-text-secondary">
                  No users match the search criteria.
                </td>
              </tr>
            )}
            {visible.map(m => {
              const root = isRootSuperUser(m);
              const terminated = m.status === 'Terminated';
              const pending = !terminated && !m.hasPassword;
              const effectivePolicies = getEffectiveMemberPolicies(m, policies);

              return (
                <tr key={m.id} className={`border-b border-theme-border/10 ${terminated ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-theme-text-primary flex items-center gap-1.5">
                      {m.name}
                      {root && <span className="text-[10px] text-amber-400 font-semibold">(root)</span>}
                    </div>
                    <div className="text-theme-text-secondary text-[11px]">{m.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {m.employeeId ? (
                      <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-md bg-accent/15 text-accent border border-accent/25">
                        {m.employeeId}
                      </span>
                    ) : (
                      <span className="text-theme-text-secondary text-[11px] italic">Not assigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {root ? (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tierBadge[1]}`}>
                          Super User
                        </span>
                      ) : (
                        <select
                          value={m.tier}
                          onChange={e => changeTier(m, Number(e.target.value) as 1 | 2 | 3 | 4)}
                          disabled={terminated}
                          className="px-2 py-1 rounded-lg bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent cursor-pointer"
                        >
                          {TIERS.map(t => (
                            <option key={t.tier} value={t.tier}>
                              {t.tier} · {t.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <div className="text-[10px] text-theme-text-secondary">{m.role || tierLabel(m.tier)}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    {effectivePolicies.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {effectivePolicies.map(p => (
                          <span
                            key={p.id}
                            title={`${p.name} (${p.capabilities?.length || 0} capabilities)`}
                            className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary-light border border-primary/25"
                          >
                            {p.tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-theme-text-secondary">Default Tier Access</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {terminated ? (
                      <span className="text-danger font-semibold">Terminated</span>
                    ) : pending ? (
                      <span className="text-amber-400 font-semibold">Awaiting set-up</span>
                    ) : (
                      <span className="text-emerald-400 font-semibold">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => openManageAccess(m)}
                        title="Manage Employee ID & Access Policies"
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-theme-border/20 hover:bg-accent/15 text-theme-text-secondary hover:text-accent font-semibold transition-all cursor-pointer"
                      >
                        <Shield className="h-3.5 w-3.5" />
                        <span className="text-[11px]">Access</span>
                      </button>

                      {pending && (
                        <button
                          onClick={() => resend(m)}
                          disabled={busyId === m.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 font-semibold cursor-pointer disabled:opacity-60"
                        >
                          {busyId === m.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Mail className="h-3.5 w-3.5" />
                          )}
                          Resend
                        </button>
                      )}

                      {!root && (
                        <button
                          onClick={() => toggleStatus(m)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${
                            terminated
                              ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                              : 'bg-danger/15 text-danger hover:bg-danger/25'
                          }`}
                        >
                          {terminated ? (
                            <>
                              <RotateCcw className="h-3.5 w-3.5" /> Reactivate
                            </>
                          ) : (
                            <>
                              <Ban className="h-3.5 w-3.5" /> Terminate
                            </>
                          )}
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowForm(false)}
        >
          <form
            onSubmit={handleAdd}
            onClick={e => e.stopPropagation()}
            className="glass-panel w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl p-6 space-y-4 border border-white/15 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-theme-border/20 pb-3">
              <div>
                <h2 className="text-base font-bold text-theme-text-primary">Add User / Employee</h2>
                <p className="text-[11px] text-theme-text-secondary">
                  Provision an Employee ID and define their exact access boundaries.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="p-1 hover:bg-white/10 rounded-lg cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-theme-text-secondary">Full Name *</span>
                <input
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Priya Sharma"
                  className="w-full px-3 py-2 rounded-xl bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-theme-text-secondary">Email Address *</span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="priya@rtbi.in"
                  className="w-full px-3 py-2 rounded-xl bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent"
                />
              </label>
            </div>

            {/* Employee ID input */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-theme-text-secondary">
                  Employee ID / Identity Code
                </span>
                <button
                  type="button"
                  onClick={() => setEmployeeId(generateNextEmployeeId(members))}
                  className="flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline cursor-pointer"
                >
                  <Sparkles className="h-3 w-3" /> Auto-generate Next
                </button>
              </div>
              <input
                value={employeeId}
                onChange={e => setEmployeeId(e.target.value)}
                placeholder="RTBI-EMP-001"
                className="w-full px-3 py-2 rounded-xl bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary font-mono focus:border-accent outline-none"
              />
              <p className="text-[10px] text-theme-text-secondary">
                Used for cross-referencing group policies, physical badges, attendance, and audit logs.
              </p>
            </div>

            {/* Tier selection */}
            <div className="space-y-1">
              <span className="text-[11px] font-semibold text-theme-text-secondary">Portal Tier</span>
              <div className="grid grid-cols-2 gap-2">
                {TIERS.map(t => (
                  <button
                    key={t.tier}
                    type="button"
                    onClick={() => setTier(t.tier)}
                    className={`px-3 py-2 rounded-xl border text-left text-xs cursor-pointer transition-all ${
                      tier === t.tier
                        ? 'border-accent bg-accent/15 text-theme-text-primary'
                        : 'border-theme-border/30 text-theme-text-secondary hover:border-white/30'
                    }`}
                  >
                    <div className="font-bold">
                      {t.tier} · {t.label}
                    </div>
                    <div className="text-[10px] opacity-80">{t.blurb}</div>
                  </button>
                ))}
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-theme-text-secondary">Designation / Role Title</span>
              <input
                value={role}
                onChange={e => setRole(e.target.value)}
                placeholder={TIER_LABELS[tier]}
                className="w-full px-3 py-2 rounded-xl bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent"
              />
            </label>

            {/* Initial Access & Group Policies Section */}
            <div className="space-y-2 pt-2 border-t border-theme-border/20">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-theme-text-primary flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-accent" /> Group Policies &amp; Access Grants
                  </span>
                  <p className="text-[10px] text-theme-text-secondary">
                    Select exactly what this person can access from day one.
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-accent">
                  {selectedPolicyIds.length} selected
                </span>
              </div>

              {policies.length === 0 ? (
                <div className="p-3 rounded-xl bg-theme-border/10 text-center text-[11px] text-theme-text-secondary">
                  No custom group policies exist yet. The employee will receive standard Tier {tier} defaults.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {policies.map(p => {
                    const isSelected = selectedPolicyIds.includes(p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => togglePolicySelection(p.id, true)}
                        className={`flex items-start gap-2.5 p-2 rounded-xl border text-left cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-accent/15 border-accent/40 text-theme-text-primary'
                            : 'bg-theme-sidebar/40 border-theme-border/30 hover:border-theme-border/50 text-theme-text-secondary'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // handled by parent onClick
                          className="accent-accent mt-0.5 pointer-events-none"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-theme-text-primary">{p.name}</span>
                            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-bold">
                              {p.tag}
                            </span>
                          </div>
                          {p.description && (
                            <p className="text-[10px] text-theme-text-secondary line-clamp-1">{p.description}</p>
                          )}
                          <div className="text-[9px] text-theme-text-secondary/80 mt-0.5">
                            {p.capabilities?.length || 0} capabilities granted
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {formError && <p className="text-xs text-danger">{formError}</p>}

            <div className="flex items-center justify-between pt-2 border-t border-theme-border/20">
              <span className="text-[10px] text-theme-text-secondary">
                A password setup link will be emailed automatically.
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-theme-text-secondary hover:text-theme-text-primary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-60 shadow-md shadow-accent/20"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Create &amp; Grant Access
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Manage Access Modal */}
      {managingMember && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setManagingMember(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="glass-panel w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl p-6 space-y-4 border border-white/15 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-theme-border/20 pb-3">
              <div>
                <h2 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-accent" />
                  Manage Access &amp; Employee ID
                </h2>
                <p className="text-[11px] text-theme-text-secondary">
                  Update identity details and active group policy assignments for {managingMember.name}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManagingMember(null)}
                className="p-1 hover:bg-white/10 rounded-lg cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Member Card Summary */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-theme-sidebar/60 border border-theme-border/30">
              <div>
                <div className="font-bold text-sm text-theme-text-primary">{managingMember.name}</div>
                <div className="text-[11px] text-theme-text-secondary">{managingMember.email}</div>
              </div>
              <div className="text-right">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tierBadge[managingMember.tier]}`}>
                  Tier {managingMember.tier} · {managingMember.division}
                </span>
                <div className="text-[10px] text-theme-text-secondary mt-1">{managingMember.role}</div>
              </div>
            </div>

            {/* Employee ID Field */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-theme-text-secondary">
                  Employee ID / Identity Code
                </label>
                {!editEmployeeId && (
                  <button
                    type="button"
                    onClick={() => setEditEmployeeId(generateNextEmployeeId(members))}
                    className="flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline cursor-pointer"
                  >
                    <Sparkles className="h-3 w-3" /> Generate ID
                  </button>
                )}
              </div>
              <input
                value={editEmployeeId}
                onChange={e => setEditEmployeeId(e.target.value)}
                placeholder="RTBI-EMP-001"
                className="w-full px-3 py-2 rounded-xl bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary font-mono focus:border-accent outline-none"
              />
            </div>

            {/* Group Policies Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-theme-text-secondary">
                  Assigned Group Policies ({editPolicyIds.length})
                </span>
                <span className="text-[10px] text-theme-text-secondary">
                  Changes take effect immediately on next request
                </span>
              </div>

              {policies.length === 0 ? (
                <div className="p-4 rounded-xl bg-theme-sidebar/40 text-center text-xs text-theme-text-secondary">
                  No group policies configured.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {policies.map(p => {
                    const isChecked = editPolicyIds.includes(p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => togglePolicySelection(p.id, false)}
                        className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                          isChecked
                            ? 'bg-accent/15 border-accent/40 text-theme-text-primary'
                            : 'bg-theme-sidebar/40 border-theme-border/30 hover:border-theme-border/50 text-theme-text-secondary'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="accent-accent mt-0.5 pointer-events-none"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-theme-text-primary">{p.name}</span>
                            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-bold">
                              {p.tag}
                            </span>
                          </div>
                          {p.description && (
                            <p className="text-[10px] text-theme-text-secondary line-clamp-1">{p.description}</p>
                          )}
                          <div className="flex flex-wrap gap-1 mt-1">
                            {p.capabilities?.slice(0, 3).map(cap => {
                              const match = CAPABILITY_CATALOG.find(c => c.key === cap);
                              return (
                                <span
                                  key={cap}
                                  className="text-[8px] font-semibold px-1.5 py-0.2 rounded bg-primary/10 text-primary-light"
                                >
                                  {match?.label || cap}
                                </span>
                              );
                            })}
                            {(p.capabilities?.length || 0) > 3 && (
                              <span className="text-[8px] text-theme-text-secondary">
                                +{(p.capabilities?.length || 0) - 3} more
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-theme-border/20">
              <button
                type="button"
                onClick={() => setManagingMember(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-theme-text-secondary hover:text-theme-text-primary cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAccess}
                disabled={isSavingAccess}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-60 shadow-md shadow-accent/20"
              >
                {isSavingAccess && <Loader2 className="h-4 w-4 animate-spin" />} Save Permissions
              </button>
            </div>
          </div>
        </div>
      )}

      <LockedDevicesPanel />
    </div>
  );
}
