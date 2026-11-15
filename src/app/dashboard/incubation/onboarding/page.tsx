'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ClipboardCheck, Loader2, FileDown } from 'lucide-react';
import { activateStartup, fetchOnboarding, fetchStartups, saveOnboarding } from '@/lib/incubation/client';
import { downloadPdf } from '@/lib/incubation/pdf';
import { FEE_BASES, ONBOARDING_ITEMS, type GateResult, type OnboardingRecord } from '@/lib/incubation/onboarding';
import type { Startup } from '@/lib/incubation/types';
import { Badge, PageHeader, Panel, btnGhost, btnPrimary, inputCls, isManagerUi, isStaffUi, useCurrentUser } from '@/components/incubation/ui';

function OnboardingPageInner() {
  const user = useCurrentUser();
  const router = useRouter();
  const params = useSearchParams();
  const startupId = params.get('startup') || '';
  const [startups, setStartups] = useState<Startup[]>([]);
  const [data, setData] = useState<{ startup: Startup; onboarding: OnboardingRecord; gate: GateResult } | null>(null);
  const [items, setItems] = useState<OnboardingRecord['items']>({});
  const [cond, setCond] = useState({ ref: '', scope: '', endsOn: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const manager = isManagerUi(user);
  const staff = isStaffUi(user);

  useEffect(() => { fetchStartups().then(setStartups).catch(e => setErr(e.message)); }, []);
  const load = useCallback(async () => {
    if (!startupId) { setData(null); return; }
    try {
      const d = await fetchOnboarding(startupId);
      setData(d); setItems(d.onboarding.items || {});
      setCond({ ref: d.onboarding.conditionalApproval?.ref || '', scope: d.onboarding.conditionalApproval?.scope || '', endsOn: d.onboarding.conditionalApproval?.endsOn || '' });
      setErr('');
    } catch (e: any) { setErr(e.message); }
  }, [startupId]);
  useEffect(() => { load(); }, [load]);

  const patch = (key: string, p: Partial<OnboardingRecord['items'][string]>) => setItems(prev => ({ ...prev, [key]: { ...(prev[key] || { done: false }), ...p } }));
  const save = async (withCond = false) => {
    setBusy(true); setErr(''); setMsg('');
    try { await saveOnboarding(startupId, { items, ...(withCond ? { conditionalApproval: cond.ref && cond.scope ? cond : null } : {}) }); await load(); setMsg('Saved.'); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const activate = async () => {
    setBusy(true); setErr(''); setMsg('');
    try { const r = await activateStartup(startupId); setMsg(`Activated (${r.basis} basis).`); await load(); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  const s = data?.startup;
  return (
    <div className="p-6 md:p-8 space-y-6 max-w-4xl">
      <PageHeader icon={<ClipboardCheck size={20} />} title="Onboarding & Activation"
        subtitle="A selection decision does not by itself activate services. A startup becomes Active only when all 10 items are complete with evidence — or a written conditional approval is attached." />
      <select className={inputCls + ' max-w-md'} value={startupId} onChange={e => router.replace(`/dashboard/incubation/onboarding${e.target.value ? `?startup=${e.target.value}` : ''}`)}>
        <option value="">Choose a startup…</option>{startups.map(x => <option key={x.id} value={x.id}>{x.id} — {x.name} ({x.status})</option>)}
      </select>
      {err && <div className="text-xs text-red-400 whitespace-pre-line">{err}</div>}
      {msg && <div className="text-xs text-emerald-400">{msg}</div>}
      {!data && startupId && <div className="text-xs flex gap-2 items-center"><Loader2 size={14} className="animate-spin" /> Loading…</div>}

      {data && s && (
        <>
          <div className="flex flex-wrap items-center gap-2"><Badge tone={s.status === 'Active' ? 'green' : 'amber'}>{s.status}</Badge>
            {s.activationBasis && <Badge tone={s.activationBasis === 'conditional' ? 'amber' : 'green'}>{s.activationBasis} basis</Badge>}
            {manager && <button className={btnGhost} onClick={() => downloadPdf(`admission-${s.id}.pdf`, 'Admission letter', `${s.id} — ${s.name}`, [{ lines: [`Dear ${s.name},`, 'We are pleased to confirm your admission to the RTBI incubation programme, subject to the conditions below and to execution of the incubation agreement.', `Pathway: ${s.pathway}${s.mode ? ` · Mode: ${s.mode}` : ''}.`, 'Conditions: as recorded in the selection decision note.', 'Services begin only once onboarding is complete.'] }])}><FileDown size={12} /> Admission letter (template)</button>}</div>

          <Panel title="Checklist">
            {ONBOARDING_ITEMS.map(it => {
              const st = items[it.key] || { done: false };
              return (
                <div key={it.key} className="rounded-xl border border-theme-border/30 p-3 space-y-2">
                  <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" disabled={!staff} checked={!!st.done} onChange={e => patch(it.key, { done: e.target.checked })} />
                    <span><b>{it.label}</b><span className="block text-theme-text-secondary">{it.evidence} · Owner: {it.owner}</span></span></label>
                  {st.done && <div className="grid md:grid-cols-2 gap-2 pl-6">
                    <input className={inputCls} placeholder="Evidence reference (document / ID) *" disabled={!staff} value={st.evidenceRef || ''} onChange={e => patch(it.key, { evidenceRef: e.target.value })} />
                    {it.key === 'fees' && <select className={inputCls} disabled={!staff} value={st.feeBasis || ''} onChange={e => patch(it.key, { feeBasis: e.target.value })}><option value="">Fee basis…</option>{FEE_BASES.map(f => <option key={f}>{f}</option>)}</select>}
                  </div>}
                </div>
              );
            })}
            {staff && <button className={btnPrimary} disabled={busy} onClick={() => save(false)}>Save checklist</button>}
          </Panel>

          <Panel title="Written conditional approval" hint="Only a written conditional approval can allow limited pre-admission activity. CEO / Super User only.">
            <div className="grid md:grid-cols-3 gap-2">
              <input className={inputCls} placeholder="Approval reference" disabled={!manager} value={cond.ref} onChange={e => setCond({ ...cond, ref: e.target.value })} />
              <input className={inputCls} placeholder="Scope of limited activity" disabled={!manager} value={cond.scope} onChange={e => setCond({ ...cond, scope: e.target.value })} />
              <input type="date" className={inputCls} disabled={!manager} value={cond.endsOn} onChange={e => setCond({ ...cond, endsOn: e.target.value })} />
            </div>
            {manager && <button className={btnGhost} disabled={busy} onClick={() => save(true)}>Save conditional approval</button>}
          </Panel>

          <Panel title="Activation gate">
            {data.gate.ok ? <p className="text-xs text-emerald-400">Ready to activate on a <b>{data.gate.basis}</b> basis.{data.gate.basis === 'conditional' && data.gate.missing.length ? ' Outstanding items remain:' : ''}</p> : <p className="text-xs text-amber-400">Not ready. Still needed:</p>}
            {data.gate.missing.length > 0 && <ul className="text-xs list-disc pl-5 text-theme-text-secondary">{data.gate.missing.map(m => <li key={m}>{m}</li>)}</ul>}
            {manager && s.status !== 'Active' && <button className={btnPrimary} disabled={busy || !data.gate.ok} onClick={activate}>Activate startup</button>}
          </Panel>
        </>
      )}
    </div>
  );
}

export default function OnboardingPage() {
  return <Suspense fallback={null}><OnboardingPageInner /></Suspense>;
}
