'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Plus, Loader2, FileDown, Download } from 'lucide-react';
import { downloadCsv, toCsvRow } from '@/lib/csv';
import { KINDS, KIND_ORDER, kindFields, type KindDef } from '@/lib/incubation/kinds';
import { createRecord, fetchEvidenceExport, fetchIncubationSettings, fetchMembersLite, fetchRecords, fetchStartups, updateRecord } from '@/lib/incubation/client';
import { downloadPdf } from '@/lib/incubation/pdf';
import type { IncubationSettings, Startup } from '@/lib/incubation/types';
import { Badge, FieldInput, Modal, PageHeader, btnGhost, btnPrimary, inputCls, isManagerUi, isStaffUi, ragClass, useCurrentUser } from '@/components/incubation/ui';

const WRITE_HINT = { managers: 'CEO / Super User', staff: 'RTBI staff' } as const;

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
  const [filter, setFilter] = useState('');
  const [refRecords, setRefRecords] = useState<Record<string, { id: string; label: string }[]>>({});

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

  useEffect(() => { load(); }, [load]);
  // Reference pickers (e.g. mentor on a mentor session) — load the referenced register once the field list is known.
  useEffect(() => {
    if (!def || !settings) return;
    const refs = kindFields(def, settings).filter(f => f.type === 'record' && f.refKind);
    refs.forEach(f => fetchRecords(f.refKind!).then(list => setRefRecords(p => ({ ...p, [f.refKind!]: list.map(r => ({ id: r.id, label: String(r[f.refLabel || 'name'] ?? r.id) })) }))).catch(() => {}));
  }, [def, settings]);
  useEffect(() => { if (isStaffUi(user)) fetchMembersLite().then(setMembers).catch(() => setMembers([])); }, [user]);

  const name = useCallback((id?: string) => members.find(m => m.id === id)?.name || id || '—', [members]);
  const fields = useMemo(() => (def && settings ? kindFields(def, settings) : []), [def, settings]);
  const visible = useMemo(() => rows.filter(r => !filter || JSON.stringify(r).toLowerCase().includes(filter.toLowerCase())), [rows, filter]);

  if (!def) return <div className="p-8 text-xs">Unknown register.</div>;

  const exportEvidence = async () => {
    try {
      const { rows: out } = await fetchEvidenceExport();
      const head = ['Evidence ID', 'KPI', 'Title', 'Document ref', 'Date', 'Startup', 'Responsible officer', 'Verified by', 'Funding stage', 'Amount (INR)', 'Document link'];
      downloadCsv(`rtbi-evidence-${new Date().toISOString().slice(0, 10)}.csv`, [toCsvRow(head), ...out.map(r => toCsvRow([r.id, r.kpi, r.title, r.docRef, r.date, r.startup, r.responsible, r.verifier, r.fundingStage, r.amount, r.documentLink]))].join('\n'));
    } catch (e: any) { setError(e.message); }
  };

  const cell = (r: any, col: string) => {
    const v = r[col];
    const f = fields.find(x => x.key === col);
    if (col === 'rag' && v) return <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${ragClass[v] || ''}`}>{v}</span>;
    if (typeof v === 'boolean') return v ? '✓' : '—';
    if (f?.type === 'record') return refRecords[f.refKind || '']?.find(r => r.id === v)?.label || v || '—';
    if (f?.type === 'member' || col.endsWith('Id') && col !== 'startupId' && col !== 'assessmentId') return name(v);
    if (['state', 'status', 'band', 'timeliness'].includes(col) && v) return <Badge tone={/final|executed|confirmed|eligible|on time|closed|done/i.test(v) ? 'green' : /pending|provisional|late|conditional|draft|open/i.test(v) ? 'amber' : 'default'}>{v}</Badge>;
    return v === undefined || v === '' ? '—' : String(v);
  };
  const label = (col: string) => fields.find(f => f.key === col)?.label.replace(/ \(.*/, '') || { assessmentId: 'Assessment ID', state: 'State', band: 'Band', total: 'Score', timeliness: 'Timeliness', status: 'Status' }[col] || col;

  const pdfFor = (r: any) => {
    const sid = r.startupId;
    const sName = startups.find(s => s.id === sid)?.name || sid;
    if (def.kind === 'exit') return () => downloadPdf(`exit-${sid}.pdf`, 'Exit acknowledgement', `${sid} — ${sName}`, [
      { heading: 'Basis', lines: [r.reason || ''] }, { heading: 'Clearance', lines: [`Programme: ${r.clearProgramme ? 'signed' : 'pending'}`, `Finance / facilities: ${r.clearFinance ? 'signed' : 'pending'}`, `Authorised officer: ${r.clearOfficer ? 'signed' : 'pending'}`] },
      { lines: [r.exitAcknowledged ? 'Exit acknowledgement received.' : 'Exit acknowledgement pending.'] }]);
    if (def.kind === 'graduation' && r.finalised && r.approvalRef && r.letterIssued) return () => downloadPdf(`graduation-${sid}.pdf`, 'Graduation letter', `${sid} — ${sName}`, [
      { lines: [`This is to confirm the outcome of the graduation review: ${r.outcome}.`, `Score: ${r.total} (${r.band}). Approval reference: ${r.approvalRef}.`] }]);
    return null;
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader title={def.plural} subtitle={def.description}
        actions={<>
          {def.kind === 'evidence' && isStaffUi(user) && <button className={btnGhost} onClick={exportEvidence} title="Consent-gated: startups are named and documents linked only where consent is recorded."><Download size={14} /> Export for KITS (CSV)</button>}
          {canWrite && <button className={btnPrimary} onClick={() => setEditing('new')}><Plus size={14} /> Add</button>}
        </>} />
      <div className="flex flex-wrap gap-1.5">
        {KIND_ORDER.filter(k => !KINDS[k].restricted || manager).map(k => (
          <Link key={k} href={`/dashboard/incubation/records/${k}`} className={`px-2.5 py-1 rounded-full border text-[11px] ${k === kind ? 'bg-accent text-white border-accent' : 'border-theme-border/40 hover:bg-theme-background/40'}`}>{KINDS[k].plural}</Link>
        ))}
      </div>
      <input className={inputCls + ' max-w-sm'} placeholder="Search…" value={filter} onChange={e => setFilter(e.target.value)} />
      {!canWrite && <p className="text-[11px] text-theme-text-secondary">Read-only for you. Adding or editing here is for {WRITE_HINT[def.write]}.</p>}
      {error && <div className="text-xs text-red-400">{error}</div>}
      {loading ? <div className="text-xs flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div> : visible.length === 0 ? (
        <div className="glass-panel rounded-2xl p-8 text-center text-xs text-theme-text-secondary">Nothing here yet.</div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-theme-text-secondary border-b border-theme-border/30">{def.columns.map(c => <th key={c} className="p-3">{label(c)}</th>)}<th className="p-3" /></tr></thead>
            <tbody>
              {visible.map(r => {
                const pdf = pdfFor(r);
                return (
                  <tr key={r.id} className="border-b border-theme-border/20">
                    {def.columns.map(c => <td key={c} className="p-3">{cell(r, c)}</td>)}
                    <td className="p-3 text-right whitespace-nowrap">
                      {pdf && <button onClick={pdf} className="text-accent font-semibold mr-3 inline-flex items-center gap-1"><FileDown size={12} /> PDF</button>}
                      <button onClick={() => setEditing(r)} className="text-accent font-semibold">{canWrite ? 'Open / edit' : 'View'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && settings && (
        <RecordEditor def={def} fields={fields} record={editing === 'new' ? null : editing} startups={startups} members={members} records={refRecords} canWrite={canWrite} manager={manager}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function RecordEditor({ def, fields, record, startups, members, records, canWrite, manager, onClose, onSaved }: {
  def: KindDef; fields: ReturnType<typeof kindFields>; record: any | null; startups: Startup[]; members: { id: string; name: string }[]; records: Record<string, { id: string; label: string }[]>;
  canWrite: boolean; manager: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [v, setV] = useState<Record<string, any>>(() => ({ ...(record || {}) }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setSaving(true); setErr('');
    try {
      const body: Record<string, any> = {};
      for (const f of fields) {
        if (f.type === 'file') { if (v[f.key]?.dataUrl) body[f.key] = v[f.key]; continue; }
        body[f.key] = v[f.key];
      }
      if (record) await updateRecord(def.kind, record.id, body); else await createRecord(def.kind, body);
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  };
  const derived = record ? Object.entries(record).filter(([k]) => ['assessmentId', 'status', 'confirmedTrl', 'state', 'total', 'band', 'settingsStatus', 'followUp6', 'followUp12', 'timeliness'].includes(k)) : [];
  return (
    <Modal title={record ? `${def.label}${record.assessmentId ? ` ${record.assessmentId}` : ''}` : `Add ${def.label.toLowerCase()}`} onClose={onClose} wide>
      {derived.length > 0 && <div className="flex flex-wrap gap-2 text-[11px]">{derived.map(([k, x]) => <Badge key={k} tone={k === 'settingsStatus' && x === 'proposed' ? 'amber' : 'blue'}>{k === 'settingsStatus' ? `weights ${x}` : `${k}: ${String(x)}`}</Badge>)}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map(f => (
          <FieldInput key={f.key} f={f} value={v[f.key]} onChange={x => setV(p => ({ ...p, [f.key]: x }))} startups={startups} members={members} records={records}
            disabled={!canWrite || (f.managerOnly && !manager) || (!!record && f.key === 'startupId')} />
        ))}
      </div>
      {record?.changeLog?.length > 0 && (
        <details className="text-[11px]"><summary className="cursor-pointer font-semibold">Change log ({record.changeLog.length})</summary>
          <ul className="mt-1 space-y-0.5 text-theme-text-secondary">{record.changeLog.slice().reverse().map((c: any, i: number) => <li key={i}>{c.at.slice(0, 16).replace('T', ' ')} — {c.field}: {String(c.from ?? '—')} → {String(c.to ?? '—')}</li>)}</ul></details>
      )}
      {err && <div className="text-xs text-red-400">{err}</div>}
      <div className="flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Close</button>
        {canWrite && <button className={btnPrimary} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>}
      </div>
    </Modal>
  );
}
