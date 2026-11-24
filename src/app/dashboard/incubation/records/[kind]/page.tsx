'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, FileDown, FolderOpen, Plus, Search } from 'lucide-react';
import { downloadCsv, toCsvRow } from '@/lib/csv';
import { KINDS, kindFields, type KindDef } from '@/lib/incubation/kinds';
import { groupFields } from '@/lib/incubation/sections';
import { createRecord, fetchEvidenceExport, fetchIncubationSettings, fetchMembersLite, fetchRecords, fetchStartups, updateRecord } from '@/lib/incubation/client';
import { downloadPdf } from '@/lib/incubation/pdf';
import type { IncubationSettings, Startup } from '@/lib/incubation/types';
import { Badge, FieldInput, PageHeader, btnGhost, btnPrimary, inputCls, isManagerUi, isStaffUi, ragClass, useCurrentUser } from '@/components/incubation/ui';
import { Drawer } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge as KitBadge, statusTone } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { formatDate } from '@/lib/format';

const WRITE_HINT = { managers: 'CEO / Super User', staff: 'RTBI staff' } as const;
const STATUS_COLS = ['state', 'status', 'rag', 'band', 'outcome', 'timeliness'];
const PAGE_SIZES = [10, 25, 50];
const DRAFT_KEY = (kind: string, id: string) => `rtbi-draft:${kind}:${id}`;

type Sort = { col: string; dir: 'asc' | 'desc' } | null;

export default function RecordsPage() {
  const { kind } = useParams<{ kind: string }>();
  const def: KindDef | undefined = KINDS[kind];
  const user = useCurrentUser();
  const [settings, setSettings] = useState<IncubationSettings | null>(null);
  const [startups, setStartups] = useState<Startup[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string; tier: number }[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [startupFilter, setStartupFilter] = useState('');
  const [sort, setSort] = useState<Sort>(null);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refRecords, setRefRecords] = useState<Record<string, { id: string; label: string }[]>>({});

  const search = useSearchParams();
  const manager = isManagerUi(user);
  const canWrite = !!def && (def.write === 'managers' ? manager : isStaffUi(user));

  const load = useCallback(async () => {
    if (!def) return;
    setLoading(true);
    try {
      const [s, st, r] = await Promise.all([fetchIncubationSettings(), fetchStartups(), fetchRecords(kind)]);
      setSettings(s); setStartups(st); setRows(r); setError('');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [def, kind]);

  useEffect(() => { setQuery(''); setStatusFilter(''); setStartupFilter(search.get('startup') || ''); setSort(null); setPage(0); setSelected(new Set()); setRows([]); load(); }, [load]);
  useEffect(() => {
    if (!def || !settings) return;
    const refs = kindFields(def, settings).filter(f => f.type === 'record' && f.refKind);
    refs.forEach(f => fetchRecords(f.refKind!).then(list => setRefRecords(p => ({ ...p, [f.refKind!]: list.map(r => ({ id: r.id, label: String(r[f.refLabel || 'name'] ?? r.id) })) }))).catch(() => {}));
  }, [def, settings]);
  useEffect(() => { if (isStaffUi(user)) fetchMembersLite().then(setMembers).catch(() => setMembers([])); }, [user]);

  const openId = search.get('open');
  const openedRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!openId || openedRef.current === openId || !rows.length) return;
    const r = rows.find(x => x.id === openId);
    if (r) { openedRef.current = openId; setEditing(r); }
  }, [openId, rows]);

  const memberName = useCallback((id?: string) => members.find(m => m.id === id)?.name || id || '—', [members]);
  const startupName = useCallback((id?: string) => startups.find(s => s.id === id)?.name || id || '—', [startups]);
  const fields = useMemo(() => (def && settings ? kindFields(def, settings) : []), [def, settings]);

  /** Plain-text value of a cell (used for search, sort and CSV). */
  const textOf = useCallback((r: any, col: string): string => {
    const v = r[col];
    const f = fields.find(x => x.key === col);
    if (v === undefined || v === null || v === '') return '';
    if (col === 'startupId') return `${startupName(v)} ${v}`;
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (f?.type === 'record') return refRecords[f.refKind || '']?.find(x => x.id === v)?.label || String(v);
    if (f?.type === 'member' || (col.endsWith('Id') && col !== 'startupId' && col !== 'assessmentId')) return memberName(v);
    if (f?.type === 'date') return formatDate(v);
    return String(v);
  }, [fields, refRecords, startupName, memberName]);

  const statusCol = useMemo(() => def?.columns.find(c => STATUS_COLS.includes(c)), [def]);
  const statusOptions = useMemo(() => (statusCol ? Array.from(new Set(rows.map(r => r[statusCol]).filter(Boolean))).sort() as string[] : []), [rows, statusCol]);

  const visible = useMemo(() => {
    if (!def) return [];
    const q = query.trim().toLowerCase();
    let list = rows.filter(r => (!statusFilter || r[statusCol!] === statusFilter) && (!startupFilter || r.startupId === startupFilter)
      && (!q || def.columns.some(c => textOf(r, c).toLowerCase().includes(q))));
    if (sort) {
      const f = fields.find(x => x.key === sort.col);
      list = [...list].sort((a, b) => {
        const av = f?.type === 'number' ? Number(a[sort.col] ?? 0) : textOf(a, sort.col).toLowerCase();
        const bv = f?.type === 'number' ? Number(b[sort.col] ?? 0) : textOf(b, sort.col).toLowerCase();
        return (av < bv ? -1 : av > bv ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1);
      });
    }
    return list;
  }, [rows, query, statusFilter, startupFilter, sort, def, statusCol, textOf, fields]);

  useEffect(() => setPage(0), [query, statusFilter, startupFilter, pageSize]);
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const pageRows = visible.slice(page * pageSize, page * pageSize + pageSize);

  if (!def) return <div className="p-8 text-sm">Unknown register.</div>;

  const label = (col: string) => fields.find(f => f.key === col)?.label.replace(/ \(.*/, '') || ({ startupId: 'Startup', assessmentId: 'Assessment ID', state: 'State', band: 'Band', total: 'Score', timeliness: 'Timeliness', status: 'Status' } as Record<string, string>)[col] || col;

  const exportCsv = (list: any[], what: string) => {
    const head = def.columns.map(label);
    downloadCsv(`rtbi-${def.kind}-${new Date().toISOString().slice(0, 10)}.csv`, [toCsvRow(head), ...list.map(r => toCsvRow(def.columns.map(c => textOf(r, c))))].join('\n'));
    toast.success(`Exported ${list.length} ${list.length === 1 ? 'row' : 'rows'}`, { description: what });
  };

  const exportEvidence = async () => {
    try {
      const { rows: out } = await fetchEvidenceExport();
      const head = ['Evidence ID', 'KPI', 'Title', 'Document ref', 'Date', 'Startup', 'Responsible officer', 'Verified by', 'Funding stage', 'Amount (INR)', 'Document link'];
      downloadCsv(`rtbi-evidence-${new Date().toISOString().slice(0, 10)}.csv`, [toCsvRow(head), ...out.map(r => toCsvRow([r.id, r.kpi, r.title, r.docRef, r.date, r.startup, r.responsible, r.verifier, r.fundingStage, r.amount, r.documentLink]))].join('\n'));
      toast.success('Evidence export ready', { description: 'Startups are named only where consent is recorded.' });
    } catch (e: any) { toast.error('Export failed', { description: e.message }); }
  };

  const cell = (r: any, col: string) => {
    const v = r[col];
    const f = fields.find(x => x.key === col);
    if (v === undefined || v === null || v === '') return <span className="text-theme-text-secondary">—</span>;
    if (col === 'startupId') return <span><span className="font-semibold">{startupName(v)}</span> <span className="text-theme-text-secondary text-xs">{v}</span></span>;
    if (col === 'rag') return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ragClass[v] || ''}`}>{v}</span>;
    if (typeof v === 'boolean') return v ? <span aria-label="Yes">✓</span> : <span className="text-theme-text-secondary" aria-label="No">—</span>;
    if (STATUS_COLS.includes(col)) return <KitBadge tone={statusTone(v)}>{String(v)}</KitBadge>;
    return textOf(r, col);
  };

  const pdfFor = (r: any) => {
    const sid = r.startupId;
    const sName = startupName(sid);
    if (def.kind === 'exit') return () => downloadPdf(`exit-${sid}.pdf`, 'Exit acknowledgement', `${sid} — ${sName}`, [
      { heading: 'Basis', lines: [r.reason || ''] }, { heading: 'Clearance', lines: [`Programme: ${r.clearProgramme ? 'signed' : 'pending'}`, `Finance / facilities: ${r.clearFinance ? 'signed' : 'pending'}`, `Authorised officer: ${r.clearOfficer ? 'signed' : 'pending'}`] },
      { lines: [r.exitAcknowledged ? 'Exit acknowledgement received.' : 'Exit acknowledgement pending.'] }]);
    if (def.kind === 'graduation' && r.finalised && r.approvalRef && r.letterIssued) return () => downloadPdf(`graduation-${sid}.pdf`, 'Graduation letter', `${sid} — ${sName}`, [
      { lines: [`This is to confirm the outcome of the graduation review: ${r.outcome}.`, `Score: ${r.total} (${r.band}). Approval reference: ${r.approvalRef}.`] }]);
    return null;
  };

  const toggleSort = (col: string) => setSort(s => (s?.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null));
  const allOnPage = pageRows.length > 0 && pageRows.every(r => selected.has(r.id));
  const togglePage = () => setSelected(s => { const n = new Set(s); pageRows.forEach(r => (allOnPage ? n.delete(r.id) : n.add(r.id))); return n; });
  const filtersActive = !!(query || statusFilter || startupFilter);

  return (
    <div className="p-6 md:p-8 space-y-5">
      <PageHeader title={def.plural} subtitle={def.description}
        actions={<>
          {def.kind === 'evidence' && isStaffUi(user) && <button className={btnGhost} onClick={exportEvidence} title="Consent-gated: startups are named and documents linked only where consent is recorded."><Download className="h-4 w-4" aria-hidden="true" /> Export for KITS</button>}
          <button className={btnGhost} onClick={() => exportCsv(visible, filtersActive ? 'Filtered rows' : 'All rows')} disabled={visible.length === 0}><Download className="h-4 w-4" aria-hidden="true" /> Export CSV</button>
          {canWrite && <button className={btnPrimary} onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden="true" /> Add {def.label.toLowerCase()}</button>}
        </>} />

      {!canWrite && !loading && <p className="text-sm text-theme-text-secondary">Read-only for you. Adding or editing here is for {WRITE_HINT[def.write]}.</p>}
      {error && <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>}

      <div className="flex flex-wrap items-center gap-3" role="search">
        <div className="relative flex-1 min-w-56 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-text-secondary" aria-hidden="true" />
          <input aria-label={`Search ${def.plural}`} className={inputCls + ' pl-10'} placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        {def.startupScoped && startups.length > 0 && (
          <select aria-label="Filter by startup" className={inputCls + ' !w-auto max-w-56'} value={startupFilter} onChange={e => setStartupFilter(e.target.value)}>
            <option value="">All startups</option>{startups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {statusCol && statusOptions.length > 0 && (
          <select aria-label={`Filter by ${label(statusCol)}`} className={inputCls + ' !w-auto'} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All {label(statusCol).toLowerCase()}</option>{statusOptions.map(o => <option key={o}>{o}</option>)}
          </select>
        )}
        {filtersActive && <button className="min-h-11 px-3 text-sm font-semibold text-accent-strong dark:text-accent-soft underline" onClick={() => { setQuery(''); setStatusFilter(''); setStartupFilter(''); }}>Clear filters</button>}
        <p className="text-sm text-theme-text-secondary ml-auto" role="status">{visible.length} of {rows.length}</p>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 dark:bg-white/10 px-4 py-2.5" role="region" aria-label="Bulk actions">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <button className={btnGhost} onClick={() => exportCsv(rows.filter(r => selected.has(r.id)), 'Selected rows')}><Download className="h-4 w-4" aria-hidden="true" /> Export selected</button>
          <button className="min-h-11 px-3 text-sm font-semibold underline" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading records">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={FolderOpen} title={`No ${def.plural.toLowerCase()} yet`} description={canWrite ? `Add the first ${def.label.toLowerCase()} to start this register.` : `Nothing has been recorded here yet. Adding records is for ${WRITE_HINT[def.write]}.`} actionLabel={canWrite ? `Add ${def.label.toLowerCase()}` : undefined} onAction={canWrite ? () => setEditing('new') : undefined} />
      ) : visible.length === 0 ? (
        <EmptyState icon={Search} title="No matching records" description="Try a different search or clear the filters." />
      ) : (
        <div className="glass-panel rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{def.plural}</caption>
            <thead>
              <tr className="text-left text-theme-text-secondary border-b border-theme-border">
                <th scope="col" className="p-3 w-12"><input type="checkbox" className="h-5 w-5 accent-[var(--color-primary)]" aria-label="Select all rows on this page" checked={allOnPage} onChange={togglePage} /></th>
                {def.columns.map(c => {
                  const on = sort?.col === c;
                  return (
                    <th key={c} scope="col" className="p-1" aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" onClick={() => toggleSort(c)} className="inline-flex items-center gap-1.5 min-h-11 px-2 rounded-lg font-semibold hover:bg-theme-border/20 hover:text-theme-text-primary">
                        {label(c)}{on ? (sort!.dir === 'asc' ? <ArrowUp className="h-4 w-4" aria-hidden="true" /> : <ArrowDown className="h-4 w-4" aria-hidden="true" />) : <ArrowUpDown className="h-4 w-4 opacity-50" aria-hidden="true" />}
                      </button>
                    </th>
                  );
                })}
                <th scope="col" className="p-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(r => {
                const pdf = pdfFor(r);
                const title = textOf(r, def.columns[0]) || r.id;
                return (
                  <tr key={r.id} className={`border-b border-theme-border/60 ${selected.has(r.id) ? 'bg-primary/5 dark:bg-white/5' : ''}`}>
                    <td className="p-3"><input type="checkbox" className="h-5 w-5 accent-[var(--color-primary)]" aria-label={`Select ${title}`} checked={selected.has(r.id)} onChange={() => setSelected(s => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} /></td>
                    {def.columns.map(c => <td key={c} className="p-3 align-middle">{cell(r, c)}</td>)}
                    <td className="p-2 text-right whitespace-nowrap">
                      {pdf && <button onClick={pdf} aria-label={`Download PDF for ${title}`} className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-sm font-semibold text-accent-strong dark:text-accent-soft hover:bg-theme-border/20"><FileDown className="h-4 w-4" aria-hidden="true" /> PDF</button>}
                      <button onClick={() => setEditing(r)} aria-label={`${canWrite ? 'Open and edit' : 'View'} ${title}`} className="inline-flex items-center min-h-11 px-3 rounded-lg text-sm font-semibold text-accent-strong dark:text-accent-soft hover:bg-theme-border/20">{canWrite ? 'Open / edit' : 'View'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 border-t border-theme-border text-sm">
            <label className="flex items-center gap-2 text-theme-text-secondary">Rows per page
              <select className={inputCls + ' !w-auto'} value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>{PAGE_SIZES.map(n => <option key={n}>{n}</option>)}</select>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-theme-text-secondary" aria-live="polite">Page {page + 1} of {pages}</span>
              <button className={btnGhost + ' !px-3'} aria-label="Previous page" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
              <button className={btnGhost + ' !px-3'} aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          </div>
        </div>
      )}

      {editing && settings && (
        <RecordEditor def={def} fields={fields} record={editing === 'new' ? null : editing} startups={startups} members={members} records={refRecords} canWrite={canWrite} manager={manager}
          onClose={() => setEditing(null)} onSaved={(isNew) => { setEditing(null); toast.success(isNew ? `${def.label} added` : `${def.label} saved`); load(); }} />
      )}
    </div>
  );
}

function RecordEditor({ def, fields, record, startups, members, records, canWrite, manager, onClose, onSaved }: {
  def: KindDef; fields: ReturnType<typeof kindFields>; record: any | null; startups: Startup[]; members: { id: string; name: string }[]; records: Record<string, { id: string; label: string }[]>;
  canWrite: boolean; manager: boolean; onClose: () => void; onSaved: (isNew: boolean) => void;
}) {
  const draftKey = DRAFT_KEY(def.kind, record?.id || 'new');
  const [v, setV] = useState<Record<string, any>>(() => ({ ...(record || {}) }));
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sections = useMemo(() => groupFields(def.kind, fields), [def.kind, fields]);
  const stepped = sections.length > 1 && fields.length > 8;
  const [step, setStep] = useState(0);

  // Restore an unsaved draft (per register + record) once.
  useEffect(() => {
    if (!canWrite) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) { setV(prev => ({ ...prev, ...JSON.parse(raw) })); setRestored(true); setDirty(true); }
    } catch { /* storage unavailable */ }
  }, [draftKey, canWrite]);
  // Autosave the draft shortly after each change (files are never drafted: they can be large).
  useEffect(() => {
    if (!dirty || !canWrite) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify(Object.fromEntries(Object.entries(v).filter(([k]) => fields.find(f => f.key === k)?.type !== 'file')))); } catch { /* ignore */ }
    }, 500);
    return () => clearTimeout(t);
  }, [v, dirty, draftKey, fields, canWrite]);

  const set = (k: string, x: any) => { setV(p => ({ ...p, [k]: x })); setDirty(true); setErrors(e => { if (!e[k]) return e; const { [k]: _, ...rest } = e; return rest; }); };
  const discardDraft = () => { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } setV({ ...(record || {}) }); setRestored(false); setDirty(false); };

  const missing = (f: typeof fields[number]) => f.required && f.type !== 'checkbox' && (v[f.key] === undefined || v[f.key] === '' || v[f.key] === null);
  const sectionDone = (i: number) => sections[i].fields.every(f => !missing(f));

  const save = async () => {
    const errs: Record<string, string> = {};
    fields.forEach(f => { if (missing(f)) errs[f.key] = `${f.label.replace(/ \(.*/, '')} is required.`; });
    setErrors(errs);
    if (Object.keys(errs).length) {
      const firstSection = sections.findIndex(s => s.fields.some(f => errs[f.key]));
      if (stepped && firstSection >= 0) setStep(firstSection);
      setErr(`Please complete ${Object.keys(errs).length} required field${Object.keys(errs).length === 1 ? '' : 's'}.`);
      return;
    }
    setSaving(true); setErr('');
    try {
      const body: Record<string, any> = {};
      for (const f of fields) {
        if (f.type === 'file') { if (v[f.key]?.dataUrl) body[f.key] = v[f.key]; continue; }
        body[f.key] = v[f.key];
      }
      if (record) await updateRecord(def.kind, record.id, body); else await createRecord(def.kind, body);
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      onSaved(!record);
    } catch (e: any) { setErr(e.message); toast.error('Could not save', { description: e.message }); setSaving(false); }
  };

  const derived = record ? Object.entries(record).filter(([k]) => ['assessmentId', 'status', 'confirmedTrl', 'state', 'total', 'band', 'settingsStatus', 'followUp6', 'followUp12', 'timeliness'].includes(k)) : [];
  const shown = stepped ? [sections[step]] : sections;
  const disabledFor = (f: typeof fields[number]) => !canWrite || (f.managerOnly && !manager) || (!!record && f.key === 'startupId');

  return (
    <Drawer open onClose={onClose} size="lg" dismissible={!saving}
      title={record ? `${def.label}${record.assessmentId ? ` ${record.assessmentId}` : ''}` : `Add ${def.label.toLowerCase()}`}
      description={canWrite ? 'Required fields are marked *. Your draft is saved on this device as you type.' : 'You can view this record but not change it.'}
      footer={<>
        <button type="button" className={btnGhost} onClick={onClose}>{canWrite ? 'Cancel' : 'Close'}</button>
        {stepped && step > 0 && <button type="button" className={btnGhost} onClick={() => setStep(s => s - 1)}>Back</button>}
        {stepped && step < sections.length - 1 && <button type="button" className={btnGhost} onClick={() => setStep(s => s + 1)}>Next: {sections[step + 1].title}</button>}
        {canWrite && <button type="button" className={btnPrimary} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>}
      </>}>
      <div className="space-y-5">
        {restored && (
          <p role="status" className="flex flex-wrap items-center gap-3 text-sm rounded-xl border border-sky-300 bg-sky-50 text-sky-900 dark:bg-sky-500/15 dark:text-sky-100 px-4 py-2.5">
            Unsaved draft restored. <button type="button" className="font-semibold underline min-h-11" onClick={discardDraft}>Discard draft</button>
          </p>
        )}
        {derived.length > 0 && <div className="flex flex-wrap gap-2">{derived.map(([k, x]) => <Badge key={k} tone={k === 'settingsStatus' && x === 'proposed' ? 'amber' : 'blue'}>{k === 'settingsStatus' ? `weights ${x}` : `${k}: ${String(x)}`}</Badge>)}</div>}
        {err && <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300">{err}</p>}

        {stepped && (
          <nav aria-label="Form sections">
            <p className="text-sm font-semibold mb-2" aria-live="polite">Step {step + 1} of {sections.length}: {sections[step].title}</p>
            <div className="h-2 rounded-full bg-theme-border/40 overflow-hidden mb-3" role="progressbar" aria-valuemin={0} aria-valuemax={sections.length} aria-valuenow={step + 1} aria-label="Form progress"><div className="h-full bg-primary dark:bg-accent-soft transition-all" style={{ width: `${((step + 1) / sections.length) * 100}%` }} /></div>
            <ol className="flex flex-wrap gap-2">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}
                    className={`min-h-10 px-3.5 rounded-full border text-sm font-semibold ${i === step ? 'bg-primary text-white border-primary dark:bg-white/15 dark:border-white/30' : 'border-theme-border hover:bg-theme-border/20'}`}>
                    {s.title}{sectionDone(i) ? <span className="sr-only"> (complete)</span> : null}{canWrite && !sectionDone(i) ? <span className="ml-1 text-rose-700 dark:text-rose-300" aria-label="has required fields">*</span> : null}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}

        {shown.map(sec => (
          <fieldset key={sec.id} className="space-y-3">
            {(!stepped && sections.length > 1) && <legend className="text-base font-bold mb-1">{sec.title}</legend>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sec.fields.map(f => <FieldInput key={f.key} f={f} value={v[f.key]} onChange={x => set(f.key, x)} startups={startups} members={members} records={records} error={errors[f.key]} disabled={disabledFor(f)} />)}
            </div>
          </fieldset>
        ))}

        {record?.changeLog?.length > 0 && (
          <details className="text-sm"><summary className="cursor-pointer font-semibold min-h-11 flex items-center">Change log ({record.changeLog.length})</summary>
            <ul className="mt-1 space-y-1 text-theme-text-secondary">{record.changeLog.slice().reverse().map((c: any, i: number) => <li key={i}>{formatDate(c.at)} — {c.field}: {String(c.from ?? '—')} → {String(c.to ?? '—')}</li>)}</ul></details>
        )}
      </div>
    </Drawer>
  );
}
