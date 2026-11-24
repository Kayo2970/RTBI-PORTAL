'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
  Rocket,
  Users,
  RefreshCw,
  ExternalLink,
  Building2,
  CheckCircle2,
  AlertCircle,
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
import { fetchStartups, createStartup, type Startup } from '@/lib/incubation/client';
import { LockedDevicesPanel } from '@/components/locked-devices-panel';

const TIERS: { tier: 1 | 2 | 3 | 4; label: MemberDivision; blurb: string }[] = [
  { tier: 1, label: 'Super User', blurb: 'Full system control' },
  { tier: 2, label: 'CEO', blurb: 'Leadership oversight' },
  { tier: 3, label: 'Employee', blurb: 'Day-to-day operations' },
  { tier: 4, label: 'Startup', blurb: 'Incubated startups' },
];

const tierBadge: Record<number, string> = {
  1: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  2: 'bg-accent/15 text-accent-strong dark:text-accent-soft border-accent/30',
  3: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  4: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
};

export default function UsersPage() {
  const [user, setUser] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [startups, setStartups] = useState<Startup[]>([]);
  const [policies, setPolicies] = useState<GroupPolicy[]>([]);
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<number | 'all'>('all');
  const [activeTab, setActiveTab] = useState<'employees' | 'startup_credentials'>('employees');
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string; link?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Form state for creating user
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [tier, setTier] = useState<1 | 2 | 3 | 4>(3);
  const [role, setRole] = useState('');
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const [selectedStartupId, setSelectedStartupId] = useState('');
  const [newStartupName, setNewStartupName] = useState('');
  const [startupLinkMode, setStartupLinkMode] = useState<'existing' | 'new'>('existing');
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
    fetchStartups().then(setStartups).catch(() => {});
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

  // Filter ONLY employees and staff (tiers 1, 2, 3) — startups are excluded from the employee directory
  const visibleEmployees = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter(m => m.tier !== 4)
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

  // Filter ONLY startup credentials (tier 4) — company profile data lives in Startup Registry
  const visibleStartupCredentials = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter(m => m.tier === 4)
      .filter(m => {
        if (!q) return true;
        const linked = startups.find(s => s.id === m.startupId || s.founderMemberIds?.includes(m.id));
        return (
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          (linked?.name || '').toLowerCase().includes(q) ||
          (linked?.id || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members, startups, query]);

  const counts = useMemo(() => {
    const c: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    members.forEach(m => { if (m.status !== 'Terminated' && c[m.tier] !== undefined) c[m.tier]++; });
    return c;
  }, [members]);

  const resetForm = () => {
    setName('');
    setEmail('');
    setEmployeeId(generateNextEmployeeId(members));
    setTier(activeTab === 'startup_credentials' ? 4 : 3);
    setRole(activeTab === 'startup_credentials' ? 'Startup' : '');
    setSelectedPolicyIds([]);
    setSelectedStartupId('');
    setNewStartupName('');
    setStartupLinkMode('existing');
    setFormError('');
  };

  const handleOpenAddForm = (defaultTier?: 1 | 2 | 3 | 4) => {
    resetForm();
    if (defaultTier) {
      setTier(defaultTier);
      if (defaultTier === 4) setRole('Startup');
    }
    setShowForm(true);
  };

  const handleSyncRegistry = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/incubation/sync', {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to sync with Startup Registry.');
      setNotice({
        kind: 'ok',
        text: `Startup Registry synchronization complete! ${data.linkedMembers || 0} credential(s) linked, ${data.createdStartups || 0} registry record(s) reconciled.`,
      });
      refresh();
    } catch (err: any) {
      setNotice({ kind: 'error', text: err?.message || 'Synchronization failed.' });
    } finally {
      setIsSyncing(false);
    }
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
      let finalStartupId = selectedStartupId;

      // If creating startup credentials (tier 4), link or pre-register with Startup Registry
      if (tier === 4 && startupLinkMode === 'new' && newStartupName.trim()) {
        try {
          const createdStartup = await createStartup({
            name: newStartupName.trim(),
            status: 'Applicant',
          });
          finalStartupId = createdStartup.id;
        } catch (stErr: any) {
          console.error('Failed to pre-register startup in registry:', stErr);
        }
      }

      const finalEmpId = tier === 4 ? undefined : (employeeId.trim() || generateNextEmployeeId(members));
      const created = await addMember({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        employeeId: finalEmpId,
        startupId: tier === 4 ? (finalStartupId || undefined) : undefined,
        policyIds: tier === 4 ? [] : selectedPolicyIds,
        tier,
        division: label,
        role: role.trim() || label,
        status: 'Active',
        createdBy: user?.email,
        createdAt: new Date().toISOString(),
      });

      // Synchronize policies with targetMemberIds in group policies for employees
      if (created?.id && tier !== 4 && selectedPolicyIds.length > 0) {
        syncMemberPolicies(created.id, selectedPolicyIds, actorName);
      }

      // If tier 4, trigger registry sync to ensure bidirectional link
      if (tier === 4) {
        fetch('/api/incubation/sync', { method: 'POST', headers: authHeaders() }).catch(() => {});
      }

      refresh();
      setShowForm(false);
      resetForm();
      setNotice(
        created.activationEmailSent
          ? {
              kind: 'ok',
              text: `${created.name} was added as ${label}${finalEmpId ? ` (${finalEmpId})` : ''}. A set-up email has been sent to ${created.email}.`,
            }
          : {
              kind: 'error',
              text: `${created.name} was added as ${label}, but the set-up email could not be delivered${created.activationEmailError ? ` (${created.activationEmailError})` : ''}. Share this link with them directly:`,
              link: created.activationLink,
            }
      );
    } catch (err: any) {
      setFormError(err?.message || 'Could not add the user.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleExternal = (m: Member) => {
    try {
      updateMember(m.id, { externalReviewer: !m.externalReviewer }, actorName);
      refresh();
      setNotice({ kind: 'ok', text: `${m.name} ${!m.externalReviewer ? 'is now an external reviewer: they can only score applications assigned to them.' : 'is no longer an external reviewer.'}` });
    } catch (err: any) {
      setNotice({ kind: 'error', text: err?.message || 'Could not change the reviewer setting.' });
    }
  };

  const changeTier = (m: Member, next: 1 | 2 | 3 | 4) => {
    if (m.tier === next) return;
    try {
      updateMember(m.id, { tier: next, division: TIER_LABELS[next], ...(next !== 3 && m.externalReviewer ? { externalReviewer: false } : {}), ...(m.role === tierLabel(m.tier) ? { role: TIER_LABELS[next] } : {}) }, actorName);
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
        <ShieldCheck className="h-8 w-8 text-accent-strong dark:text-accent-soft mx-auto mb-3" />
        <h1 className="text-lg font-bold text-theme-text-primary">Super User access required</h1>
        <p className="text-xs text-theme-text-secondary mt-1">Only a Super User can manage portal users.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary">Users &amp; Access Management</h1>
          <p className="text-xs text-theme-text-secondary">
            Provision Employee IDs for staff and maintain authentication credentials synchronized with the Startup Registry.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'startup_credentials' && (
            <button
              onClick={handleSyncRegistry}
              disabled={isSyncing}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-purple-500/30 hover:bg-purple-500/15 text-purple-300 text-xs font-semibold cursor-pointer disabled:opacity-50 transition-all"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing…' : 'Sync Registry'}
            </button>
          )}
          <button
            onClick={() => handleOpenAddForm(activeTab === 'startup_credentials' ? 4 : 3)}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer"
          >
            <UserPlus className="h-4 w-4" />
            {activeTab === 'startup_credentials' ? 'Add Startup Credentials' : 'Add Employee / Staff'}
          </button>
        </div>
      </div>

      {/* Tier summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {TIERS.map(t => {
          const isSelected =
            t.tier === 4
              ? activeTab === 'startup_credentials'
              : activeTab === 'employees' && tierFilter === t.tier;

          return (
            <button
              key={t.tier}
              onClick={() => {
                if (t.tier === 4) {
                  setActiveTab('startup_credentials');
                  setTierFilter(4);
                } else {
                  setActiveTab('employees');
                  setTierFilter(tierFilter === t.tier ? 'all' : t.tier);
                }
              }}
              className={`glass-panel rounded-2xl p-4 text-left border transition-all cursor-pointer ${
                isSelected ? 'border-accent/60 bg-accent/5' : 'border-white/10 hover:border-white/25'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${tierBadge[t.tier]}`}>
                  Tier {t.tier}
                </span>
                <span className="text-xl font-bold text-theme-text-primary">{counts[t.tier]}</span>
              </div>
              <div className="mt-2 text-sm font-bold text-theme-text-primary">{t.label}</div>
              <div className="text-xs text-theme-text-secondary">{t.blurb}</div>
            </button>
          );
        })}
      </div>

      {/* Primary Directory Views Switcher */}
      <div className="flex border-b border-theme-border/20 gap-2 pb-2">
        <button
          onClick={() => {
            setActiveTab('employees');
            if (tierFilter === 4) setTierFilter('all');
          }}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'employees'
              ? 'bg-accent/15 text-accent-strong dark:text-accent-soft border border-accent/30 shadow-sm'
              : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-white/5'
          }`}
        >
          <Users className="h-4 w-4" />
          Employees &amp; Staff Directory
          <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-white/10 font-mono">
            {counts[1] + counts[2] + counts[3]}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveTab('startup_credentials');
            setTierFilter(4);
          }}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'startup_credentials'
              ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30 shadow-sm'
              : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-white/5'
          }`}
        >
          <Rocket className="h-4 w-4" />
          Startup Auth Credentials
          <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono">
            {counts[4]}
          </span>
        </button>
      </div>

      {/* Startup Credentials Banner */}
      {activeTab === 'startup_credentials' && (
        <div className="glass-panel rounded-2xl p-4 border border-purple-500/20 bg-purple-500/5 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1 max-w-xl">
            <div className="flex items-center gap-2 font-bold text-xs text-purple-300">
              <Rocket className="h-4 w-4 text-purple-400" />
              Startup Credentials Directory
            </div>
            <p className="text-xs text-theme-text-secondary">
              This directory contains <b>user authentication credentials only</b> for startup founders.
              Comprehensive company profiles, sectors, DPIIT registrations, TRL evaluations, and milestones reside in the <b>Startup Registry</b>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/incubation"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md shadow-purple-600/20 transition-all cursor-pointer"
            >
              Open Startup Registry <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

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

      {/* Search Input */}
      <div className="relative max-w-sm">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-secondary" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={
            activeTab === 'startup_credentials'
              ? 'Search startup credentials by founder, email, or startup name'
              : 'Search employees by name, Employee ID, email or role'
          }
          className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-theme-sidebar/50 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent"
        />
      </div>

      {/* Employees Directory Table */}
      {activeTab === 'employees' && (
        <div className="glass-panel rounded-2xl border border-white/10 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-theme-text-secondary border-b border-theme-border/20">
                <th className="px-4 py-3">Employee &amp; Email</th>
                <th className="px-4 py-3">Employee ID</th>
                <th className="px-4 py-3">Tier &amp; Role</th>
                <th className="px-4 py-3">Active Policies &amp; Grants</th>
                <th className="px-4 py-3">Account Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-theme-text-secondary">
                    No employees match the search criteria.
                  </td>
                </tr>
              )}
              {visibleEmployees.map(m => {
                const root = isRootSuperUser(m);
                const terminated = m.status === 'Terminated';
                const pending = !terminated && !m.hasPassword;
                const effectivePolicies = getEffectiveMemberPolicies(m, policies);

                return (
                  <tr key={m.id} className={`border-b border-theme-border/10 ${terminated ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-theme-text-primary flex items-center gap-1.5">
                        {m.name}
                        {root && <span className="text-xs text-amber-700 dark:text-amber-300 font-semibold">(root)</span>}
                      </div>
                      <div className="text-theme-text-secondary text-xs">{m.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {m.employeeId ? (
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-accent/15 text-accent-strong dark:text-accent-soft border border-accent/25">
                          {m.employeeId}
                        </span>
                      ) : (
                        <span className="text-theme-text-secondary text-xs italic">Not assigned</span>
                      )}
                      {m.tier === 3 && !root && (
                        <label className="mt-1.5 flex items-center gap-1.5 text-xs text-theme-text-secondary cursor-pointer" title="External specialist reviewer: sees only the applications assigned to them, nothing else in the portal.">
                          <input type="checkbox" checked={!!m.externalReviewer} disabled={terminated} onChange={() => toggleExternal(m)} /> External reviewer
                        </label>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        {root ? (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${tierBadge[1]}`}>
                            Super User
                          </span>
                        ) : (
                          <select
                            value={m.tier}
                            onChange={e => changeTier(m, Number(e.target.value) as 1 | 2 | 3 | 4)}
                            disabled={terminated}
                            className="px-2 py-1 rounded-lg bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent cursor-pointer"
                          >
                            {TIERS.filter(t => t.tier < 4).map(t => (
                              <option key={t.tier} value={t.tier}>
                                {t.tier} · {t.label}
                              </option>
                            ))}
                          </select>
                        )}
                        <div className="text-xs text-theme-text-secondary">{m.role || tierLabel(m.tier)}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      {effectivePolicies.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {effectivePolicies.map(p => (
                            <span
                              key={p.id}
                              title={`${p.name} (${p.capabilities?.length || 0} capabilities)`}
                              className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary-light border border-primary/25"
                            >
                              {p.tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-theme-text-secondary">Default Tier Access</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {terminated ? (
                        <span className="text-danger dark:text-danger-soft font-semibold">Terminated</span>
                      ) : pending ? (
                        <span className="text-amber-700 dark:text-amber-300 font-semibold">Awaiting set-up</span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-300 font-semibold">Active</span>
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
                          <span className="text-xs">Access</span>
                        </button>

                        {pending && (
                          <button
                            onClick={() => resend(m)}
                            disabled={busyId === m.id}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent/15 text-accent-strong dark:text-accent-soft hover:bg-accent/25 font-semibold cursor-pointer disabled:opacity-60"
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
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25'
                                : 'bg-danger/15 text-danger dark:text-danger-soft hover:bg-danger/25'
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
      )}

      {/* Startup Credentials Table */}
      {activeTab === 'startup_credentials' && (
        <div className="glass-panel rounded-2xl border border-white/10 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-theme-text-secondary border-b border-theme-border/20">
                <th className="px-4 py-3">Founder &amp; Auth Email</th>
                <th className="px-4 py-3">Linked Startup in Registry</th>
                <th className="px-4 py-3">Registry Sync Status</th>
                <th className="px-4 py-3">Credential Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleStartupCredentials.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-theme-text-secondary">
                    No startup credentials match your search.
                  </td>
                </tr>
              )}
              {visibleStartupCredentials.map(m => {
                const terminated = m.status === 'Terminated';
                const pending = !terminated && !m.hasPassword;
                const linkedStartup = startups.find(s => s.id === m.startupId || s.founderMemberIds?.includes(m.id));

                return (
                  <tr key={m.id} className={`border-b border-theme-border/10 ${terminated ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-theme-text-primary flex items-center gap-1.5">
                        {m.name}
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${tierBadge[4]}`}>
                          Founder
                        </span>
                      </div>
                      <div className="text-theme-text-secondary text-xs font-mono">{m.email}</div>
                    </td>

                    <td className="px-4 py-3">
                      {linkedStartup ? (
                        <div className="space-y-0.5">
                          <Link
                            href="/dashboard/incubation"
                            className="font-bold text-theme-text-primary hover:text-accent flex items-center gap-1"
                          >
                            <Building2 className="h-3.5 w-3.5 text-accent-strong dark:text-accent-soft" />
                            {linkedStartup.name}
                            <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                          </Link>
                          <div className="flex items-center gap-1.5 text-xs text-theme-text-secondary font-mono">
                            <span className="px-1.5 py-0.2 rounded bg-white/10">{linkedStartup.id}</span>
                            {linkedStartup.sector && <span>· {linkedStartup.sector}</span>}
                          </div>
                        </div>
                      ) : (
                        <div className="text-amber-700 dark:text-amber-300 text-xs flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <span>Not linked to registry</span>
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {linkedStartup ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Synced with Registry
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                          <AlertCircle className="h-3.5 w-3.5" /> Unlinked
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {terminated ? (
                        <span className="text-danger dark:text-danger-soft font-semibold">Terminated</span>
                      ) : pending ? (
                        <span className="text-amber-700 dark:text-amber-300 font-semibold">Awaiting set-up</span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-300 font-semibold">Active</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          href="/dashboard/incubation"
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-theme-border/20 hover:bg-accent/15 text-theme-text-secondary hover:text-accent font-semibold transition-all cursor-pointer"
                          title="View all details in the Startup Registry"
                        >
                          <Building2 className="h-3.5 w-3.5" />
                          <span className="text-xs">View in Registry</span>
                        </Link>

                        {pending && (
                          <button
                            onClick={() => resend(m)}
                            disabled={busyId === m.id}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent/15 text-accent-strong dark:text-accent-soft hover:bg-accent/25 font-semibold cursor-pointer disabled:opacity-60"
                          >
                            {busyId === m.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Mail className="h-3.5 w-3.5" />
                            )}
                            Resend
                          </button>
                        )}

                        <button
                          onClick={() => toggleStatus(m)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${
                            terminated
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25'
                              : 'bg-danger/15 text-danger dark:text-danger-soft hover:bg-danger/25'
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
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add User / Startup Credentials Modal */}
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
                <h2 className="text-base font-bold text-theme-text-primary">
                  {tier === 4 ? 'Provision Startup Founder Credentials' : 'Add User / Employee'}
                </h2>
                <p className="text-xs text-theme-text-secondary">
                  {tier === 4
                    ? 'Provisions login credentials for the startup founder. Company profile data is managed in the Startup Registry.'
                    : 'Provision an Employee ID and define their exact access boundaries.'}
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
                <span className="text-xs font-semibold text-theme-text-secondary">
                  {tier === 4 ? 'Founder Full Name *' : 'Full Name *'}
                </span>
                <input
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={tier === 4 ? 'e.g. Rahul Sharma' : 'e.g. Priya Sharma'}
                  className="w-full px-3 py-2 rounded-xl bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-theme-text-secondary">
                  {tier === 4 ? 'Founder Login Email *' : 'Email Address *'}
                </span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={tier === 4 ? 'founder@startup.com' : 'priya@rtbi.in'}
                  className="w-full px-3 py-2 rounded-xl bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent"
                />
              </label>
            </div>

            {/* Employee ID input — hidden for startups because startups are not employees */}
            {tier !== 4 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-theme-text-secondary">
                    Employee ID / Identity Code
                  </span>
                  <button
                    type="button"
                    onClick={() => setEmployeeId(generateNextEmployeeId(members))}
                    className="flex items-center gap-1 text-xs font-semibold text-accent-strong dark:text-accent-soft hover:underline cursor-pointer"
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
                <p className="text-xs text-theme-text-secondary">
                  Used for cross-referencing group policies, physical badges, attendance, and audit logs.
                </p>
              </div>
            )}

            {/* Startup Registry Linkage for Tier 4 */}
            {tier === 4 && (
              <div className="space-y-3 p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                    <Rocket className="h-3.5 w-3.5" /> Startup Registry Link
                  </span>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setStartupLinkMode('existing')}
                      className={`px-2 py-0.5 rounded-md font-semibold cursor-pointer ${
                        startupLinkMode === 'existing'
                          ? 'bg-purple-600 text-white'
                          : 'text-purple-300 hover:bg-purple-500/20'
                      }`}
                    >
                      Existing Startup
                    </button>
                    <button
                      type="button"
                      onClick={() => setStartupLinkMode('new')}
                      className={`px-2 py-0.5 rounded-md font-semibold cursor-pointer ${
                        startupLinkMode === 'new'
                          ? 'bg-purple-600 text-white'
                          : 'text-purple-300 hover:bg-purple-500/20'
                      }`}
                    >
                      New Startup
                    </button>
                  </div>
                </div>

                {startupLinkMode === 'existing' ? (
                  <div className="space-y-1">
                    <label className="text-xs text-theme-text-secondary block">
                      Select Startup from Registry:
                    </label>
                    <select
                      value={selectedStartupId}
                      onChange={e => setSelectedStartupId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-theme-sidebar/80 border border-theme-border/40 text-xs text-theme-text-primary outline-none focus:border-accent cursor-pointer"
                    >
                      <option value="">— Link later / Self-register on activation —</option>
                      {startups.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.id}) · {s.status}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-xs text-theme-text-secondary block">
                      New Startup Name:
                    </label>
                    <input
                      value={newStartupName}
                      onChange={e => setNewStartupName(e.target.value)}
                      placeholder="e.g. SolarGrid Technologies"
                      className="w-full px-3 py-2 rounded-xl bg-theme-sidebar/80 border border-theme-border/40 text-xs text-theme-text-primary outline-none focus:border-accent"
                    />
                    <p className="text-xs text-theme-text-secondary">
                      This will initialize a new record in the Startup Registry with ID RTBI-S-XXXX-XXX.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Tier selection */}
            <div className="space-y-1">
              <span className="text-xs font-semibold text-theme-text-secondary">Portal Tier</span>
              <div className="grid grid-cols-2 gap-2">
                {TIERS.map(t => (
                  <button
                    key={t.tier}
                    type="button"
                    onClick={() => {
                      setTier(t.tier);
                      if (t.tier === 4) setRole('Startup');
                    }}
                    className={`px-3 py-2 rounded-xl border text-left text-xs cursor-pointer transition-all ${
                      tier === t.tier
                        ? 'border-accent bg-accent/15 text-theme-text-primary'
                        : 'border-theme-border/30 text-theme-text-secondary hover:border-white/30'
                    }`}
                  >
                    <div className="font-bold">
                      {t.tier} · {t.label}
                    </div>
                    <div className="text-xs opacity-80">{t.blurb}</div>
                  </button>
                ))}
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-theme-text-secondary">
                {tier === 4 ? 'Credential Role' : 'Designation / Role Title'}
              </span>
              <input
                value={role}
                onChange={e => setRole(e.target.value)}
                placeholder={TIER_LABELS[tier]}
                className="w-full px-3 py-2 rounded-xl bg-theme-sidebar/60 border border-theme-border/30 text-xs text-theme-text-primary outline-none focus:border-accent"
              />
            </label>

            {/* Initial Access & Group Policies Section (Employees Only) */}
            {tier !== 4 && (
              <div className="space-y-2 pt-2 border-t border-theme-border/20">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-theme-text-primary flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-accent-strong dark:text-accent-soft" /> Group Policies &amp; Access Grants
                    </span>
                    <p className="text-xs text-theme-text-secondary">
                      Select exactly what this person can access from day one.
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-accent-strong dark:text-accent-soft">
                    {selectedPolicyIds.length} selected
                  </span>
                </div>

                {policies.length === 0 ? (
                  <div className="p-3 rounded-xl bg-theme-border/10 text-center text-xs text-theme-text-secondary">
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
                            onChange={() => {}}
                            className="accent-accent mt-0.5 pointer-events-none"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-xs text-theme-text-primary">{p.name}</span>
                              <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent-strong dark:text-accent-soft font-bold">
                                {p.tag}
                              </span>
                            </div>
                            {p.description && (
                              <p className="text-xs text-theme-text-secondary line-clamp-1">{p.description}</p>
                            )}
                            <div className="text-xs text-theme-text-secondary mt-0.5">
                              {p.capabilities?.length || 0} capabilities granted
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {formError && <p className="text-xs text-danger dark:text-danger-soft">{formError}</p>}

            <div className="flex items-center justify-between pt-2 border-t border-theme-border/20">
              <span className="text-xs text-theme-text-secondary">
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
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {tier === 4 ? 'Create Credentials' : 'Create & Grant Access'}
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
                  <ShieldCheck className="h-5 w-5 text-accent-strong dark:text-accent-soft" />
                  Manage Access &amp; Employee ID
                </h2>
                <p className="text-xs text-theme-text-secondary">
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
                <div className="text-xs text-theme-text-secondary">{managingMember.email}</div>
              </div>
              <div className="text-right">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${tierBadge[managingMember.tier]}`}>
                  Tier {managingMember.tier} · {managingMember.division}
                </span>
                <div className="text-xs text-theme-text-secondary mt-1">{managingMember.role}</div>
              </div>
            </div>

            {/* Employee ID Field */}
            {managingMember.tier !== 4 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-theme-text-secondary">
                    Employee ID / Identity Code
                  </label>
                  {!editEmployeeId && (
                    <button
                      type="button"
                      onClick={() => setEditEmployeeId(generateNextEmployeeId(members))}
                      className="flex items-center gap-1 text-xs font-semibold text-accent-strong dark:text-accent-soft hover:underline cursor-pointer"
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
            )}

            {/* Group Policies Selection */}
            {managingMember.tier !== 4 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-theme-text-secondary">
                    Assigned Group Policies ({editPolicyIds.length})
                  </span>
                  <span className="text-xs text-theme-text-secondary">
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
                              <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent-strong dark:text-accent-soft font-bold">
                                {p.tag}
                              </span>
                            </div>
                            {p.description && (
                              <p className="text-xs text-theme-text-secondary line-clamp-1">{p.description}</p>
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
            )}

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
