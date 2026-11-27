'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Save, Settings as SettingsIcon } from 'lucide-react';
import { fetchIncubationSettings, saveIncubationSettings } from '@/lib/incubation/client';
import { totalWeight } from '@/lib/incubation/rules';
import type { IncubationSettings, WeightedCriterion, Approvable } from '@/lib/incubation/types';
import { Tabs } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { formatINR } from '@/lib/format';
import { PageHeader, btnPrimary, inputCls } from '@/components/incubation/ui';

const num = (v: string) => (v === '' ? 0 : Number(v));

/** Settings are saved one topic at a time: each tab owns these top-level keys. */
const SECTIONS = {
  general: { label: 'General', keys: ['fiscalYearStartMonth', 'programmeStartDate'] },
  scorecard: { label: 'Selection scorecard', keys: ['scorecard'] },
  graduation: { label: 'Graduation', keys: ['graduation'] },
  timers: { label: 'Timers', keys: ['timers'] },
  kpis: { label: 'KPI targets', keys: ['kpis'] },
  fees: { label: 'Fees', keys: ['feeSchedules'] },
} as const;
type SectionId = keyof typeof SECTIONS;

function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: (id: string) => React.ReactNode; className?: string }) {
  const id = React.useId();
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
      {children(id)}
      {hint && <p className="text-sm text-theme-text-secondary">{hint}</p>}
    </div>
  );
}
const NumField = ({ label, value, onChange, hint, min, max }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; hint?: string; min?: number; max?: number }) => (
  <Field label={label} hint={hint}>{(id) => <input id={id} type="number" min={min} max={max} className={inputCls} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : num(e.target.value))} />}</Field>
);

function ApprovalBar({ value, onChange }: { value: Approvable; onChange: (v: Approvable) => void }) {
  return (
    <div className="rounded-xl border border-theme-border p-4 grid md:grid-cols-[auto_1fr] gap-4 items-end bg-theme-border/10">
      <Field label="Status">{(id) => <select id={id} className={inputCls} value={value.status} onChange={e => onChange({ ...value, status: e.target.value as Approvable['status'] })}><option value="proposed">Proposed</option><option value="approved">Approved</option></select>}</Field>
      <Field label="Approval reference" hint={value.status === 'approved' ? (value.approvedBy ? `Approved by ${value.approvedBy}` : 'Required to mark this Approved (minutes or order number).') : 'Add the minutes / order number when approving.'}>
        {(id) => <input id={id} className={inputCls} placeholder="e.g. PMC minutes 12/2026" value={value.approvalRef || ''} onChange={e => onChange({ ...value, approvalRef: e.target.value })} />}
      </Field>
    </div>
  );
}

function Weights({ rows, onChange, title }: { rows: WeightedCriterion[]; onChange: (r: WeightedCriterion[]) => void; title: string }) {
  const total = totalWeight(rows);
  const ok = Math.abs(total - 100) < 0.001;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold mb-1">{title}</legend>
      {rows.map((r, i) => (
        <div key={r.key} className="flex items-center gap-3">
          <label htmlFor={`w-${r.key}`} className="flex-1 text-sm">{r.label}</label>
          <input id={`w-${r.key}`} type="number" min={0} max={100} className={inputCls + ' !w-24'} value={r.weight} onChange={e => onChange(rows.map((x, j) => (j === i ? { ...x, weight: num(e.target.value) } : x)))} />
        </div>
      ))}
      <p role="status" className={`text-sm font-semibold ${ok ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>Total weight: {total}. {ok ? 'Looks right.' : 'Must add up to 100.'}</p>
    </fieldset>
  );
}

export default function IncubationSettingsPage() {
  const [saved, setSaved] = useState<IncubationSettings | null>(null);
  const [s, setS] = useState<IncubationSettings | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<SectionId>('scorecard');
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchIncubationSettings().then(x => { setSaved(x); setS(x); }).catch(e => setError(e.message)); }, []);

  const dirty = useMemo(() => {
    const d: Record<SectionId, boolean> = { general: false, scorecard: false, graduation: false, timers: false, kpis: false, fees: false };
    if (!s || !saved) return d;
    (Object.keys(SECTIONS) as SectionId[]).forEach(id => { d[id] = SECTIONS[id].keys.some(k => JSON.stringify((s as any)[k]) !== JSON.stringify((saved as any)[k])); });
    return d;
  }, [s, saved]);
  const anyDirty = Object.values(dirty).some(Boolean);

  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  if (!s || !saved) {
    return (
      <div className="p-6 md:p-8 max-w-4xl space-y-4" aria-busy={!error}>
        {error ? <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p> : <><Skeleton className="h-10 w-72" /><Skeleton className="h-64" /></>}
      </div>
    );
  }

  const patch = (p: Partial<IncubationSettings>) => setS({ ...s, ...p });
  const saveSection = async (id: SectionId) => {
    setSaving(true);
    try {
      // Only this topic's changes go on top of the last saved copy, so edits in other tabs are never saved by accident.
      const next = { ...saved } as any;
      SECTIONS[id].keys.forEach(k => { next[k] = (s as any)[k]; });
      const res = await saveIncubationSettings(next);
      setSaved(res);
      setS(cur => { const merged = { ...(cur as any) }; SECTIONS[id].keys.forEach(k => { merged[k] = (res as any)[k]; }); merged.version = res.version; return merged; });
      toast.success(`${SECTIONS[id].label} saved`, { description: 'Version ' + res.version });
    } catch (e: any) { toast.error('Could not save settings', { description: e.message }); }
    setSaving(false);
  };
  const discard = (id: SectionId) => setS(cur => { const merged = { ...(cur as any) }; SECTIONS[id].keys.forEach(k => { merged[k] = (saved as any)[k]; }); return merged; });

  const statusOf = (id: SectionId): Approvable | null => (id === 'scorecard' ? s.scorecard : id === 'graduation' ? s.graduation : id === 'timers' ? s.timers : id === 'kpis' ? s.kpis : null);
  const status = statusOf(tab);
  const t = s.timers;

  const items = (Object.keys(SECTIONS) as SectionId[]).map(id => ({ id, label: SECTIONS[id].label + (dirty[id] ? ' •' : '') }));

  return (
    <div className="p-6 md:p-8 max-w-4xl space-y-6">
      <PageHeader icon={<SettingsIcon className="h-6 w-6" aria-hidden="true" />} title="Incubation settings"
        subtitle={`Version ${s.version}. Values from the SOPs are seeded as Proposed. Mark a topic Approved only with an approval reference. Only the CEO or Super User can save.`} />
      {error && <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>}
      {anyDirty && <p role="status" className="text-sm rounded-xl border border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100 px-4 py-2.5">You have unsaved changes in: {(Object.keys(SECTIONS) as SectionId[]).filter(i => dirty[i]).map(i => SECTIONS[i].label).join(', ')}. Each tab is saved on its own.</p>}

      <Tabs label="Settings topics" items={items} value={tab} onChange={id => setTab(id as SectionId)} />

      <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="glass-panel rounded-2xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{SECTIONS[tab].label}</h2>
          {status && <Badge tone={status.status === 'approved' ? 'success' : 'warning'}>{status.status === 'approved' ? 'Approved' : 'Proposed'}</Badge>}
        </div>

        {tab === 'general' && (
          <div className="grid sm:grid-cols-2 gap-4">
            <NumField label="Financial year start month (1-12)" hint="Indian FY starts in April (4)." min={1} max={12} value={s.fiscalYearStartMonth} onChange={v => patch({ fiscalYearStartMonth: v ?? 0 })} />
            <Field label="Programme start date" hint="Anchors the five-year cumulative KPI view.">{(id) => <input id={id} type="date" className={inputCls} value={s.programmeStartDate || ''} onChange={e => patch({ programmeStartDate: e.target.value || undefined })} />}</Field>
          </div>
        )}

        {tab === 'scorecard' && (
          <>
            <p className="text-sm text-theme-text-secondary">SOP 08, Annexure C. Weighted score = (score ÷ 5) × weight. Pass mark, minimum technical score and tie-break rule are undefined in the SOP and must be set before evaluation is finalised.</p>
            <ApprovalBar value={s.scorecard} onChange={v => patch({ scorecard: { ...s.scorecard, ...v } })} />
            <Weights title="Criteria weights" rows={s.scorecard.criteria} onChange={criteria => patch({ scorecard: { ...s.scorecard, criteria } })} />
            <div className="grid md:grid-cols-3 gap-4">
              <NumField label="Pass threshold" value={s.scorecard.passThreshold} onChange={v => patch({ scorecard: { ...s.scorecard, passThreshold: v } })} />
              <NumField label="Minimum technical score" hint="1-5 average on Technical viability." value={s.scorecard.minTechnicalScore} onChange={v => patch({ scorecard: { ...s.scorecard, minTechnicalScore: v } })} />
              <Field label="Tie-break rule">{(id) => <input id={id} className={inputCls} value={s.scorecard.tieBreakRule || ''} onChange={e => patch({ scorecard: { ...s.scorecard, tieBreakRule: e.target.value || undefined } })} />}</Field>
            </div>
          </>
        )}

        {tab === 'graduation' && (
          <>
            <p className="text-sm text-theme-text-secondary">SOP 10 (draft). Eligible at or above the first value; conditional at or above the second; otherwise not ready.</p>
            <ApprovalBar value={s.graduation} onChange={v => patch({ graduation: { ...s.graduation, ...v } })} />
            <Weights title="Dimension weights" rows={s.graduation.dimensions} onChange={dimensions => patch({ graduation: { ...s.graduation, dimensions } })} />
            <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
              <NumField label="Eligible at or above" value={s.graduation.eligibleMin} onChange={v => patch({ graduation: { ...s.graduation, eligibleMin: v ?? 0 } })} />
              <NumField label="Conditional at or above" value={s.graduation.conditionalMin} onChange={v => patch({ graduation: { ...s.graduation, conditionalMin: v ?? 0 } })} />
              <NumField label="Short cohort (months)" value={s.graduation.shortCohortMonths} onChange={v => patch({ graduation: { ...s.graduation, shortCohortMonths: v ?? 0 } })} />
              <NumField label="Long cohort (months)" value={s.graduation.longCohortMonths} onChange={v => patch({ graduation: { ...s.graduation, longCohortMonths: v ?? 0 } })} />
            </div>
          </>
        )}

        {tab === 'timers' && (
          <>
            <p className="text-sm text-theme-text-secondary">Internal service standards unless the agreement says otherwise.</p>
            <ApprovalBar value={t} onChange={v => patch({ timers: { ...t, ...v } })} />
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
              {([
                ['acknowledgementWorkingDays', 'Acknowledgement (working days)'], ['screeningDays', 'Screening (days)'],
                ['admissionCommunicationWorkingDays', 'Admission communication (working days)'], ['quarterlyReportWorkingDays', 'Quarterly report (working days)'],
                ['reviewRecordWorkingDays', 'Review record (working days)'], ['mentorSessionLogWorkingDays', 'Mentor session log (working days)'],
              ] as const).map(([k, label]) => <NumField key={k} label={label} value={t[k]} onChange={v => patch({ timers: { ...t, [k]: v ?? 0 } })} />)}
              <NumField label="Clarification window, min (working days)" value={t.clarificationWorkingDays.min} onChange={v => patch({ timers: { ...t, clarificationWorkingDays: { ...t.clarificationWorkingDays, min: v ?? 0 } } })} />
              <NumField label="Clarification window, max (working days)" value={t.clarificationWorkingDays.max} onChange={v => patch({ timers: { ...t, clarificationWorkingDays: { ...t.clarificationWorkingDays, max: v ?? 0 } } })} />
            </div>
          </>
        )}

        {tab === 'kpis' && (
          <>
            <p className="text-sm text-theme-text-secondary">MoA Annexure F. Confirm against the signed Annexure F before reporting to KITS. Clause 8.4 is tracked separately.</p>
            <ApprovalBar value={s.kpis} onChange={v => patch({ kpis: { ...s.kpis, ...v } })} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">KPI targets</caption>
                <thead><tr className="text-left text-theme-text-secondary border-b border-theme-border"><th scope="col" className="py-2 pr-3">Indicator</th><th scope="col" className="py-2 px-2">Annual</th><th scope="col" className="py-2 pl-2">Five-year</th></tr></thead>
                <tbody>
                  {s.kpis.targets.map((k, i) => (
                    <tr key={k.key} className="border-b border-theme-border/60">
                      <th scope="row" className="py-2 pr-3 text-left font-medium">{k.label}</th>
                      <td className="px-2"><input aria-label={`${k.label} annual target`} type="number" className={inputCls + ' !w-24'} value={k.annual} onChange={e => patch({ kpis: { ...s.kpis, targets: s.kpis.targets.map((x, j) => (j === i ? { ...x, annual: num(e.target.value) } : x)) } })} /></td>
                      <td className="pl-2"><input aria-label={`${k.label} five-year target`} type="number" className={inputCls + ' !w-24'} value={k.fiveYear} onChange={e => patch({ kpis: { ...s.kpis, targets: s.kpis.targets.map((x, j) => (j === i ? { ...x, fiveYear: num(e.target.value) } : x)) } })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <NumField label="Clause 8.4 minimum startups per financial year" value={s.kpis.clause84MinStartupsPerFy} onChange={v => patch({ kpis: { ...s.kpis, clause84MinStartupsPerFy: v ?? 0 } })} />
          </>
        )}

        {tab === 'fees' && (
          <>
            <p className="text-sm text-theme-text-secondary">Versioned. A schedule is not effective until approved in writing by the competent authority. No equity, revenue-share or deposit fields exist.</p>
            {s.feeSchedules.map((fs, i) => (
              <div key={fs.id} className="rounded-xl border border-theme-border p-4 space-y-3">
                <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{fs.name}</h3><Badge tone={fs.status === 'approved' ? 'success' : 'warning'}>{fs.status === 'approved' ? 'Approved' : 'Proposed'}</Badge></div>
                <ApprovalBar value={fs} onChange={v => patch({ feeSchedules: s.feeSchedules.map((x, j) => (j === i ? { ...x, ...v } : x)) })} />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{fs.name} lines</caption>
                    <thead><tr className="text-left text-theme-text-secondary border-b border-theme-border"><th scope="col" className="py-2">Space</th><th scope="col">Base (₹)</th><th scope="col">GST %</th><th scope="col">Incl. GST</th></tr></thead>
                    <tbody>
                      {fs.lines.map((l, li) => (
                        <tr key={l.key} className="border-b border-theme-border/60">
                          <th scope="row" className="py-2 pr-3 text-left font-medium">{l.label} / {l.period}</th>
                          <td className="pr-2"><input aria-label={`${l.label} base amount`} type="number" className={inputCls + ' !w-28'} value={l.baseAmount} onChange={e => patch({ feeSchedules: s.feeSchedules.map((x, j) => (j === i ? { ...x, lines: x.lines.map((y, k) => (k === li ? { ...y, baseAmount: num(e.target.value) } : y)) } : x)) })} /></td>
                          <td className="pr-2"><input aria-label={`${l.label} GST percent`} type="number" className={inputCls + ' !w-20'} value={l.gstPercent} onChange={e => patch({ feeSchedules: s.feeSchedules.map((x, j) => (j === i ? { ...x, lines: x.lines.map((y, k) => (k === li ? { ...y, gstPercent: num(e.target.value) } : y)) } : x)) })} /></td>
                          <td className="font-semibold">{formatINR(Math.round(l.baseAmount * (1 + l.gstPercent / 100)))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-sm text-theme-text-secondary">Rent due by day {fs.rentDueDay} each month. {fs.annualEscalationPercent}% annual escalation. {fs.notes}</p>
              </div>
            ))}
          </>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-theme-border">
          {dirty[tab] && <button type="button" className="min-h-11 px-4 rounded-xl border border-theme-border text-sm font-semibold hover:bg-theme-border/20" onClick={() => discard(tab)}>Discard changes</button>}
          <button type="button" className={btnPrimary} disabled={saving || !dirty[tab]} onClick={() => saveSection(tab)}>
            <Save className="h-4 w-4" aria-hidden="true" /> {saving ? 'Saving…' : dirty[tab] ? `Save ${SECTIONS[tab].label}` : 'Saved'}
          </button>
        </div>
      </div>
    </div>
  );
}
