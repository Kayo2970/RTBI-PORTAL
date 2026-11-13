'use client';

import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, Legend,
} from 'recharts';
import { FileText, Lightbulb, AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { downloadFeedbackReport } from '@/lib/feedback-report-download';
import type { PublicFormItem, FormSubmissionItem } from '@/lib/local-data';
import {
  analyseFeedback, RATING_PARAMS,
  type ParamStats, type Insight, type SegmentStats,
} from '@/lib/feedback-analysis';

const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(15, 23, 42, 0.9)',
  borderColor: 'rgba(255,255,255,0.1)',
  borderRadius: '12px',
  fontSize: '11px',
};
// Diverging red → grey → blue for 1…5 (guide §6: best for rating-scale spread).
const SCORE_COLORS = ['#dc2626', '#f59e0b', '#94a3b8', '#60a5fa', '#2563eb'];
const ACCENT = '#3b82f6';
const MUTED = '#64748b';

const f1 = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d));
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`);

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="p-4 bg-theme-border/10 border border-theme-border/20 rounded-xl space-y-2">
      <div>
        <h5 className="text-xs font-bold text-theme-text-primary">{title}</h5>
        {note && <p className="text-[10px] text-theme-text-secondary mt-0.5">{note}</p>}
      </div>
      {children}
    </div>
  );
}

function Tile({ value, label, sub, accent }: { value: string; label: string; sub?: string; accent?: boolean }) {
  return (
    <div className="p-3 bg-theme-border/10 border border-theme-border/20 rounded-xl">
      <p className={`text-lg font-bold leading-none ${accent ? 'text-accent' : 'text-theme-text-primary'}`}>{value}</p>
      <p className="text-[10px] text-theme-text-secondary mt-1">{label}</p>
      {sub && <p className="text-[10px] text-theme-text-secondary/80">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider pt-2">{children}</h4>;
}

const TONE: Record<Insight['tone'], { cls: string; Icon: typeof Info }> = {
  good: { cls: 'bg-success/10 border-success/25 text-success', Icon: CheckCircle2 },
  warn: { cls: 'bg-warning/10 border-warning/25 text-warning', Icon: AlertTriangle },
  bad: { cls: 'bg-danger/10 border-danger/25 text-danger', Icon: ShieldAlert },
  info: { cls: 'bg-accent/10 border-accent/25 text-accent', Icon: Info },
};

function heat(mean: number | null): string {
  if (mean === null) return 'transparent';
  // 1 → red, 3 → amber, 5 → blue
  const t = Math.max(0, Math.min(1, (mean - 1) / 4));
  const hue = 0 + t * 215; // red(0) … blue(215)
  return `hsla(${hue}, 70%, 45%, 0.35)`;
}

const SegmentTable = ({ title, segs }: { title: string; segs: SegmentStats[] }) => {
  if (segs.length === 0) return null;
  const big = segs.filter(s => s.n >= 10);
  return (
    <Card title={title} note="Groups under 10 responses are shown for reference only and left out of the heatmap.">
      <div className="overflow-x-auto">
        <table className="min-w-full text-[11px] text-left">
          <thead>
            <tr className="text-theme-text-secondary border-b border-theme-border/40">
              <th className="py-1.5 pr-3 font-semibold">Group</th>
              <th className="py-1.5 pr-3 font-semibold text-right">n</th>
              <th className="py-1.5 pr-3 font-semibold text-right">Respondent index</th>
              <th className="py-1.5 pr-3 font-semibold text-right">Top-2-box</th>
              <th className="py-1.5 font-semibold text-right">Will apply</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-theme-border/20">
            {segs.map(s => (
              <tr key={s.name} className={s.n < 10 ? 'text-theme-text-secondary' : 'text-theme-text-primary'}>
                <td className="py-1.5 pr-3">{s.name}{s.n < 10 && <span className="ml-1.5 text-[9px] opacity-70">(n&lt;10)</span>}</td>
                <td className="py-1.5 pr-3 text-right">{s.n}</td>
                <td className="py-1.5 pr-3 text-right font-semibold">{s.indexMean.toFixed(2)}</td>
                <td className="py-1.5 pr-3 text-right">{pct(s.top2)}</td>
                <td className="py-1.5 text-right">{pct(s.applyYesPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {big.length >= 2 && (
        <div className="overflow-x-auto pt-2">
          <table className="min-w-full text-[10px] text-center border-separate border-spacing-0.5">
            <thead>
              <tr className="text-theme-text-secondary">
                <th className="text-left font-semibold pr-2">Parameter</th>
                {big.map(s => <th key={s.name} className="font-semibold px-1">{s.name}<br />n={s.n}</th>)}
              </tr>
            </thead>
            <tbody>
              {RATING_PARAMS.map(p => (
                <tr key={p.key}>
                  <td className="text-left pr-2 text-theme-text-secondary whitespace-nowrap">{p.short}</td>
                  {big.map(s => (
                    <td key={s.name} className="px-2 py-1 rounded text-theme-text-primary font-semibold" style={{ background: heat(s.paramMeans[p.key]) }}>
                      {f1(s.paramMeans[p.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

const ParamRow = ({ p, avg }: { p: ParamStats; avg: number | null }) => (
  <tr className="text-theme-text-primary">
    <td className="py-1.5 pr-3 font-semibold whitespace-nowrap">{p.label}</td>
    <td className="py-1.5 pr-2 text-right">{p.n}</td>
    <td className="py-1.5 pr-2 text-right font-semibold">{f1(p.mean)}</td>
    <td className="py-1.5 pr-2 text-right text-theme-text-secondary">{p.ci === null ? '—' : `±${p.ci.toFixed(2)}`}</td>
    <td className="py-1.5 pr-2 text-right">{f1(p.median, 1)}</td>
    <td className="py-1.5 pr-2 text-right">{f1(p.mode, 0)}</td>
    <td className={`py-1.5 pr-2 text-right ${(p.sd ?? 0) > 1.1 ? 'text-warning font-semibold' : ''}`}>{f1(p.sd)}</td>
    <td className="py-1.5 pr-2 text-right">{pct(p.top2)}</td>
    <td className="py-1.5 pr-2 text-right">{pct(p.bottom2)}</td>
    <td className="py-1.5 pr-2 text-right">{p.net === null ? '—' : `${p.net > 0 ? '+' : ''}${Math.round(p.net)}`}</td>
    <td className={`py-1.5 pr-2 text-right ${p.mean !== null && avg !== null && p.mean < avg - 0.25 ? 'text-warning font-semibold' : ''}`}>
      {p.mean === null || avg === null ? '—' : `${p.mean - avg >= 0 ? '+' : ''}${(p.mean - avg).toFixed(2)}`}
    </td>
    <td className="py-1.5 text-right">{p.rank ?? '—'}</td>
  </tr>
);


export function FeedbackAnalysisPanel({ form, submissions }: { form: PublicFormItem; submissions: FormSubmissionItem[] }) {
  const [building, setBuilding] = useState(false);

  const a = useMemo(() => analyseFeedback(form, submissions), [form, submissions]);

  const avg = a.overallMean;

  if (a.n === 0) return null;

  const sorted = [...a.params].filter(p => p.mean !== null).sort((x, y) => (y.mean as number) - (x.mean as number));
  const meansData = sorted.map(p => ({ name: p.label, mean: Number((p.mean as number).toFixed(2)), n: p.n }));
  const stackedData = sorted.map(p => ({
    name: p.label,
    ...Object.fromEntries(p.counts.map((c, i) => [`s${i + 1}`, p.n ? Number(((c / p.n) * 100).toFixed(1)) : 0])),
  }));
  const overallHist = a.overall.counts.map((count, i) => ({ name: String(i + 1), count }));

  const downloadReport = async () => {
    setBuilding(true);
    try {
      await downloadFeedbackReport(form, submissions);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-accent/10 border border-accent/20 rounded-xl">
        <div className="flex items-center gap-2 text-xs font-bold text-theme-text-primary">
          <Lightbulb className="h-4 w-4 text-accent" />
          Feedback Analysis
          <span className="font-normal text-theme-text-secondary">· {a.n} form{a.n === 1 ? '' : 's'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-theme-text-secondary">
          <button
            onClick={downloadReport}
            disabled={building}
            className="px-2.5 py-1 bg-accent hover:bg-accent/90 disabled:opacity-60 text-white rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            title="Download a written report (charts, observations, tables, conclusions and recommendations) as a Word document"
          >
            <FileText className="h-3.5 w-3.5" /> {building ? 'Preparing…' : 'Word report'}
          </button>
        </div>
      </div>

      {/* Headline tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile value={String(a.n)} label="Forms received" />
        <Tile accent value={a.overall.mean === null ? '—' : `${a.overall.mean.toFixed(2)} / 5`} label="Overall rating" sub={a.overall.ci === null ? `n=${a.overall.n}` : `±${a.overall.ci.toFixed(2)} · n=${a.overall.n}`} />
        <Tile value={pct(a.overall.top2)} label="Top-2-box (overall)" sub={`n=${a.overall.n}`} />
        <Tile value={a.knowledge.ci ? pct(a.knowledge.ci.p * 100) : '—'} label="Knowledge gained" sub={a.knowledge.ci ? `${pct(a.knowledge.ci.lo * 100)}–${pct(a.knowledge.ci.hi * 100)} · n=${a.knowledge.n}` : undefined} />
        <Tile value={a.apply.ci ? pct(a.apply.ci.p * 100) : '—'} label="Will apply learning" sub={a.apply.ci ? `${pct(a.apply.ci.lo * 100)}–${pct(a.apply.ci.hi * 100)} · n=${a.apply.n}` : undefined} />
        <Tile value={a.outcomeIndex === null ? '—' : pct(a.outcomeIndex)} label="Outcome achievement" sub={a.fullAchievement === null ? undefined : `${pct(a.fullAchievement)} met all five`} />
      </div>
      {/* Findings */}
      {a.insights.length > 0 && (
        <div className="space-y-2">
          {a.insights.map((ins, i) => {
            const { cls, Icon } = TONE[ins.tone];
            return (
              <div key={i} className={`p-3 border rounded-xl text-xs flex gap-2 ${cls}`}>
                <Icon className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">{ins.title}</p>
                  <p className="text-theme-text-secondary mt-0.5">{ins.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SectionTitle>Parameter results</SectionTitle>
      <Card title="Summary statistics" note="95% interval = the range the true mean of all attendees probably lies in. SD above 1.1 (amber) means split opinions. vs avg is the mean minus this event’s own average across the nine parameters (amber = at least 0.25 below).">
        <div className="overflow-x-auto">
          <table className="min-w-full text-[11px] text-left">
            <thead>
              <tr className="text-theme-text-secondary border-b border-theme-border/40">
                <th className="py-1.5 pr-3 font-semibold">Parameter</th>
                <th className="py-1.5 pr-2 font-semibold text-right">n</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Mean</th>
                <th className="py-1.5 pr-2 font-semibold text-right">95% CI</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Median</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Mode</th>
                <th className="py-1.5 pr-2 font-semibold text-right">SD</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Top-2</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Bottom-2</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Net</th>
                <th className="py-1.5 pr-2 font-semibold text-right">vs avg</th>
                <th className="py-1.5 font-semibold text-right">Rank</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-border/20">
              {a.params.map(p => <ParamRow key={p.key} p={p} avg={avg} />)}
              <ParamRow p={a.overall} avg={avg} />
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Mean of each rating, strongest to weakest" note={`Axis fixed at 0–5; dashed line = this event's own average${avg === null ? '' : ` (${avg.toFixed(2)})`}.`}>
          <div style={{ height: Math.max(180, meansData.length * 30) }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={meansData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" domain={[0, 5]} tick={{ fill: 'currentColor', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fill: 'currentColor', fontSize: 10 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Mean']} />
                {avg !== null && <ReferenceLine x={avg} stroke="#f59e0b" strokeDasharray="4 3" />}
                <Bar dataKey="mean" radius={[0, 6, 6, 0]}>
                  {meansData.map((d, i) => <Cell key={i} fill={avg === null || d.mean >= avg ? ACCENT : MUTED} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="How scores are spread (% of responses)" note="Red/amber = unhappy, grey = neutral, blue = satisfied.">
          <div style={{ height: Math.max(180, stackedData.length * 30) }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackedData} layout="vertical" stackOffset="expand" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fill: 'currentColor', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fill: 'currentColor', fontSize: 10 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => [`${v}%`, `Score ${String(name).slice(1)}`]} />
                <Legend formatter={(v) => `Score ${String(v).slice(1)}`} wrapperStyle={{ fontSize: 10 }} />
                {[1, 2, 3, 4, 5].map(s => (
                  <Bar key={s} dataKey={`s${s}`} stackId="a" fill={SCORE_COLORS[s - 1]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Dimension scores" note="Design = relevance + clarity · Content = depth + practical use · Delivery = speaker + interaction · Support = tools + organization.">
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a.dimensions.map(d => ({ name: d.label, mean: d.mean === null ? 0 : Number(d.mean.toFixed(2)) }))} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 10 }} />
                <YAxis domain={[0, 5]} tick={{ fill: 'currentColor', fontSize: 10 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Mean']} />
                {avg !== null && <ReferenceLine y={avg} stroke="#f59e0b" strokeDasharray="4 3" />}
                <Bar dataKey="mean" radius={[6, 6, 0, 0]}>
                  {a.dimensions.map((d, i) => <Cell key={i} fill={avg === null || (d.mean ?? 0) >= avg ? ACCENT : MUTED} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Overall rating (out of 5)" note={a.overall.mean === null ? undefined : `Mean ${a.overall.mean.toFixed(2)} · n=${a.overall.n}`}>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={overallHist} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fill: 'currentColor', fontSize: 10 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v} response${v === 1 ? '' : 's'}`, 'Count']} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {overallHist.map((_, i) => <Cell key={i} fill={SCORE_COLORS[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {a.respondentIndex && (
          <Card title="Each person's average rating" note={`Respondent index: mean ${a.respondentIndex.mean.toFixed(2)}, SD ${a.respondentIndex.sd.toFixed(2)}. A second peak means two audience types.`}>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a.respondentIndex.hist} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="bin" tick={{ fill: 'currentColor', fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fill: 'currentColor', fontSize: 10 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v} respondent${v === 1 ? '' : 's'}`, 'Count']} />
                  <Bar dataKey="count" fill={ACCENT} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </div>

      <SectionTitle>Learning outcomes &amp; impact</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Learning outcomes met (% ticking Yes)" note={a.fullAchievement === null ? undefined : `Outcome achievement index ${pct(a.outcomeIndex)} · ${pct(a.fullAchievement)} of respondents met all five.`}>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...a.outcomes].sort((x, y) => y.pct - x.pct).map(o => ({ name: o.short, pct: Math.round(o.pct), n: o.n }))} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fill: 'currentColor', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fill: 'currentColor', fontSize: 10 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Met']} />
                <Bar dataKey="pct" fill={ACCENT} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Impact (% Yes, with 95% interval)" note="Intervals show how precise each figure is — wide ones need more forms.">
          <div className="space-y-4 pt-2">
            {[{ label: 'Enhanced knowledge / skills', d: a.knowledge }, { label: 'Will apply the learning', d: a.apply }].map(({ label, d }) => (
              <div key={label} className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-theme-text-primary font-semibold">{label}</span>
                  <span className="text-theme-text-secondary">
                    {d.ci ? `${pct(d.ci.p * 100)} (${pct(d.ci.lo * 100)}–${pct(d.ci.hi * 100)}) · n=${d.n}` : 'No answers'}
                  </span>
                </div>
                <div className="relative h-3 bg-theme-border/30 rounded-full overflow-hidden">
                  {d.ci && <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${d.ci.p * 100}%` }} />}
                  {d.ci && <div className="absolute inset-y-0 bg-white/40" style={{ left: `${d.ci.lo * 100}%`, width: `${(d.ci.hi - d.ci.lo) * 100}%` }} />}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <SectionTitle>Segments</SectionTitle>
      <div className="grid grid-cols-1 gap-4">
        <SegmentTable title="By designation / programme / semester" segs={a.designations} />
        <SegmentTable title="By department" segs={a.departments} />
      </div>

      {(a.regression || a.alpha) && <SectionTitle>Drivers &amp; reliability</SectionTitle>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {a.regression && (
          <Card title="What drives the overall rating?" note={`Standardised regression coefficients (β) of the overall rating on the eight other ratings · R² ${a.regression.r2.toFixed(2)} · n=${a.regression.n}. Correlation is not cause.`}>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[...a.regression.betas].sort((x, y) => y.beta - x.beta).map(b => ({ name: RATING_PARAMS.find(p => p.key === b.key)?.short ?? b.key, beta: Number(b.beta.toFixed(2)) }))}
                  layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'currentColor', fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fill: 'currentColor', fontSize: 10 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'β']} />
                  <ReferenceLine x={0} stroke={MUTED} />
                  <Bar dataKey="beta" radius={[0, 6, 6, 0]}>
                    {a.regression.betas.map((b, i) => <Cell key={i} fill={b.beta >= 0 ? ACCENT : '#ef4444'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
        {a.alpha && (
          <Card title="Do the nine ratings measure one thing?" note={`Cronbach's alpha over ${a.alpha.n} complete forms. 0.70+ acceptable, 0.80+ good.`}>
            <p className={`text-2xl font-black ${a.alpha.alpha >= 0.8 ? 'text-success' : a.alpha.alpha >= 0.7 ? 'text-accent' : 'text-warning'}`}>
              {a.alpha.alpha.toFixed(2)}
            </p>
            <p className="text-[11px] text-theme-text-secondary">
              {a.alpha.alpha >= 0.8 ? 'Good — the nine ratings can be combined into the respondent index.' : a.alpha.alpha >= 0.7 ? 'Acceptable — the respondent index is reasonable to use.' : 'Below 0.70 — read the ratings separately rather than as one index.'}
            </p>
          </Card>
        )}
      </div>

      <SectionTitle>Open comments</SectionTitle>
      <p className="text-[10px] text-theme-text-secondary -mt-2">
        Auto-coded by keyword as a first pass — one respondent can appear under several themes. Spot-check against the raw answers before quoting figures in a report.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {a.comments.map(c => (
          <Card key={c.key} title={c.title} note={`${c.answered} of ${a.n} answered`}>
            {c.themes.length === 0 ? (
              <p className="text-[11px] text-theme-text-secondary py-3 text-center">No themes detected yet.</p>
            ) : (
              <div className="space-y-2.5">
                {c.themes.slice(0, 6).map(t => (
                  <div key={t.theme} className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="font-semibold text-theme-text-primary">{t.theme}</span>
                      <span className="text-theme-text-secondary">{t.respondents} · {Math.round(t.pct)}%</span>
                    </div>
                    <div className="h-1.5 bg-theme-border/30 rounded-full overflow-hidden">
                      <div className="h-full bg-accent" style={{ width: `${Math.min(100, t.pct)}%` }} />
                    </div>
                    {t.quotes[0] && <p className="text-[10px] italic text-theme-text-secondary">&ldquo;{t.quotes[0]}&rdquo;</p>}
                  </div>
                ))}
              </div>
            )}
            {c.key === 'future' && c.themes.some(t => t.pct >= 10) && (
              <p className="text-[10px] text-accent pt-1">Topics named by 10% or more of respondents point to real demand.</p>
            )}
          </Card>
        ))}
      </div>

      {(a.quality.straightLined > 0 || a.quality.contradictions > 0 || a.quality.duplicates > 0) && (
        <p className="text-[10px] text-theme-text-secondary">
          Data quality: {a.quality.straightLined} straight-lined · {a.quality.contradictions} contradictory · {a.quality.duplicates} possible duplicate(s). Flags are included as columns in the analysis dataset so results can be re-run without them.
        </p>
      )}
    </div>
  );
}
