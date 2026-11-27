'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Loader2, Download, FileDown } from 'lucide-react';
import { fetchKpis } from '@/lib/incubation/client';
import type { KpiReport } from '@/lib/incubation/kpi-server';
import { downloadCsv } from '@/lib/csv';
import { downloadPdf } from '@/lib/incubation/pdf';
import { Badge, PageHeader, Panel, btnGhost, inputCls } from '@/components/incubation/ui';

export default function KpiPage() {
  const [fy, setFy] = useState<string | undefined>();
  const [r, setR] = useState<KpiReport | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async (f?: string) => { try { const x = await fetchKpis(f); setR(x); setFy(x.fy); setErr(''); } catch (e: any) { setErr(e.message); } }, []);
  useEffect(() => { load(); }, [load]);

  const csv = () => {
    if (!r) return;
    const head = ['KPI', 'Annual target', 'Year to date', 'Variance', 'Status', 'Cumulative', 'Five-year target', 'Evidenced', 'Source refs (IDs only)'];
    const body = r.rows.map(k => [k.label, k.annualTarget, k.ytd, k.variance, k.status, k.cumulative, k.fiveYearTarget, k.evidenced, k.refs.join(' ')]);
    downloadCsv(`rtbi-kpi-${r.fy}.csv`, [head, ...body].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'));
  };
  const pdf = () => r && downloadPdf(`rtbi-kpi-${r.fy}.pdf`, `RTBI programme KPIs — ${r.fy}`, `As of ${r.asOf.slice(0, 10)} · targets ${r.settingsStatus} · confirm against the signed Annexure F before reporting to KITS`, [
    { heading: 'Annexure F indicators', lines: r.rows.map(k => `${k.label}: ${k.ytd}/${k.annualTarget} this year (${k.status}), ${k.cumulative}/${k.fiveYearTarget} cumulative; ${k.evidenced} evidenced. Evidence: ${k.evidenceRequired}`) },
    { heading: 'Clause 8.4 minimum', lines: [`${r.clause84.incubatedThisFy} startups incubated this FY vs minimum ${r.clause84.min}: ${r.clause84.met ? 'met' : 'not yet met'}`] },
    { heading: 'Funding (kept separate)', lines: Object.entries(r.funding).map(([k, v]) => `${k}: ₹${v.toLocaleString('en-IN')}`) },
    { heading: 'Corrective action needed', lines: r.shortfalls.length ? r.shortfalls : ['None'] },
  ]);

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader icon={<BarChart3 size={20} />} title="KPI Dashboard" subtitle="Annexure F targets with year-to-date, cumulative, variance and evidence. Startups are counted once; patents count when filed; funding stages are never added together. Only startup IDs are shown."
        actions={<><button className={btnGhost} onClick={csv} disabled={!r}><Download size={12} /> CSV</button><button className={btnGhost} onClick={pdf} disabled={!r}><FileDown size={12} /> PDF</button></>} />
      {err && <div className="text-sm text-rose-700 dark:text-rose-300">{err}</div>}
      {!r ? !err && <div className="text-sm flex gap-2 items-center"><Loader2 size={14} className="animate-spin" /> Loading…</div> : (
        <>
          <div className="flex items-center gap-3"><select aria-label="Financial year" className={inputCls + ' !w-auto'} value={fy} onChange={e => load(e.target.value)}>{r.fyOptions.map(o => <option key={o}>{o}</option>)}</select>
            {r.settingsStatus !== 'approved' && <Badge tone="amber">Targets are Proposed — confirm against the signed Annexure F</Badge>}</div>
          <div className="glass-panel rounded-2xl overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-theme-text-secondary border-b border-theme-border">
            <th className="p-3">Indicator</th><th className="p-3">Annual</th><th className="p-3">YTD</th><th className="p-3">Variance</th><th className="p-3">Status</th><th className="p-3">Cumulative / 5-yr</th><th className="p-3">Evidenced</th></tr></thead>
            <tbody>{r.rows.map(k => <tr key={k.key} className="border-b border-theme-border/20" title={k.evidenceRequired}>
              <td className="p-3">{k.label}</td><td className="p-3">{k.annualTarget}</td><td className="p-3 font-semibold">{k.ytd}</td><td className="p-3">{k.variance >= 0 ? '+' : ''}{k.variance}</td>
              <td className="p-3"><Badge tone={k.status === 'Met' ? 'green' : k.status === 'On track' ? 'blue' : 'red'}>{k.status}</Badge></td><td className="p-3">{k.cumulative} / {k.fiveYearTarget}</td><td className="p-3">{k.evidenced}/{k.ytd}</td></tr>)}</tbody></table></div>
          <div className="grid md:grid-cols-2 gap-4">
            <Panel title="MoA Clause 8.4 minimum" hint="Tracked separately from the Annexure F target.">
              <p className="text-sm"><b>{r.clause84.incubatedThisFy}</b> / {r.clause84.min} startups this financial year — <Badge tone={r.clause84.met ? 'green' : 'amber'}>{r.clause84.met ? 'Met' : 'Not yet met'}</Badge></p></Panel>
            <Panel title="Funding (never combined)" hint="Applied, recommended, sanctioned and received are reported separately.">
              <ul className="text-sm space-y-0.5">{Object.entries(r.funding).map(([k, v]) => <li key={k}>{k}: ₹{v.toLocaleString('en-IN')}</li>)}</ul></Panel>
          </div>
          {r.shortfalls.length > 0 && <Panel title="Corrective action plan required" hint="Record the plan in the PMC / BoG meeting register."><ul className="text-sm list-disc pl-5">{r.shortfalls.map(s => <li key={s}>{s}</li>)}</ul></Panel>}
        </>
      )}
    </div>
  );
}
