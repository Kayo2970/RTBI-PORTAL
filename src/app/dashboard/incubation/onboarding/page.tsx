'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  ClipboardCheck,
  Loader2,
  FileDown,
  FolderArchive,
  Copy,
  Check,
  Image as ImageIcon,
  FileText,
  FileCheck2,
  Briefcase,
  Award,
  Building2,
  Sparkles,
  Info,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { activateStartup, fetchOnboarding, fetchStartups, saveOnboarding } from '@/lib/incubation/client';
import { downloadPdf } from '@/lib/incubation/pdf';
import {
  FEE_BASES,
  ONBOARDING_ITEMS,
  RTBI_MANDATORY_DOCUMENTS,
  type GateResult,
  type OnboardingRecord,
} from '@/lib/incubation/onboarding';
import type { Startup } from '@/lib/incubation/types';
import { Badge, PageHeader, Panel, btnGhost, btnPrimary, inputCls, isManagerUi, isStaffUi, useCurrentUser } from '@/components/incubation/ui';

const DOC_ICONS: Record<string, React.ReactNode> = {
  logo: <ImageIcon className="h-5 w-5 text-accent-strong dark:text-accent-soft" />,
  entityDocs: <FileText className="h-5 w-5 text-purple-400" />,
  agreement: <FileCheck2 className="h-5 w-5 text-emerald-800 dark:text-emerald-300" />,
  portfolio: <Briefcase className="h-5 w-5 text-blue-700 dark:text-blue-300" />,
  patents: <Award className="h-5 w-5 text-amber-800 dark:text-amber-300" />,
  rentalAgreement: <Building2 className="h-5 w-5 text-rose-700 dark:text-rose-300" />,
};

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
  const [copiedFolder, setCopiedFolder] = useState(false);
  const manager = isManagerUi(user);
  const staff = isStaffUi(user);

  useEffect(() => {
    fetchStartups().then(setStartups).catch(e => setErr(e.message));
  }, []);

  const load = useCallback(async () => {
    if (!startupId) {
      setData(null);
      return;
    }
    try {
      const d = await fetchOnboarding(startupId);
      setData(d);
      setItems(d.onboarding.items || {});
      setCond({
        ref: d.onboarding.conditionalApproval?.ref || '',
        scope: d.onboarding.conditionalApproval?.scope || '',
        endsOn: d.onboarding.conditionalApproval?.endsOn || '',
      });
      setErr('');
    } catch (e: any) {
      setErr(e.message);
    }
  }, [startupId]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (key: string, p: Partial<OnboardingRecord['items'][string]>) =>
    setItems(prev => ({ ...prev, [key]: { ...(prev[key] || { done: false }), ...p } }));

  const save = async (withCond = false) => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await saveOnboarding(startupId, {
        items,
        ...(withCond ? { conditionalApproval: cond.ref && cond.scope ? cond : null } : {}),
      });
      await load();
      setMsg('All documents and onboarding checklist items saved successfully.');
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const activate = async () => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const r = await activateStartup(startupId);
      setMsg(`Startup successfully activated (${r.basis} basis).`);
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const s = data?.startup;
  const incubationYear = s?.incubationStartDate
    ? new Date(s.incubationStartDate).getFullYear()
    : s?.cohort || (s?.createdAt ? new Date(s.createdAt).getFullYear() : new Date().getFullYear());
  const folderName = s ? `RTBI - [${s.name}] - [${incubationYear}]` : 'RTBI - [Startup Name] - [Year of Incubation]';

  const copyFolderFormat = () => {
    navigator.clipboard.writeText(folderName);
    setCopiedFolder(true);
    setTimeout(() => setCopiedFolder(false), 2000);
  };

  // Group items into Documents (1-6) and Governance
  const docItems = ONBOARDING_ITEMS.filter(it => it.category === 'document');
  const governanceItems = ONBOARDING_ITEMS.filter(it => it.category !== 'document');

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-5xl">
      <PageHeader
        icon={<ClipboardCheck size={20} />}
        title="Startup Onboarding & Document Verification"
        subtitle="Manage required document submissions, compliance checklist, and formal activation into Ramaiah Technology Business Incubator."
      />

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <select
          className={inputCls + ' max-w-md'}
          value={startupId}
          onChange={e => router.replace(`/dashboard/incubation/onboarding${e.target.value ? `?startup=${e.target.value}` : ''}`)}
        >
          <option value="">Choose an incubated startup…</option>
          {startups.map(x => (
            <option key={x.id} value={x.id}>
              {x.id} — {x.name} ({x.status})
            </option>
          ))}
        </select>

        {s && (
          <div className="flex items-center gap-2">
            <Badge tone={s.status === 'Active' ? 'green' : 'amber'}>{s.status}</Badge>
            {s.activationBasis && (
              <Badge tone={s.activationBasis === 'conditional' ? 'amber' : 'green'}>
                {s.activationBasis} basis
              </Badge>
            )}
            {manager && (
              <button
                className={btnGhost}
                onClick={() =>
                  downloadPdf(`admission-${s.id}.pdf`, 'Admission letter', `${s.id} — ${s.name}`, [
                    {
                      lines: [
                        `Dear ${s.name},`,
                        'We are pleased to confirm your admission to the Ramaiah Technology Business Incubator (RTBI) incubation programme, subject to the conditions below and execution of the incubation agreement deed.',
                        `Pathway: ${s.pathway}${s.mode ? ` · Mode: ${s.mode}` : ''}.`,
                        'Conditions: as recorded in the selection decision note.',
                        'Services begin only once document submission and onboarding are verified.',
                      ],
                    },
                  ])
                }
              >
                <FileDown size={12} /> Admission letter (PDF)
              </button>
            )}
          </div>
        )}
      </div>

      {err && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-rose-700 dark:text-rose-300 whitespace-pre-line">{err}</div>}
      {msg && <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-800 dark:text-emerald-300">{msg}</div>}
      {!data && startupId && (
        <div className="text-sm flex gap-2 items-center text-theme-text-secondary py-6">
          <Loader2 size={16} className="animate-spin text-accent-strong dark:text-accent-soft" /> Loading onboarding records…
        </div>
      )}

      {data && s && (
        <>
          {/* Official RTBI Header Banner from Flyer */}
          <div className="rounded-3xl border border-accent/20 bg-gradient-to-r from-primary/30 via-theme-card to-accent/10 p-6 space-y-4 shadow-xl relative overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold uppercase tracking-wider text-accent-strong dark:text-accent-soft border-b border-white/10 pb-3">
              <span>RAMAIAH-GoK TECHNOLOGY BUSINESS INCUBATOR</span>
              <span className="flex items-center gap-2">
                <span>GOVERNMENT OF KARNATAKA</span> · <span>K-TECH</span> · <span>STARTUP KARNATAKA</span>
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-mono tracking-widest text-theme-text-secondary uppercase">
                BUILD · INNOVATE · SCALE TOGETHER
              </span>
              <h2 className="text-lg md:text-xl font-extrabold text-theme-text-primary">
                RTBI INCUBATED STARTUPS — DATA COLLECTION &amp; DOCUMENT SUBMISSION
              </h2>
              <p className="text-sm text-theme-text-secondary leading-relaxed max-w-3xl">
                To maintain an updated and comprehensive database of our incubated startups, we request you to fill in the
                data collection form and upload the required documents. This will help RTBI in providing better support,
                showcasing your progress, and creating more opportunities for your growth.
              </p>
            </div>

            {/* Folder Naming Format Card */}
            <div className="rounded-2xl bg-theme-sidebar/80 border border-theme-border p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <FolderArchive className="h-5 w-5 text-amber-800 dark:text-amber-300" />
                </div>
                <div>
                  <span className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider block">
                    Folder Naming Format
                  </span>
                  <div className="font-mono text-sm font-bold text-theme-text-primary">
                    {folderName}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={copyFolderFormat}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-sm text-theme-text-primary font-semibold transition-all cursor-pointer"
              >
                {copiedFolder ? <Check size={14} className="text-emerald-800 dark:text-emerald-300" /> : <Copy size={14} />}
                <span>{copiedFolder ? 'Copied Format!' : 'Copy Folder Name'}</span>
              </button>
            </div>
          </div>

          {/* SECTION 1: The 6 Mandatory Documents Extracted from Mandate */}
          <Panel
            title="Required Documents (Mandatory 6 Submissions)"
            hint="Extracted directly from the official RTBI Incubated Startups Data Collection & Document Submission directive."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {docItems.map(it => {
                const st = items[it.key] || { done: false };
                const docDef = RTBI_MANDATORY_DOCUMENTS.find(d => d.key === it.key);
                const isDone = !!st.done;
                const isNa = st.evidenceRef?.trim().toLowerCase() === 'not applicable';

                return (
                  <div
                    key={it.key}
                    className={`rounded-2xl border p-4 space-y-3 transition-all ${
                      isDone
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : it.required
                        ? 'border-accent/30 bg-accent/5'
                        : 'border-theme-border bg-theme-background/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-theme-sidebar flex items-center justify-center shrink-0 border border-theme-border">
                          {DOC_ICONS[it.key] || <FileText size={16} />}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-theme-text-primary">
                              {docDef?.num || it.docNum}. {docDef?.label || it.label}
                            </span>
                            {it.required ? (
                              <span className="text-xs font-bold px-1.5 py-0.2 rounded bg-accent/20 text-accent-strong dark:text-accent-soft">
                                Mandatory
                              </span>
                            ) : (
                              <span className="text-xs font-bold px-1.5 py-0.2 rounded bg-white/10 text-theme-text-secondary">
                                Conditional
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-theme-text-secondary mt-0.5">
                            {docDef?.description || it.evidence}
                          </p>
                        </div>
                      </div>

                      <label className="flex items-center gap-1 text-xs font-semibold text-theme-text-secondary cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          disabled={!staff}
                          checked={isDone}
                          onChange={e => patch(it.key, { done: e.target.checked })}
                          className="rounded accent-accent h-4 w-4"
                        />
                        <span>{isDone ? 'Verified' : 'Pending'}</span>
                      </label>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-theme-border/20">
                      <div className="flex items-center justify-between text-xs text-theme-text-secondary">
                        <span>Evidence reference / File name / URL:</span>
                        {!it.required && (
                          <button
                            type="button"
                            disabled={!staff}
                            onClick={() => patch(it.key, { done: true, evidenceRef: 'Not Applicable' })}
                            className="text-purple-400 hover:text-purple-300 font-semibold cursor-pointer underline"
                          >
                            Mark "Not Applicable"
                          </button>
                        )}
                      </div>
                      <input
                        className={inputCls}
                        placeholder={
                          it.key === 'logo'
                            ? 'e.g. logo-highres.png / storage link *'
                            : it.key === 'entityDocs'
                            ? 'e.g. CIN / Certificate of Incorporation # *'
                            : it.key === 'agreement'
                            ? 'e.g. RTBI/AGR/2026/001 (verified copy) *'
                            : it.key === 'portfolio'
                            ? 'e.g. PitchDeck_v2.pdf / Demo Video link *'
                            : it.key === 'patents'
                            ? 'e.g. Patent Application # or "Not Applicable"'
                            : 'e.g. Rental Agreement Ref or "Not Applicable"'
                        }
                        disabled={!staff}
                        value={st.evidenceRef || ''}
                        onChange={e => patch(it.key, { evidenceRef: e.target.value })}
                      />
                      {docDef?.formats && (
                        <p className="text-xs text-theme-text-secondary">
                          Accepted Formats: <span className="font-mono">{docDef.formats}</span>
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Important Points Banner from Flyer */}
            <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 space-y-2 mt-4">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold text-sm uppercase tracking-wider">
                <AlertCircle size={16} /> Important Points
              </div>
              <ul className="text-sm text-theme-text-secondary space-y-1 list-disc pl-5">
                <li>Please ensure all documents are clear, current and appropriately named.</li>
                <li>Upload only relevant and authorised documents.</li>
                <li>If a document is not applicable, you may upload a note mentioning <b>"Not Applicable"</b>.</li>
                <li>For any queries, feel free to reach out to the RTBI incubation team.</li>
              </ul>
            </div>
          </Panel>

          {/* SECTION 2: Incubation Governance & SOP Compliance Checklist */}
          <Panel title="Incubation Governance & Operational Checklist">
            <div className="space-y-3">
              {governanceItems.map(it => {
                const st = items[it.key] || { done: false };
                return (
                  <div key={it.key} className="rounded-xl border border-theme-border p-3 space-y-2">
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-accent"
                        disabled={!staff}
                        checked={!!st.done}
                        onChange={e => patch(it.key, { done: e.target.checked })}
                      />
                      <span>
                        <b>{it.label}</b>
                        <span className="block text-theme-text-secondary">
                          {it.evidence} · Owner: {it.owner}
                        </span>
                      </span>
                    </label>
                    {st.done && (
                      <div className="grid md:grid-cols-2 gap-2 pl-6">
                        <input
                          className={inputCls}
                          placeholder="Evidence reference (document / ID) *"
                          disabled={!staff}
                          value={st.evidenceRef || ''}
                          onChange={e => patch(it.key, { evidenceRef: e.target.value })}
                        />
                        {it.key === 'fees' && (
                          <select
                            className={inputCls}
                            disabled={!staff}
                            value={st.feeBasis || ''}
                            onChange={e => patch(it.key, { feeBasis: e.target.value })}
                          >
                            <option value="">Fee basis…</option>
                            {FEE_BASES.map(f => (
                              <option key={f}>{f}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {staff && (
              <div className="pt-3">
                <button className={btnPrimary} disabled={busy} onClick={() => save(false)}>
                  {busy ? 'Saving…' : 'Save Documents & Checklist'}
                </button>
              </div>
            )}
          </Panel>

          {/* SECTION 3: Written Conditional Approval */}
          <Panel
            title="Written conditional approval"
            hint="Only a written conditional approval can allow limited pre-admission activity. CEO / Super User only."
          >
            <div className="grid md:grid-cols-3 gap-2">
              <input
                className={inputCls}
                placeholder="Approval reference"
                disabled={!manager}
                value={cond.ref}
                onChange={e => setCond({ ...cond, ref: e.target.value })}
              />
              <input
                className={inputCls}
                placeholder="Scope of limited activity"
                disabled={!manager}
                value={cond.scope}
                onChange={e => setCond({ ...cond, scope: e.target.value })}
              />
              <input
                type="date"
                className={inputCls}
                disabled={!manager}
                value={cond.endsOn}
                onChange={e => setCond({ ...cond, endsOn: e.target.value })}
              />
            </div>
            {manager && (
              <button className={btnGhost} disabled={busy} onClick={() => save(true)}>
                Save conditional approval
              </button>
            )}
          </Panel>

          {/* SECTION 4: Activation Gate */}
          <Panel title="Activation gate">
            {data.gate.ok ? (
              <p className="text-sm text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 size={14} /> Ready to activate on a <b>{data.gate.basis}</b> basis.
                {data.gate.basis === 'conditional' && data.gate.missing.length ? ' Outstanding items remain:' : ''}
              </p>
            ) : (
              <p className="text-sm text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <AlertCircle size={14} /> Onboarding incomplete. Still needed before full activation:
              </p>
            )}
            {data.gate.missing.length > 0 && (
              <ul className="text-sm list-disc pl-5 text-theme-text-secondary space-y-0.5">
                {data.gate.missing.map(m => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            {manager && s.status !== 'Active' && (
              <div className="pt-2">
                <button className={btnPrimary} disabled={busy || !data.gate.ok} onClick={activate}>
                  {busy ? 'Activating…' : 'Activate Startup'}
                </button>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingPageInner />
    </Suspense>
  );
}
