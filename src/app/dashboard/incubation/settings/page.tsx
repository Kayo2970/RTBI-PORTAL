'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { Chip } from '@/components/ui';
import { fetchIncubationSettings, saveIncubationSettings } from '@/lib/incubation/client';
import { totalWeight } from '@/lib/incubation/rules';
import type { IncubationSettings, WeightedCriterion, Approvable } from '@/lib/incubation/types';

const inputCls = 'w-full bg-theme-background/40 border border-theme-border/40 rounded-xl px-3 py-2 text-xs';
const num = (v: string) => (v === '' ? 0 : Number(v));

function ApprovalBar({ value, onChange }: { value: Approvable; onChange: (v: Approvable) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Chip color={value.status === 'approved' ? 'success' : 'warning'}>{value.status === 'approved' ? 'Approved' : 'Proposed'}</Chip>
      <select className={inputCls + ' !w-auto'} value={value.status} onChange={e => onChange({ ...value, status: e.target.value as Approvable['status'] })}>
        <option value="proposed">Proposed</option><option value="approved">Approved</option>
      </select>
      <input className={inputCls + ' !w-64'} placeholder="Approval reference (minutes / order no.)" value={value.approvalRef || ''} onChange={e => onChange({ ...value, approvalRef: e.target.value })} />
      {value.status === 'approved' && value.approvedBy && <span className="text-theme-text-secondary">by {value.approvedBy}</span>}
    </div>
  );
}

function Weights({ rows, onChange }: { rows: WeightedCriterion[]; onChange: (r: WeightedCriterion[]) => void }) {
  const total = totalWeight(rows);
  return (
    <div className="space-y-1">
      {rows.map((r, i) => (
        <div key={r.key} className="flex items-center gap-2 text-xs">
          <span className="flex-1">{r.label}</span>
          <input type="number" min={0} max={100} className={inputCls + ' !w-20'} value={r.weight} onChange={e => onChange(rows.map((x, j) => (j === i ? { ...x, weight: num(e.target.value) } : x)))} />
        </div>
      ))}
      <div className={`text-xs font-semibold ${Math.abs(total - 100) < 0.001 ? 'text-emerald-400' : 'text-red-400'}`}>Total: {total} (must be 100)</div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="glass-panel rounded-2xl p-5 space-y-3">
      <div><h2 className="font-bold text-sm">{title}</h2>{hint && <p className="text-xs text-theme-text-secondary">{hint}</p>}</div>
      {children}
    </section>
  );
}

export default function IncubationSettingsPage() {
  const [s, setS] = useState<IncubationSettings | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { fetchIncubationSettings().then(setS).catch(e => setError(e.message)); }, []);

  if (!s) return <div className="p-8 text-xs">{error ? <span className="text-red-400">{error}</span> : <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</span>}</div>;

  const patch = (p: Partial<IncubationSettings>) => { setS({ ...s, ...p }); setSaved(false); };
  const save = async () => {
    setSaving(true); setError('');
    try { setS(await saveIncubationSettings(s)); setSaved(true); } catch (e: any) { setError(e.message); }
    setSaving(false);
  };
  const t = s.timers;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/dashboard/incubation" className="text-xs text-accent inline-flex items-center gap-1"><ArrowLeft size={12} /> Startup Registry</Link>
          <h1 className="text-xl font-bold">Incubation Settings <span className="text-xs font-normal text-theme-text-secondary">v{s.version}</span></h1>
          <p className="text-xs text-theme-text-secondary">Values from the SOPs are seeded as <b>Proposed</b>. Mark a block Approved only with an approval reference. Only the CEO or Super User can save.</p>
        </div>
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saved ? 'Saved' : 'Save'}
        </button>
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}

      <Section title="Financial year" hint="Indian FY starts in April. The programme start date anchors the five-year cumulative KPI view.">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">FY start month (1-12)<input type="number" min={1} max={12} className={inputCls} value={s.fiscalYearStartMonth} onChange={e => patch({ fiscalYearStartMonth: num(e.target.value) })} /></label>
          <label className="space-y-1">Programme start date<input type="date" className={inputCls} value={s.programmeStartDate || ''} onChange={e => patch({ programmeStartDate: e.target.value || undefined })} /></label>
        </div>
      </Section>

      <Section title="Selection scorecard (SOP 08, Annexure C)" hint="Weighted score = (score ÷ 5) × weight. Pass mark, minimum technical score and tie-break rule are undefined in the SOP and must be set before evaluation is finalised.">
        <ApprovalBar value={s.scorecard} onChange={v => patch({ scorecard: { ...s.scorecard, ...v } })} />
        <Weights rows={s.scorecard.criteria} onChange={criteria => patch({ scorecard: { ...s.scorecard, criteria } })} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <label className="space-y-1">Pass threshold<input type="number" className={inputCls} value={s.scorecard.passThreshold ?? ''} onChange={e => patch({ scorecard: { ...s.scorecard, passThreshold: e.target.value === '' ? undefined : num(e.target.value) } })} /></label>
          <label className="space-y-1">Min. technical score (1-5 avg on Technical viability)<input type="number" className={inputCls} value={s.scorecard.minTechnicalScore ?? ''} onChange={e => patch({ scorecard: { ...s.scorecard, minTechnicalScore: e.target.value === '' ? undefined : num(e.target.value) } })} /></label>
          <label className="space-y-1">Tie-break rule<input className={inputCls} value={s.scorecard.tieBreakRule || ''} onChange={e => patch({ scorecard: { ...s.scorecard, tieBreakRule: e.target.value || undefined } })} /></label>
        </div>
      </Section>

      <Section title="Graduation scorecard (SOP 10 — draft)" hint="Bands: eligible at or above the first value; conditional at or above the second; otherwise not ready.">
        <ApprovalBar value={s.graduation} onChange={v => patch({ graduation: { ...s.graduation, ...v } })} />
        <Weights rows={s.graduation.dimensions} onChange={dimensions => patch({ graduation: { ...s.graduation, dimensions } })} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <label className="space-y-1">Eligible ≥<input type="number" className={inputCls} value={s.graduation.eligibleMin} onChange={e => patch({ graduation: { ...s.graduation, eligibleMin: num(e.target.value) } })} /></label>
          <label className="space-y-1">Conditional ≥<input type="number" className={inputCls} value={s.graduation.conditionalMin} onChange={e => patch({ graduation: { ...s.graduation, conditionalMin: num(e.target.value) } })} /></label>
          <label className="space-y-1">Short cohort (months)<input type="number" className={inputCls} value={s.graduation.shortCohortMonths} onChange={e => patch({ graduation: { ...s.graduation, shortCohortMonths: num(e.target.value) } })} /></label>
          <label className="space-y-1">Long cohort (months)<input type="number" className={inputCls} value={s.graduation.longCohortMonths} onChange={e => patch({ graduation: { ...s.graduation, longCohortMonths: num(e.target.value) } })} /></label>
        </div>
      </Section>

      <Section title="Service timers" hint="Internal standards unless the agreement says otherwise.">
        <ApprovalBar value={t} onChange={v => patch({ timers: { ...t, ...v } })} />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          {([
            ['acknowledgementWorkingDays', 'Acknowledgement (working days)'], ['screeningDays', 'Screening (days)'],
            ['admissionCommunicationWorkingDays', 'Admission communication (working days)'], ['quarterlyReportWorkingDays', 'Quarterly report (working days)'],
            ['reviewRecordWorkingDays', 'Review record (working days)'], ['mentorSessionLogWorkingDays', 'Mentor session log (working days)'],
          ] as const).map(([k, label]) => (
            <label key={k} className="space-y-1">{label}<input type="number" className={inputCls} value={t[k]} onChange={e => patch({ timers: { ...t, [k]: num(e.target.value) } })} /></label>
          ))}
          <label className="space-y-1">Clarification window min (working days)<input type="number" className={inputCls} value={t.clarificationWorkingDays.min} onChange={e => patch({ timers: { ...t, clarificationWorkingDays: { ...t.clarificationWorkingDays, min: num(e.target.value) } } })} /></label>
          <label className="space-y-1">Clarification window max (working days)<input type="number" className={inputCls} value={t.clarificationWorkingDays.max} onChange={e => patch({ timers: { ...t, clarificationWorkingDays: { ...t.clarificationWorkingDays, max: num(e.target.value) } } })} /></label>
        </div>
      </Section>

      <Section title="Programme KPI targets (MoA Annexure F)" hint="Confirm against the signed Annexure F before reporting to KITS. Clause 8.4 is tracked separately.">
        <ApprovalBar value={s.kpis} onChange={v => patch({ kpis: { ...s.kpis, ...v } })} />
        <div className="space-y-1">
          {s.kpis.targets.map((k, i) => (
            <div key={k.key} className="flex items-center gap-2 text-xs">
              <span className="flex-1">{k.label}</span>
              <input type="number" className={inputCls + ' !w-20'} title="Annual" value={k.annual} onChange={e => patch({ kpis: { ...s.kpis, targets: s.kpis.targets.map((x, j) => (j === i ? { ...x, annual: num(e.target.value) } : x)) } })} />
              <input type="number" className={inputCls + ' !w-20'} title="Five-year" value={k.fiveYear} onChange={e => patch({ kpis: { ...s.kpis, targets: s.kpis.targets.map((x, j) => (j === i ? { ...x, fiveYear: num(e.target.value) } : x)) } })} />
            </div>
          ))}
          <div className="text-[11px] text-theme-text-secondary">Columns: annual, five-year.</div>
        </div>
        <label className="text-xs space-y-1 block max-w-xs">Clause 8.4 minimum startups per financial year
          <input type="number" className={inputCls} value={s.kpis.clause84MinStartupsPerFy} onChange={e => patch({ kpis: { ...s.kpis, clause84MinStartupsPerFy: num(e.target.value) } })} />
        </label>
      </Section>

      <Section title="Fee schedules" hint="Versioned. A schedule is not effective until approved in writing by the competent authority. No equity, revenue-share or deposit fields exist.">
        {s.feeSchedules.map((fs, i) => (
          <div key={fs.id} className="rounded-xl border border-theme-border/30 p-3 space-y-2">
            <div className="text-xs font-semibold">{fs.name}</div>
            <ApprovalBar value={fs} onChange={v => patch({ feeSchedules: s.feeSchedules.map((x, j) => (j === i ? { ...x, ...v } : x)) })} />
            <table className="w-full text-xs">
              <thead><tr className="text-left text-theme-text-secondary"><th>Space</th><th>Base</th><th>GST %</th><th>Incl. GST</th></tr></thead>
              <tbody>
                {fs.lines.map((l, li) => (
                  <tr key={l.key}>
                    <td className="py-1">{l.label} / {l.period}</td>
                    <td><input type="number" className={inputCls + ' !w-24'} value={l.baseAmount} onChange={e => patch({ feeSchedules: s.feeSchedules.map((x, j) => (j === i ? { ...x, lines: x.lines.map((y, k) => (k === li ? { ...y, baseAmount: num(e.target.value) } : y)) } : x)) })} /></td>
                    <td><input type="number" className={inputCls + ' !w-16'} value={l.gstPercent} onChange={e => patch({ feeSchedules: s.feeSchedules.map((x, j) => (j === i ? { ...x, lines: x.lines.map((y, k) => (k === li ? { ...y, gstPercent: num(e.target.value) } : y)) } : x)) })} /></td>
                    <td>₹{Math.round(l.baseAmount * (1 + l.gstPercent / 100)).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[11px] text-theme-text-secondary">Rent due by day {fs.rentDueDay} each month · {fs.annualEscalationPercent}% annual escalation. {fs.notes}</div>
          </div>
        ))}
      </Section>
    </div>
  );
}
