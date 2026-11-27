'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Rocket } from 'lucide-react';
import { fetchAlerts, fetchApplications, fetchStartups } from '@/lib/incubation/client';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';

/** Role-aware incubation card for the dashboard home: portfolio numbers for staff, a pointer to "My programme" for startups. */
export function IncubationSnapshot({ user }: { user: { tier: number; externalReviewer?: boolean } | null }) {
  const [d, setD] = useState<{ active: number; total: number; overdue: number; apps: number; top: { id: string; title: string; link: string }[] } | null>(null);
  const staff = !!user && user.tier <= 3 && !user.externalReviewer;

  useEffect(() => {
    if (!staff) return;
    let live = true;
    Promise.allSettled([fetchStartups(), fetchAlerts(), fetchApplications()]).then(([s, a, p]) => {
      if (!live) return;
      const st = s.status === 'fulfilled' ? s.value : [];
      const al = a.status === 'fulfilled' ? a.value : [];
      const ap = p.status === 'fulfilled' ? p.value : [];
      setD({
        active: st.filter(x => x.status === 'Active').length, total: st.length,
        overdue: al.filter(x => x.severity === 'overdue').length,
        apps: ap.filter(x => !['Ineligible', 'Decision final', 'Withdrawn'].includes(x.status as string)).length,
        top: al.filter(x => x.severity === 'overdue').slice(0, 3).map(x => ({ id: x.id, title: x.title, link: x.link })),
      });
    });
    return () => { live = false; };
  }, [staff]);

  if (!user) return null;
  if (user.tier === 4) {
    return (
      <Link href="/dashboard/incubation/workspace" className="glass-panel rounded-2xl p-5 flex items-center justify-between gap-3 hover:border-primary">
        <span className="flex items-center gap-3"><Rocket className="h-6 w-6 text-accent-strong dark:text-accent-soft" aria-hidden="true" /><span><span className="block font-bold">My programme</span><span className="block text-sm text-theme-text-secondary">Onboarding, milestones, mentor sessions and reviews.</span></span></span>
        <ArrowRight className="h-5 w-5" aria-hidden="true" />
      </Link>
    );
  }
  if (!staff || !d) return null;
  return (
    <section className="glass-panel rounded-2xl p-5 space-y-4" aria-labelledby="inc-snap">
      <div className="flex items-center justify-between gap-3">
        <h2 id="inc-snap" className="font-bold text-base flex items-center gap-2"><Rocket className="h-5 w-5 text-accent-strong dark:text-accent-soft" aria-hidden="true" /> Incubation snapshot</h2>
        <Link href="/dashboard/incubation/overview" className="inline-flex items-center gap-1 min-h-11 px-2 text-sm font-semibold underline text-accent-strong dark:text-accent-soft">Open overview <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Active startups" value={d.active} hint={`${d.total} in registry`} />
        <StatCard label="Applications open" value={d.apps} />
        <StatCard label="Overdue" value={d.overdue} tone={d.overdue ? 'danger' : 'success'} />
      </div>
      {d.top.length > 0 && (
        <ul className="divide-y divide-theme-border">
          {d.top.map(t => <li key={t.id}><Link href={t.link} className="flex items-center gap-2 min-h-11 text-sm hover:underline"><Badge tone="danger">Overdue</Badge>{t.title}</Link></li>)}
        </ul>
      )}
    </section>
  );
}
