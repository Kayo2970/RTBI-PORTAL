'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowRight, CheckCircle2, Rocket } from 'lucide-react';
import { fetchAlerts, fetchApplications, fetchKpis, fetchRecords, fetchStartups } from '@/lib/incubation/client';
import type { IncubationAlert } from '@/lib/incubation/alerts-server';
import type { KpiReport } from '@/lib/incubation/kpi-server';
import type { Startup } from '@/lib/incubation/types';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ragClass, useCurrentUser } from '@/components/incubation/ui';

interface Data { startups: Startup[]; alerts: IncubationAlert[]; kpi: KpiReport | null; applications: any[]; reviews: any[] }

export default function IncubationOverviewPage() {
  const router = useRouter();
  const user = useCurrentUser();
  const [data, setData] = useState<Data | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    if (user.tier === 4) { router.replace('/dashboard/incubation/workspace'); return; }
    if (user.tier === 3 && user.externalReviewer) { router.replace('/dashboard/incubation/applications'); return; }
    let live = true;
    Promise.allSettled([fetchStartups(), fetchAlerts(), fetchKpis(), fetchApplications(), fetchRecords('review')]).then((r) => {
      if (!live) return;
      const val = <T,>(i: number, d: T) => (r[i].status === 'fulfilled' ? (r[i] as PromiseFulfilledResult<T>).value : d);
      setProblems(r.flatMap((x, i) => (x.status === 'rejected' ? [['Startups', 'Alerts', 'KPIs', 'Applications', 'Reviews'][i]] : [])));
      setData({ startups: val(0, []), alerts: val(1, []), kpi: val(2, null), applications: val(3, []), reviews: val(4, []) });
    });
    return () => { live = false; };
  }, [user, router]);

  const funnel = useMemo(() => {
    if (!data) return [];
    const n = (statuses: string[]) => data.startups.filter((s) => statuses.includes(s.status)).length;
    return [
      { stage: 'Applications', count: data.applications.length },
      { stage: 'Selected', count: n(['Selected', 'Onboarding', 'Active', 'Graduated']) },
      { stage: 'Active', count: n(['Active', 'Graduated']) },
      { stage: 'Graduated', count: n(['Graduated']) },
    ];
  }, [data]);

  const latestRag = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of data?.reviews ?? []) {
      const cur = m.get(r.startupId);
      if (!cur || String(r.periodEnd || '') > String(cur.periodEnd || '')) m.set(r.startupId, r);
    }
    return m;
  }, [data]);

  if (!data) {
    return (
      <div className="p-6 md:p-8 space-y-6" aria-busy="true" aria-label="Loading overview">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        <div className="grid lg:grid-cols-2 gap-4"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
      </div>
    );
  }

  const active = data.startups.filter((s) => s.status === 'Active');
  const inPipeline = data.applications.filter((a) => !['Ineligible', 'Decision final'].includes(a.status) && !a.decision?.finalisedAt).length;
  const overdue = data.alerts.filter((a) => a.severity === 'overdue');
  const kpiMet = data.kpi ? data.kpi.rows.filter((k) => k.status === 'Met').length : 0;
  const attention = [...data.alerts].sort((a, b) => Number(b.severity === 'overdue') - Number(a.severity === 'overdue')).slice(0, 7);
  const kpiChart = (data.kpi?.rows ?? []).map((k) => ({ name: k.label.length > 18 ? k.label.slice(0, 17) + '…' : k.label, Target: k.annualTarget, 'Year to date': k.ytd }));

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader icon={<Rocket className="h-6 w-6" aria-hidden="true" />} title="Incubation overview" description="Where the programme stands today and what needs action first." />

      {problems.length > 0 && (
        <p role="status" className="text-sm rounded-xl border border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100 px-4 py-3">
          Some sections could not be loaded ({problems.join(', ')}). You may not have access, or the server is unreachable.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active startups" value={active.length} hint={`${data.startups.length} in registry`} />
        <StatCard label="Applications in progress" value={inPipeline} hint={`${data.applications.length} received in total`} />
        <StatCard label="Overdue actions" value={overdue.length} tone={overdue.length ? 'danger' : 'success'} hint={overdue.length ? 'Needs attention now' : 'Nothing overdue'} />
        <StatCard label="KPI targets met" value={data.kpi ? `${kpiMet}/${data.kpi.rows.length}` : '—'} hint={data.kpi ? data.kpi.fy : undefined} />
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <section className="glass-panel rounded-2xl p-5 lg:col-span-3" aria-labelledby="attn">
          <div className="flex items-center justify-between mb-3">
            <h2 id="attn" className="font-bold text-base flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" /> Needs attention</h2>
            <Badge tone={overdue.length ? 'danger' : 'success'}>{data.alerts.length} item{data.alerts.length === 1 ? '' : 's'}</Badge>
          </div>
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-theme-text-secondary py-6"><CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" /> You are all caught up. No overdue reviews, agreements, or decisions.</p>
          ) : (
            <ul className="divide-y divide-theme-border">
              {attention.map((a) => (
                <li key={a.id}>
                  <Link href={a.link} className="flex items-start gap-3 min-h-14 py-3 hover:bg-theme-border/10 rounded-lg px-2 -mx-2">
                    <Badge tone={a.severity === 'overdue' ? 'danger' : a.severity === 'soon' ? 'warning' : 'info'}>{a.severity === 'overdue' ? 'Overdue' : a.severity === 'soon' ? 'Due soon' : 'Info'}</Badge>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{a.title}</span><span className="block text-sm text-theme-text-secondary">{a.detail}</span></span>
                    <ArrowRight className="h-4 w-4 mt-1 text-theme-text-secondary shrink-0" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass-panel rounded-2xl p-5 lg:col-span-2" aria-labelledby="funnel">
          <h2 id="funnel" className="font-bold text-base mb-1">Pipeline funnel</h2>
          <p className="text-sm text-theme-text-secondary mb-2">Applied → selected → active → graduated.</p>
          <div className="h-64 text-theme-text-secondary" role="img" aria-label={`Funnel: ${funnel.map((f) => `${f.stage} ${f.count}`).join(', ')}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.15} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: 'currentColor', fontSize: 13 }} />
                <YAxis type="category" dataKey="stage" width={96} tick={{ fill: 'currentColor', fontSize: 13 }} />
                <Tooltip cursor={{ fill: 'rgba(127,127,127,0.12)' }} />
                <Bar dataKey="count" fill="#361C6A" radius={[0, 6, 6, 0]} label={{ position: 'right', fill: 'currentColor', fontSize: 13 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="glass-panel rounded-2xl p-5" aria-labelledby="kpis">
          <div className="flex items-center justify-between mb-1"><h2 id="kpis" className="font-bold text-base">KPIs vs annual target</h2><Link href="/dashboard/incubation/kpi" className="text-sm font-semibold text-accent-strong dark:text-accent-soft underline">Full report</Link></div>
          {data.kpi?.settingsStatus !== 'approved' && data.kpi && <p className="text-sm text-amber-800 dark:text-amber-200 mb-2">Targets are still Proposed. Confirm them against the signed Annexure F.</p>}
          {kpiChart.length === 0 ? <p className="text-sm text-theme-text-secondary py-8">KPI data is not available.</p> : (
            <div className="h-72 text-theme-text-secondary" role="img" aria-label={`KPI year to date against target: ${kpiChart.map((k) => `${k.name} ${k['Year to date']} of ${k.Target}`).join('; ')}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={kpiChart} margin={{ bottom: 40 }}>
                  <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.15} />
                  <XAxis dataKey="name" interval={0} angle={-30} textAnchor="end" height={60} tick={{ fill: 'currentColor', fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fill: 'currentColor', fontSize: 13 }} />
                  <Tooltip cursor={{ fill: 'rgba(127,127,127,0.12)' }} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Bar dataKey="Target" fill="#9CA3AF" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Year to date" fill="#C23B14" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="glass-panel rounded-2xl p-5" aria-labelledby="rag">
          <div className="flex items-center justify-between mb-3"><h2 id="rag" className="font-bold text-base">Cohort health (latest RAG)</h2><Link href="/dashboard/incubation/records/review" className="text-sm font-semibold text-accent-strong dark:text-accent-soft underline">All reviews</Link></div>
          {active.length === 0 ? <p className="text-sm text-theme-text-secondary py-8">No active startups yet.</p> : (
            <ul className="grid sm:grid-cols-2 gap-2">
              {active.slice(0, 12).map((s) => {
                const r = latestRag.get(s.id);
                return (
                  <li key={s.id}>
                    <Link href={`/dashboard/incubation/records/review`} className="flex items-center justify-between gap-2 min-h-12 px-3 rounded-xl border border-theme-border hover:bg-theme-border/10">
                      <span className="min-w-0"><span className="block text-sm font-semibold truncate">{s.name}</span><span className="block text-xs text-theme-text-secondary">{r?.quarter ?? 'No review yet'}</span></span>
                      <span className={`shrink-0 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${r?.rag ? ragClass[r.rag] : 'border-theme-border text-theme-text-secondary'}`}>{r?.rag ?? 'None'}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {active.length > 12 && <p className="text-sm text-theme-text-secondary mt-2">Showing 12 of {active.length}. See Startups for the rest.</p>}
        </section>
      </div>
    </div>
  );
}
