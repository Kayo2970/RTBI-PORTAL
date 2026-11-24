'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, Rocket } from 'lucide-react';
import { fetchOnboarding, fetchRecords, fetchStartups } from '@/lib/incubation/client';
import { ONBOARDING_ITEMS } from '@/lib/incubation/onboarding';
import type { Startup } from '@/lib/incubation/types';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, statusTone } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { ragClass, useCurrentUser } from '@/components/incubation/ui';
import { formatDate } from '@/lib/format';

interface Section { id: string; title: string; kind: string; line: (r: any) => React.ReactNode; empty: string }
const SECTIONS: Section[] = [
  { id: 'milestones', title: 'Milestones', kind: 'milestone', empty: 'No milestones have been set yet.', line: r => <><b>{r.title}</b> <span className="text-theme-text-secondary">due {formatDate(r.dueDate)}</span> <Badge tone={statusTone(r.status)}>{r.status || 'Open'}</Badge></> },
  { id: 'sessions', title: 'Mentor sessions', kind: 'mentorSession', empty: 'No mentor sessions have been logged yet.', line: r => <><b>{formatDate(r.sessionDate)}</b> {r.feedbackScore ? <span className="text-theme-text-secondary">feedback {r.feedbackScore}/5</span> : null}</> },
  { id: 'reviews', title: 'Quarterly reviews', kind: 'review', empty: 'No quarterly review has been recorded yet.', line: r => <><b>{r.quarter}</b> <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ragClass[r.rag] || ''}`}>{r.rag}</span> {r.ragRationale && <span className="block text-theme-text-secondary mt-0.5">{String(r.ragRationale).slice(0, 140)}</span>}</> },
  { id: 'agreements', title: 'Agreements', kind: 'agreement', empty: 'No agreement is on record yet.', line: r => <><b>{r.title}</b> <span className="text-theme-text-secondary">{formatDate(r.startDate)} to {formatDate(r.endDate)}</span> <Badge tone={statusTone(r.state)}>{r.state}</Badge></> },
  { id: 'trl', title: 'Technology readiness (TRL)', kind: 'trl', empty: 'No TRL assessment has been recorded yet.', line: r => <><b>TRL {r.confirmedTrl ?? r.assessedTrl ?? '—'}</b> <span className="text-theme-text-secondary">{r.technology}</span> <Badge tone={statusTone(r.status)}>{r.status}</Badge></> },
];

/** Read-only "My programme" view for startup (tier 4) founders. Everything shown is already scoped to their startup by the server. */
export default function StartupWorkspacePage() {
  const user = useCurrentUser();
  const [startup, setStartup] = useState<Startup | null | undefined>(undefined);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, any[] | null>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      try {
        const list = await fetchStartups();
        const mine = list.find(s => s.founderMemberIds?.includes(user.id)) ?? list[0] ?? null;
        if (!live) return;
        setStartup(mine);
        if (!mine) return;
        const [ob, ...recs] = await Promise.allSettled([fetchOnboarding(mine.id), ...SECTIONS.map(s => fetchRecords(s.kind))]);
        if (!live) return;
        if (ob.status === 'fulfilled') { setDone(Object.fromEntries(Object.entries(ob.value.onboarding?.items ?? {}).map(([k, v]: any) => [k, !!v.done]))); setMissing(ob.value.gate?.missing ?? []); }
        setData(Object.fromEntries(SECTIONS.map((s, i) => [s.id, recs[i].status === 'fulfilled' ? (recs[i] as PromiseFulfilledResult<any[]>).value.filter((r: any) => !r.startupId || r.startupId === mine.id) : null])));
      } catch (e: any) { if (live) { setError(e.message); setStartup(null); } }
    })();
    return () => { live = false; };
  }, [user]);

  if (startup === undefined) return <div className="p-6 md:p-8 space-y-4" aria-busy="true"><Skeleton className="h-10 w-72" /><Skeleton className="h-32" /><Skeleton className="h-48" /></div>;
  if (!startup) {
    return (
      <div className="p-6 md:p-8"><PageHeader title="My programme" description="Your incubation progress in one place." />
        <p role={error ? 'alert' : 'status'} className="glass-panel rounded-2xl p-6 text-sm">{error || 'Your account is not linked to a startup yet. Please contact the RTBI team to link it.'}</p></div>
    );
  }

  const items = ONBOARDING_ITEMS.filter(i => i.required !== false || done[i.key]);
  const doneCount = items.filter(i => done[i.key]).length;
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader icon={<Rocket className="h-6 w-6" aria-hidden="true" />} title={startup.name} description={`${startup.id}${startup.cohort ? ` · ${startup.cohort}` : ''}`}
        actions={<><Badge tone={statusTone(startup.status)}>{startup.status}</Badge><Link href="/dashboard/incubation" className="inline-flex items-center min-h-11 px-4 rounded-xl border border-theme-border text-sm font-semibold hover:bg-theme-border/20">Edit startup profile</Link></>} />

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Onboarding" value={`${pct}%`} hint={`${doneCount} of ${items.length} items done`} tone={pct === 100 ? 'success' : 'warning'} />
        <StatCard label="Pathway" value={<span className="text-xl">{startup.pathway}</span>} />
        <StatCard label="Started" value={<span className="text-xl">{formatDate(startup.incubationStartDate, 'Not yet')}</span>} />
      </div>

      <section className="glass-panel rounded-2xl p-5" aria-labelledby="ob">
        <div className="flex items-center justify-between mb-2"><h2 id="ob" className="font-bold text-base">Onboarding checklist</h2>
          {startup.activatedAt ? <Badge tone="success">Activated</Badge> : <Badge tone="warning">Not yet activated</Badge>}</div>
        <div className="h-2 rounded-full bg-theme-border/40 overflow-hidden mb-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Onboarding progress"><div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} /></div>
        <ul className="grid md:grid-cols-2 gap-x-6 gap-y-1">
          {items.map(i => (
            <li key={i.key} className="flex items-start gap-2 min-h-9 text-sm">
              {done[i.key] ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" aria-hidden="true" /> : <Circle className="h-5 w-5 text-theme-text-secondary shrink-0" aria-hidden="true" />}
              <span><span className="font-medium">{i.label}</span><span className="sr-only">{done[i.key] ? ' (done)' : ' (pending)'}</span></span>
            </li>
          ))}
        </ul>
        {missing.length > 0 && !startup.activatedAt && <p className="text-sm text-theme-text-secondary mt-3">Still needed before activation: {missing.join(', ')}.</p>}
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        {SECTIONS.map(sec => {
          const rows = data[sec.id];
          return (
            <section key={sec.id} className="glass-panel rounded-2xl p-5" aria-labelledby={`s-${sec.id}`}>
              <h2 id={`s-${sec.id}`} className="font-bold text-base mb-2">{sec.title}</h2>
              {rows === null || rows === undefined
                ? <p className="text-sm text-theme-text-secondary">{rows === null ? 'Not available to your account.' : 'Loading…'}</p>
                : rows.length === 0 ? <p className="text-sm text-theme-text-secondary">{sec.empty}</p>
                : <ul className="divide-y divide-theme-border">{rows.slice(0, 5).map(r => <li key={r.id} className="py-2 text-sm flex flex-wrap items-center gap-x-2 gap-y-1">{sec.line(r)}</li>)}</ul>}
              {rows && rows.length > 5 && <p className="text-sm text-theme-text-secondary mt-2">Showing 5 of {rows.length}.</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
