'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { fetchApplications, fetchRecords, type ApplicationView } from '@/lib/incubation/client';
import { Badge, Panel, ragClass } from '@/components/incubation/ui';

/** "Startup scorecards" tab inside Ratings: my pending/submitted selection scorecards, plus recent RAG and graduation scorecards. */
export function ScorecardsPanel({ user }: { user: any }) {
  const [apps, setApps] = useState<ApplicationView[] | null>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [grads, setGrads] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchApplications().then(setApps).catch(e => setError(e.message));
    fetchRecords('review').then(setReviews).catch(() => setReviews([]));
    fetchRecords('graduation').then(setGrads).catch(() => setGrads([]));
  }, []);

  if (error) return <div className="text-xs text-red-400">{error}</div>;
  if (!apps) return <div className="text-xs flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>;

  const open = (id: string) => `/dashboard/incubation/applications?open=${id}`;
  const awaiting = apps.filter(a => a.viewer.assigned && a.status === 'Evaluation' && !a.viewer.ownScoreSubmitted && a.viewer.coi !== 'recuse');
  const mine = apps.filter(a => (a.scorecards || []).some(s => s.memberId === user?.id));
  const inEvaluation = apps.filter(a => a.status === 'Evaluation');
  const recentReviews = [...reviews].sort((a, b) => String(b.periodEnd || '').localeCompare(String(a.periodEnd || ''))).slice(0, 8);

  return (
    <div className="space-y-4">
      <Panel title="Awaiting my scorecard" hint="Selection scorecards are scored 1-5 per criterion behind a conflict-of-interest declaration; your scores stay hidden from other evaluators until you submit.">
        {awaiting.length === 0 ? <p className="text-xs text-theme-text-secondary">Nothing waiting for you.</p> : (
          <ul className="text-xs space-y-1">{awaiting.map(a => (
            <li key={a.id} className="flex justify-between gap-2"><span className="font-mono">{a.id}</span>
              <span className="text-theme-text-secondary">{a.viewer.coi === 'participate' ? 'COI filed' : 'COI declaration needed'}</span>
              <Link href={open(a.id)} className="text-accent font-semibold">Score</Link></li>))}</ul>)}
      </Panel>

      <Panel title="My submitted scorecards">
        {mine.length === 0 ? <p className="text-xs text-theme-text-secondary">None yet.</p> : (
          <table className="w-full text-xs"><thead><tr className="text-left text-theme-text-secondary"><th>Application</th><th>Weighted /100</th><th>Submitted</th><th /></tr></thead>
            <tbody>{mine.map(a => { const c = a.scorecards!.find(s => s.memberId === user?.id)!; return (
              <tr key={a.id}><td className="font-mono py-1">{a.id}</td><td>{c.weighted}</td><td>{c.submittedAt.slice(0, 10)}</td><td className="text-right"><Link href={open(a.id)} className="text-accent">Open</Link></td></tr>); })}</tbody></table>)}
      </Panel>

      {user?.tier <= 2 && (
        <Panel title="Applications in evaluation">
          {inEvaluation.length === 0 ? <p className="text-xs text-theme-text-secondary">None.</p> : (
            <ul className="text-xs space-y-1">{inEvaluation.map(a => (
              <li key={a.id} className="flex justify-between"><span><span className="font-mono">{a.id}</span> · {a.sections?.startupName || a.applicantName}</span>
                <span>{a.scorecards?.length ?? 0}/{a.assigned?.length ?? 0} submitted · <Link href={open(a.id)} className="text-accent">Open</Link></span></li>))}</ul>)}
        </Panel>
      )}

      {recentReviews.length > 0 && (
        <Panel title="Recent quarterly RAG reviews" hint="RAG is a management signal — it never terminates anyone automatically.">
          <ul className="text-xs space-y-1">{recentReviews.map(r => (
            <li key={r.id} className="flex items-center gap-2"><span className="font-mono">{r.startupId}</span><span>{r.quarter}</span>
              <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${ragClass[r.rag] || ''}`}>{r.rag}</span></li>))}</ul>
          <Link href="/dashboard/incubation/records/review" className="text-accent text-xs font-semibold">All quarterly reviews</Link>
        </Panel>
      )}

      {grads.length > 0 && (
        <Panel title="Graduation scorecards">
          <ul className="text-xs space-y-1">{grads.map(g => (
            <li key={g.id} className="flex items-center gap-2"><span className="font-mono">{g.startupId}</span><span>{g.total}/100</span><Badge tone={g.band === 'eligible' ? 'green' : g.band === 'conditional' ? 'amber' : 'red'}>{g.band}</Badge>
              <Badge tone={g.state === 'Final' ? 'green' : 'amber'}>{g.state}</Badge></li>))}</ul>
          <Link href="/dashboard/incubation/records/graduation" className="text-accent text-xs font-semibold">All graduation reviews</Link>
        </Panel>
      )}
    </div>
  );
}
