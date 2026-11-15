'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FileText, Loader2, FileDown, Archive } from 'lucide-react';
import { actOnApplication, createRecord, fetchApplications, fetchIncubationSettings, fetchMembersLite, type ApplicationView } from '@/lib/incubation/client';
import { buildPdf, downloadPdf, type PdfSection } from '@/lib/incubation/pdf';
import { weightsValid } from '@/lib/incubation/rules';
import { APPLICATION_SECTIONS, DECISION_OPTIONS, SCREENING_AREAS, type IncubationSettings } from '@/lib/incubation/types';
import { Badge, Modal, PageHeader, Panel, btnGhost, btnPrimary, inputCls, isManagerUi, isStaffUi, useCurrentUser } from '@/components/incubation/ui';

const statusTone = (s?: string) => (s === 'Decision final' ? 'green' : s === 'Ineligible' ? 'red' : s === 'Clarification required' || s === 'Decision recorded' ? 'amber' : 'blue') as 'green' | 'red' | 'amber' | 'blue';

function ApplicationsPageInner() {
  const user = useCurrentUser();
  const params = useSearchParams();
  const [apps, setApps] = useState<ApplicationView[]>([]);
  const [settings, setSettings] = useState<IncubationSettings | null>(null);
  const [members, setMembers] = useState<{ id: string; name: string; tier: number }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const [a, s] = await Promise.all([fetchApplications(), fetchIncubationSettings()]); setApps(a); setSettings(s); setError(''); } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (isStaffUi(user)) fetchMembersLite().then(m => setMembers(m.filter(x => x.tier <= 3))).catch(() => {}); }, [user]);
  useEffect(() => { const o = params.get('open'); if (o) setOpenId(o); }, [params]);

  const open = apps.find(a => a.id === openId) || null;
  const replace = (a: ApplicationView) => setApps(p => p.map(x => (x.id === a.id ? a : x)));
  const manager = isManagerUi(user);

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader icon={<FileText size={20} />} title="Applications & Selection"
        subtitle="Public applications (/apply) are screened, scored independently by assigned evaluators behind a conflict-of-interest gate, then decided and finally approved by the configured authority." />
      {manager && <p className="text-xs">Public application link: <span className="font-mono">/apply</span></p>}
      {settings?.scorecard.status !== 'approved' && <div className="text-xs rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 p-3">Scorecard weights are still <b>Proposed</b>. Decisions can be recorded but not finalised until they are approved in Incubation Settings.</div>}
      {error && <div className="text-xs text-red-400">{error}</div>}
      {loading ? <div className="text-xs flex gap-2 items-center"><Loader2 size={14} className="animate-spin" /> Loading…</div> : apps.length === 0 ? (
        <div className="glass-panel rounded-2xl p-8 text-center text-xs text-theme-text-secondary">No applications {manager ? 'yet' : 'assigned to you'}.</div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-theme-text-secondary border-b border-theme-border/30"><th className="p-3">ID</th><th className="p-3">Startup</th><th className="p-3">Received</th><th className="p-3">Status</th><th className="p-3">Scorecards</th><th /></tr></thead>
            <tbody>{apps.map(a => (
              <tr key={a.id} className="border-b border-theme-border/20">
                <td className="p-3 font-mono">{a.id}</td>
                <td className="p-3">{a.gated ? <i className="text-theme-text-secondary">hidden until COI filed</i> : a.sections?.startupName || a.applicantName}</td>
                <td className="p-3">{a.receivedAt?.slice(0, 10)}</td>
                <td className="p-3"><Badge tone={statusTone(a.status)}>{a.status}</Badge></td>
                <td className="p-3">{(a.scorecards?.length ?? 0)}/{a.assigned?.length ?? 0}</td>
                <td className="p-3 text-right"><button className="text-accent font-semibold" onClick={() => setOpenId(a.id)}>Open</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {open && settings && <Detail app={open} settings={settings} members={members} user={user} onClose={() => setOpenId(null)} onChange={replace} />}
    </div>
  );
}

function Detail({ app, settings, members, user, onClose, onChange }: { app: ApplicationView; settings: IncubationSettings; members: { id: string; name: string }[]; user: any; onClose: () => void; onChange: (a: ApplicationView) => void }) {
  const manager = app.viewer.isManager;
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true); setErr('');
    try { onChange(await actOnApplication(app.id, body)); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  // --- screening state
  const [checks, setChecks] = useState<Record<string, { result: string; evidence: string }>>(() => Object.fromEntries(SCREENING_AREAS.map(a => [a, { result: app.screening?.checks?.[a]?.result || 'yes', evidence: app.screening?.checks?.[a]?.evidence || '' }])));
  const [outcome, setOutcome] = useState('eligible');
  const [criterion, setCriterion] = useState('');
  const [items, setItems] = useState('');
  const [days, setDays] = useState(settings.timers.clarificationWorkingDays.min);
  // --- assignment
  const [picked, setPicked] = useState<Record<string, { on: boolean; specialist: boolean }>>(() => Object.fromEntries((app.assigned || []).map(a => [a.memberId, { on: true, specialist: !!a.specialist }])));
  // --- coi / score
  const [conflict, setConflict] = useState(false);
  const [mitigation, setMitigation] = useState('');
  const [coiAction, setCoiAction] = useState('participate');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [recommendation, setRecommendation] = useState('');
  const [comments, setComments] = useState('');
  // --- decision
  const [dec, setDec] = useState({ option: DECISION_OPTIONS[0] as string, authority: '', minutesRef: '', conditions: '', owner: '', dueDate: '', notes: '', overrideReason: '', reasonCategory: '' });
  const [approvalRef, setApprovalRef] = useState('');

  const myCoi = app.coi?.find(c => c.memberId === user?.id);
  const myCard = app.scorecards?.find(s => s.memberId === user?.id);
  const criteria = settings.scorecard.criteria;
  const isApprover = (() => { const r = settings.approvalRoutes.selection; return r.approverMemberIds.length ? r.approverMemberIds.includes(user?.id) : (user?.tier ?? 9) <= r.approverMaxTier; })();

  const dossier = (): { title: string; sub: string; sections: PdfSection[] } => ({
    title: `Selection dossier — ${app.id}`, sub: `${app.sections?.startupName || app.applicantName} · received ${app.receivedAt?.slice(0, 10)}`,
    sections: [
      ...APPLICATION_SECTIONS.map(s => ({ heading: `${s.key}. ${s.label}`, lines: s.fields.filter(f => app.sections?.[f.key]).map(f => `${f.label}: ${app.sections![f.key]}`) })),
      { heading: 'Screening', lines: app.screening ? [`Outcome: ${app.screening.outcome}${app.screening.criterion ? ` (${app.screening.criterion})` : ''}`, ...Object.entries(app.screening.checks).map(([k, v]) => `${k}: ${v.result}${v.evidence ? ` — ${v.evidence}` : ''}`)] : ['Not screened'] },
      { heading: 'Conflict-of-interest declarations', lines: (app.coi || []).map(c => `${c.memberName}: ${c.conflict ? `conflict (${c.mitigation})` : 'none'} → ${c.action}`) },
      { heading: `Scorecards (weights ${settings.scorecard.status})`, lines: (app.scorecards || []).map(s => `${s.memberName}${s.specialist ? ' (specialist)' : ''}: ${s.weighted}/100 — ${s.recommendation || ''} ${s.comments || ''}`) },
      { heading: 'Decision', lines: app.decision ? [`${app.decision.option} — authority: ${app.decision.authority}`, `Aggregate: ${app.decision.aggregate ?? 'n/a'}`, `Minutes ref: ${app.decision.minutesRef || '—'}`, app.decision.finalisedAt ? `Final, approval ref ${app.decision.approvalRef}` : 'Not yet final — pending approval', app.decision.conditions ? `Conditions: ${app.decision.conditions}` : ''] : ['No decision'] },
    ],
  });
  const filePdf = async (kind: 'dossier' | 'decision') => {
    setBusy(true); setErr('');
    try {
      const d = dossier();
      const sections = kind === 'decision' ? d.sections.slice(-1) : d.sections;
      const title = kind === 'decision' ? `Selection decision note — ${app.id}` : d.title;
      const { dataUrl } = buildPdf(title, d.sub, sections);
      await createRecord('evidence', { startupId: app.startupId, kpiKey: 'general', title, docRef: app.id, evidenceDate: new Date().toISOString().slice(0, 10), responsibleId: user.id, verifierId: members.find(m => m.id !== user.id)?.id, file: { name: `${kind}-${app.id}.pdf`, type: 'application/pdf', dataUrl } });
      alert('Filed in the evidence index.');
    } catch (e: any) { setErr(e.message + (e.message.includes('Verified') ? '' : '')); }
    setBusy(false);
  };

  return (
    <Modal wide title={`${app.id}${app.gated ? '' : ` — ${app.sections?.startupName || app.applicantName}`}`} onClose={onClose}>
      <div className="flex flex-wrap gap-2 items-center"><Badge tone={statusTone(app.status)}>{app.status}</Badge>
        {app.decision && <Badge tone={app.decision.finalisedAt ? 'green' : 'amber'}>{app.decision.option}{app.decision.finalisedAt ? ' (final)' : app.decision.provisional ? ' (provisional)' : ' (pending approval)'}</Badge>}
        {!app.gated && app.ackDueBy && !app.acknowledgedAt && <Badge tone="red">Acknowledgement due {app.ackDueBy.slice(0, 10)}</Badge>}
        {manager && !app.gated && <><button className={btnGhost} disabled={busy} onClick={() => downloadPdf(`dossier-${app.id}.pdf`, dossier().title, dossier().sub, dossier().sections)}><FileDown size={12} /> Dossier PDF</button>
          <button className={btnGhost} disabled={busy} onClick={() => filePdf('dossier')}><Archive size={12} /> File dossier</button>
          {app.decision && <button className={btnGhost} disabled={busy} onClick={() => filePdf('decision')}><Archive size={12} /> File decision note</button>}</>}
      </div>
      {err && <div className="text-xs text-red-400">{err}</div>}

      {app.gated && (
        <Panel title="Conflict-of-interest declaration (required before you can see this application)">
          <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={conflict} onChange={e => setConflict(e.target.checked)} /> I have a conflict of interest</label>
          {conflict && <textarea className={inputCls} rows={2} placeholder="Describe the conflict and safeguards" value={mitigation} onChange={e => setMitigation(e.target.value)} />}
          <select className={inputCls + ' max-w-xs'} value={coiAction} onChange={e => setCoiAction(e.target.value)}><option value="participate">Participate</option><option value="recuse">Recuse</option></select>
          {myCoi?.action === 'recuse' ? <p className="text-xs">You recused yourself from this application.</p> : <button className={btnPrimary} disabled={busy} onClick={() => run({ action: 'coi', conflict, mitigation, coiAction })}>Submit declaration</button>}
        </Panel>
      )}

      {!app.gated && (
        <>
          <Panel title="Application">
            {APPLICATION_SECTIONS.map(s => { const fs = s.fields.filter(f => app.sections?.[f.key]); return fs.length ? (
              <div key={s.key} className="text-xs"><div className="font-semibold">{s.key}. {s.label}</div>{fs.map(f => <div key={f.key} className="text-theme-text-secondary"><b>{f.label}:</b> {app.sections![f.key]}</div>)}</div>) : null; })}
            <div className="text-xs"><b>Applicant:</b> {app.applicantName} ({app.applicantEmail}) · declaration signed by {app.declaration?.signedName} on {app.declaration?.signedDate}</div>
            {(app.files?.length ?? 0) > 0 && <ul className="text-xs list-disc pl-4">{app.files!.map((f, i) => <li key={i}><a className="text-accent" href={f.url} target="_blank">{f.label ? `${f.label}: ` : ''}{f.name}</a></li>)}</ul>}
          </Panel>

          {manager && (
            <Panel title="Screening (administrative — does not replace merit evaluation)">
              {!app.acknowledgedAt && <button className={btnGhost} disabled={busy} onClick={() => run({ action: 'acknowledge' })}>Mark acknowledged</button>}
              {app.screening && <p className="text-xs">Last screened {app.screening.at.slice(0, 10)}: <b>{app.screening.outcome}</b>{app.screening.criterion ? ` — ${app.screening.criterion}` : ''}</p>}
              {(app.missingDocs?.length ?? 0) > 0 && <ul className="text-xs space-y-1">{app.missingDocs!.map((m, i) => <li key={i} className="flex justify-between"><span>{m.item} — due {m.dueBy.slice(0, 10)} {m.resolvedAt ? '(received)' : ''}</span>{!m.resolvedAt && <button className="text-accent" onClick={() => run({ action: 'resolveMissing', index: i })}>mark received</button>}</li>)}</ul>}
              {!['Decision recorded', 'Decision final', 'Evaluation'].includes(app.status!) && (<>
                <div className="grid md:grid-cols-2 gap-2">{SCREENING_AREAS.map(a => (
                  <div key={a} className="text-xs space-y-1"><div>{a}</div><div className="flex gap-1"><select className={inputCls + ' !w-20'} value={checks[a].result} onChange={e => setChecks(p => ({ ...p, [a]: { ...p[a], result: e.target.value } }))}><option value="yes">Yes</option><option value="no">No</option><option value="na">N/A</option></select>
                    <input className={inputCls} placeholder="Evidence / reason" value={checks[a].evidence} onChange={e => setChecks(p => ({ ...p, [a]: { ...p[a], evidence: e.target.value } }))} /></div></div>))}</div>
                <select className={inputCls + ' max-w-xs'} value={outcome} onChange={e => setOutcome(e.target.value)}><option value="eligible">Eligible</option><option value="clarification">Clarification required</option><option value="ineligible">Ineligible</option></select>
                {outcome === 'ineligible' && <input className={inputCls} placeholder="Published criterion not met" value={criterion} onChange={e => setCriterion(e.target.value)} />}
                {outcome === 'clarification' && <><textarea className={inputCls} rows={3} placeholder="One missing item per line" value={items} onChange={e => setItems(e.target.value)} />
                  <label className="text-xs">Response deadline (working days {settings.timers.clarificationWorkingDays.min}-{settings.timers.clarificationWorkingDays.max})<input type="number" className={inputCls + ' !w-24'} value={days} onChange={e => setDays(Number(e.target.value))} /></label></>}
                <button className={btnPrimary} disabled={busy} onClick={() => run({ action: 'screen', checks, outcome, criterion, items: items.split('\n'), deadlineWorkingDays: days })}>Record screening</button></>)}
            </Panel>
          )}

          {manager && ['Eligible', 'Evaluation'].includes(app.status!) && (
            <Panel title="Evaluators" hint="Tier 1-3 members. Tick “specialist” for deep-tech / healthcare / biotech reviewers.">
              <div className="max-h-40 overflow-y-auto space-y-1">{members.map(m => (
                <label key={m.id} className="text-xs flex items-center gap-2"><input type="checkbox" checked={!!picked[m.id]?.on} onChange={e => setPicked(p => ({ ...p, [m.id]: { on: e.target.checked, specialist: p[m.id]?.specialist || false } }))} /> {m.name}
                  <label className="ml-2 flex items-center gap-1 text-theme-text-secondary"><input type="checkbox" checked={!!picked[m.id]?.specialist} onChange={e => setPicked(p => ({ ...p, [m.id]: { on: p[m.id]?.on || false, specialist: e.target.checked } }))} /> specialist</label></label>))}</div>
              <button className={btnPrimary} disabled={busy} onClick={() => run({ action: 'assign', evaluators: Object.entries(picked).filter(([, v]) => v.on).map(([memberId, v]) => ({ memberId, specialist: v.specialist })) })}>Save assignment</button>
            </Panel>
          )}

          {app.viewer.assigned && app.status === 'Evaluation' && (
            <Panel title="Your scorecard" hint="Score each criterion 1-5 (1 = very weak or no evidence, 5 = excellent). Weighted = score ÷ 5 × weight. Submitted scorecards cannot be changed.">
              {!myCoi ? <p className="text-xs">File your conflict-of-interest declaration first (use the gate shown when you open an application you have not declared on).</p>
                : myCard ? <p className="text-xs">Submitted: <b>{myCard.weighted}/100</b>.</p>
                : !weightsValid(criteria) ? <p className="text-xs text-red-400">Scorecard weights do not total 100 — fix in Settings.</p>
                : (<>{criteria.map(c => (
                  <div key={c.key} className="text-xs flex items-center gap-2"><span className="flex-1">{c.label} <span className="text-theme-text-secondary">(weight {c.weight})</span></span>
                    <select className={inputCls + ' !w-20'} value={scores[c.key] || ''} onChange={e => setScores(p => ({ ...p, [c.key]: Number(e.target.value) }))}><option value="">—</option>{[1, 2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select></div>))}
                  <input className={inputCls} placeholder="Recommendation" value={recommendation} onChange={e => setRecommendation(e.target.value)} />
                  <textarea className={inputCls} rows={2} placeholder="Comments" value={comments} onChange={e => setComments(e.target.value)} />
                  <button className={btnPrimary} disabled={busy} onClick={() => run({ action: 'score', scores, recommendation, comments })}>Submit scorecard</button></>)}
            </Panel>
          )}

          {(app.scorecards?.length ?? 0) > 0 && (
            <Panel title="Scorecards" hint={manager ? 'Visible to managers once submitted.' : 'Peer scorecards are shown only after you submit your own.'}>
              <table className="w-full text-xs"><thead><tr className="text-left text-theme-text-secondary"><th>Evaluator</th><th>Weighted /100</th><th>Recommendation</th></tr></thead>
                <tbody>{app.scorecards!.map(s => <tr key={s.memberId}><td>{s.memberName}{s.specialist ? ' (specialist)' : ''}</td><td>{s.weighted}</td><td>{s.recommendation || '—'}</td></tr>)}</tbody></table>
            </Panel>
          )}

          {manager && ['Evaluation', 'Decision recorded'].includes(app.status!) && (
            <Panel title="Decision" hint="Records a recommendation. It is not final until the configured approver approves it, and not while weights are only Proposed.">
              <div className="grid md:grid-cols-2 gap-2">
                <select className={inputCls} value={dec.option} onChange={e => setDec({ ...dec, option: e.target.value })}>{DECISION_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
                <input className={inputCls} placeholder="Deciding authority *" value={dec.authority} onChange={e => setDec({ ...dec, authority: e.target.value })} />
                <input className={inputCls} placeholder="Minutes reference" value={dec.minutesRef} onChange={e => setDec({ ...dec, minutesRef: e.target.value })} />
                <input className={inputCls} placeholder="Reason category (not selected)" value={dec.reasonCategory} onChange={e => setDec({ ...dec, reasonCategory: e.target.value })} />
                <input className={inputCls + ' md:col-span-2'} placeholder="Conditions (required for “subject to conditions”)" value={dec.conditions} onChange={e => setDec({ ...dec, conditions: e.target.value })} />
                <input className={inputCls} placeholder="Condition owner" value={dec.owner} onChange={e => setDec({ ...dec, owner: e.target.value })} />
                <input type="date" className={inputCls} value={dec.dueDate} onChange={e => setDec({ ...dec, dueDate: e.target.value })} />
                <input className={inputCls + ' md:col-span-2'} placeholder="Override reason (only if below threshold or evaluators incomplete)" value={dec.overrideReason} onChange={e => setDec({ ...dec, overrideReason: e.target.value })} />
              </div>
              <button className={btnPrimary} disabled={busy} onClick={() => run({ action: 'decide', ...dec })}>Record decision</button>
            </Panel>
          )}

          {app.decision && !app.decision.finalisedAt && isApprover && (
            <Panel title="Final approval" hint="Only a configured selection approver can finalise. This notifies the applicant and, for a selection, creates the Startup record.">
              <input className={inputCls} placeholder="Approval reference (minutes / order no.) *" value={approvalRef} onChange={e => setApprovalRef(e.target.value)} />
              <button className={btnPrimary} disabled={busy} onClick={() => run({ action: 'finalise', approvalRef })}>Finalise decision</button>
            </Panel>
          )}
          {app.startupId && <p className="text-xs">Startup record: <b className="font-mono">{app.startupId}</b> — continue under Onboarding.</p>}
          {manager && (app.log?.length ?? 0) > 0 && <details className="text-[11px]"><summary className="cursor-pointer font-semibold">Activity log</summary><ul className="mt-1 text-theme-text-secondary">{app.log!.slice().reverse().map((l, i) => <li key={i}>{l.at.slice(0, 16).replace('T', ' ')} — {l.action}{l.detail ? `: ${l.detail}` : ''}</li>)}</ul></details>}
        </>
      )}
    </Modal>
  );
}

export default function ApplicationsPage() {
  return <Suspense fallback={null}><ApplicationsPageInner /></Suspense>;
}
