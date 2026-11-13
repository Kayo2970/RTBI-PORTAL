'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, ChevronDown, ChevronRight, RefreshCw, Search, Send, Trash2 } from 'lucide-react';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { EventItem, authHeaders, getEffectiveEventStatus, getEventSortTime, getEvents } from '@/lib/local-data';
import { CertificateStatusBadge, CERT_STATUS_FILTERS } from '@/components/certificate-status-badge';
import { CertificateSendDialog, type SendableCertificate } from '@/components/certificate-send-dialog';
import { SortableTh } from '@/components/ui/sortable-th';
import { useSort, type SortGetters } from '@/lib/use-sort';

interface IssuedCert {
  id: string;
  code?: string;
  passId: string;
  eventId: string;
  eventName: string;
  eventDate?: string;
  attendeeName: string;
  attendeeEmail: string;
  organisation?: string;
  category?: string;
  manual?: boolean;
  archivedAt?: string;
  typeId?: string;
  typeName?: string;
  status: string;
  issuedAt?: string;
  sentAt?: string;
  sentBy?: string;
  error?: string;
}

const fmtDateTime = (iso?: string) =>
  iso && !isNaN(Date.parse(iso))
    ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

type EventFilter = 'ALL' | 'ONGOING' | 'COMPLETED' | 'ARCHIVED';

const FILTERS: { key: EventFilter; label: string }[] = [
  { key: 'ALL', label: 'All Events' },
  { key: 'ONGOING', label: 'Ongoing' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'ARCHIVED', label: 'Archived' },
];

// One sort for every event group: clicking a header re-orders the rows inside each group (the groups keep their own order).
const CERT_SORT_GETTERS: SortGetters<IssuedCert> = {
  name: (c) => c.attendeeName,
  type: (c) => c.typeName || 'Participation',
  code: (c) => c.code,
  status: (c) => c.status,
  issuedAt: (c) => c.issuedAt,
  sentAt: (c) => c.sentAt,
};

interface Group {
  eventId: string;
  eventName: string;
  event?: EventItem;
  rows: IssuedCert[];
}

/**
 * Read-only ledger of issued certificates, grouped per event the way the Events page groups events
 * (Ongoing / Completed / Archived tabs). Used under the certificate designer and on the event page (`eventId`).
 */
export function IssuedCertificatesPanel({ eventId, compact = false, canDelete = false, canSend = false }: { eventId?: string; compact?: boolean; canDelete?: boolean; canSend?: boolean }) {
  const [certs, setCerts] = useState<IssuedCert[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<EventFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The certificates handed to the Send dialog: a snapshot taken when it opens, so the list refreshing behind it doesn't reset it.
  const [sendRows, setSendRows] = useState<SendableCertificate[] | null>(null);
  const certSort = useSort();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/certificates/issued${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`, { cache: 'no-store', headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not load issued certificates.');
      setCerts(Array.isArray(data.certificates) ? data.certificates : []);
    } catch (e: any) {
      setError(e?.message || 'Could not load issued certificates.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const read = () => setEvents(getEvents());
    read();
    window.addEventListener('leads-data-sync', read);
    return () => window.removeEventListener('leads-data-sync', read);
  }, []);

  const groups = useMemo<Group[]>(() => {
    const q = search.trim().toLowerCase();
    const byEvent = new Map<string, Group>();
    for (const c of certs) {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) continue;
      if (q && !`${c.attendeeName} ${c.attendeeEmail} ${c.organisation || ''} ${c.code || ''}`.toLowerCase().includes(q)) continue;
      let g = byEvent.get(c.eventId);
      if (!g) {
        g = { eventId: c.eventId, eventName: c.eventName, event: events.find((e) => e.id === c.eventId), rows: [] };
        byEvent.set(c.eventId, g);
      }
      g.rows.push(c);
    }
    const effective = (g: Group) => (g.event ? getEffectiveEventStatus(g.event) : 'completed');
    const rank = (s: string) => (s === 'archived' ? 2 : s === 'completed' ? 1 : 0);
    return [...byEvent.values()]
      .filter((g) => {
        if (filter === 'ALL') return true;
        const s = effective(g);
        if (filter === 'ONGOING') return s === 'planned' || s === 'active';
        if (filter === 'COMPLETED') return s === 'completed';
        return s === 'archived';
      })
      .sort((a, b) => {
        const d = rank(effective(a)) - rank(effective(b));
        if (d !== 0) return d;
        const at = a.event ? getEventSortTime(a.event) : 0;
        const bt = b.event ? getEventSortTime(b.event) : 0;
        return rank(effective(a)) === 0 ? at - bt : bt - at;
      });
  }, [certs, events, filter, statusFilter, search]);

  const togglePick = (ids: string[], on: boolean) => setPicked((prev) => { const n = new Set(prev); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });
  const doDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      const res = await fetch('/api/certificates/issued', { method: 'DELETE', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ ids: [...picked] }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not delete the certificates.');
      setPicked(new Set());
      setConfirmOpen(false);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not delete the certificates.');
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const toggle = (id: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="glass-panel rounded-2xl p-5 space-y-4" data-testid="issued-certificates">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider flex items-center gap-2">
            <Award className="h-4 w-4 text-accent" />
            Issued Certificates ({total})
          </h3>
          <p className="text-[11px] text-theme-text-secondary">Every certificate issued, grouped by event, with its delivery status.</p>
        </div>
        <div className="flex items-center gap-2">
        {canSend && picked.size > 0 && (
          <button type="button" onClick={() => setSendRows(certs.filter((c) => picked.has(c.id)) as SendableCertificate[])} className="px-3 py-1.5 text-xs font-bold rounded-xl bg-accent hover:bg-primary-light text-white flex items-center gap-1.5 cursor-pointer shadow-md shadow-accent/20">
            <Send className="h-3.5 w-3.5" /> Send {picked.size}
          </button>
        )}
        {canDelete && picked.size > 0 && (
          <button type="button" onClick={() => setConfirmOpen(true)} className="px-3 py-1.5 text-xs font-bold rounded-xl bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 cursor-pointer">
            <Trash2 className="h-3.5 w-3.5" /> Delete {picked.size}
          </button>
        )}
        <button type="button" onClick={load} className="px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-slate-800 dark:text-white flex items-center gap-1.5 cursor-pointer">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
        </div>
      </div>

      {!compact && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 bg-slate-100/90 dark:bg-slate-900/80 rounded-2xl p-1.5 border border-slate-200/90 dark:border-white/15">
            {FILTERS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setFilter(t.key)}
                className={`px-3 py-1 text-xs font-bold rounded-xl transition-all cursor-pointer ${filter === t.key ? 'bg-accent text-white shadow-md shadow-accent/25' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-xs text-slate-900 dark:text-white">
            <option value="ALL">All statuses</option>
            {CERT_STATUS_FILTERS.filter((s) => s !== 'Not issued').map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, code…" className="pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-xs text-slate-900 dark:text-white w-56" />
          </div>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
      {!error && !loading && groups.length === 0 && (
        <div className="text-center py-8 text-theme-text-secondary text-xs bg-theme-border/5 rounded-xl border border-theme-border/20">
          No certificates have been issued{filter !== 'ALL' || statusFilter !== 'ALL' || search ? ' for this filter' : ' yet'}.
        </div>
      )}

      <div className="space-y-2.5">
        {groups.map((g) => {
          const isOpen = compact || open.has(g.eventId);
          const sent = g.rows.filter((r) => r.status === 'Sent').length;
          return (
            <div key={g.eventId} className="rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
              <button type="button" onClick={() => toggle(g.eventId)} disabled={compact} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-theme-border/10 cursor-pointer disabled:cursor-default">
                {!compact && (isOpen ? <ChevronDown className="h-4 w-4 text-accent shrink-0" /> : <ChevronRight className="h-4 w-4 text-accent shrink-0" />)}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-theme-text-primary truncate">{g.eventName}</p>
                  <p className="text-[10px] text-theme-text-secondary">{g.event ? getEffectiveEventStatus(g.event) : 'event removed'} · {g.rows.length} certificate{g.rows.length === 1 ? '' : 's'} · {sent} sent</p>
                </div>
              </button>
              {isOpen && (
                <div className="overflow-x-auto border-t border-slate-200 dark:border-white/10">
                  <table className="min-w-full text-xs text-left">
                    <thead>
                      <tr className="text-theme-text-secondary border-b border-theme-border/40">
                        {(canDelete || canSend) && (
                          <th className="py-2 pl-4 w-8">
                            <input type="checkbox" aria-label="Select all in this event" checked={g.rows.every((r) => picked.has(r.id))} onChange={(e) => togglePick(g.rows.map((r) => r.id), e.target.checked)} />
                          </th>
                        )}
                        <SortableTh label="Recipient" columnKey="name" sort={certSort.sort} onToggle={certSort.toggle} className="py-2 px-4 font-semibold" />
                        <SortableTh label="Type" columnKey="type" sort={certSort.sort} onToggle={certSort.toggle} className="py-2 px-4 font-semibold" />
                        <SortableTh label="Code" columnKey="code" sort={certSort.sort} onToggle={certSort.toggle} className="py-2 px-4 font-semibold" />
                        <SortableTh label="Status" columnKey="status" sort={certSort.sort} onToggle={certSort.toggle} className="py-2 px-4 font-semibold" />
                        <SortableTh label="Issued" columnKey="issuedAt" sort={certSort.sort} onToggle={certSort.toggle} className="py-2 px-4 font-semibold" />
                        <SortableTh label="Sent" columnKey="sentAt" sort={certSort.sort} onToggle={certSort.toggle} className="py-2 px-4 font-semibold" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-border/20">
                      {certSort.apply(g.rows, CERT_SORT_GETTERS).map((r) => (
                        <tr key={r.id} className="hover:bg-theme-border/10">
                          {(canDelete || canSend) && (
                            <td className="py-2 pl-4"><input type="checkbox" aria-label={`Select ${r.attendeeName}`} checked={picked.has(r.id)} onChange={(e) => togglePick([r.id], e.target.checked)} /></td>
                          )}
                          <td className="py-2 px-4">
                            <span className="font-semibold text-theme-text-primary">{r.attendeeName}</span>
                            <span className="block text-[10px] text-theme-text-secondary">{r.attendeeEmail}{r.organisation ? ` · ${r.organisation}` : ''}{r.manual ? ' · added manually' : ''}{r.archivedAt ? ' · thumbnail only (30+ days after event)' : ''}</span>
                          </td>
                          <td className="py-2 px-4 text-theme-text-secondary">{r.typeName || 'Participation'}</td>
                          <td className="py-2 px-4 font-mono text-[10px] text-theme-text-secondary">{r.code ? <a href={`/certificate/${r.code}`} target="_blank" rel="noreferrer" className="hover:text-accent underline">{r.code}</a> : '—'}</td>
                          <td className="py-2 px-4"><CertificateStatusBadge status={r.status} sentAt={r.sentAt} issuedAt={r.issuedAt} error={r.error} sentBy={r.sentBy} /></td>
                          <td className="py-2 px-4 text-[11px] text-theme-text-secondary whitespace-nowrap">{fmtDateTime(r.issuedAt)}</td>
                          <td className="py-2 px-4 text-[11px] text-theme-text-secondary whitespace-nowrap">{fmtDateTime(r.sentAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {sendRows && (
        <CertificateSendDialog
          certificates={sendRows}
          onClose={() => setSendRows(null)}
          onDone={() => { setPicked(new Set()); load(); }}
        />
      )}
      <ConfirmModal
        isOpen={confirmOpen}
        title={`Delete ${picked.size} certificate${picked.size === 1 ? '' : 's'}?`}
        message="This permanently removes the selected certificates from the system. Their verification links will stop working. This cannot be undone."
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={doDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
