'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, FileUp, Send, Trash2 } from 'lucide-react';
import { submitPublicApplication, readFileAsDataUrl } from '@/lib/incubation/client';
import { APPLICATION_SECTIONS } from '@/lib/incubation/types';
import { FormField, inputClass } from '@/components/ui/form-field';
import { toast } from '@/components/ui/toast';

const MAX_FILES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const DRAFT_KEY = 'rtbi-apply-draft-v1';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DOC_SLOTS = [
  'Startup logo (PNG/JPG)',
  'Registration document (certificate of incorporation / registration)',
  'Executed agreement deed with RTBI',
  'Portfolio material (pitch deck, demo video, reference docs)',
  'Patents (filed / granted, or note N/A)',
  'Rental agreement with RTBI (if physically incubated)',
  'Founder declaration (signed)',
  'Technology evidence (technical note, prototype, demo)',
  'Problem and customer evidence',
  'IP or assignment details',
];

/** Sections grouped into six short steps (Miller's Law). */
const STEPS: { id: string; title: string; sections: string[]; docs?: boolean; contact?: boolean; review?: boolean }[] = [
  { id: 'you', title: 'You and your startup', sections: ['A', 'B'], contact: true },
  { id: 'team', title: 'Team and problem', sections: ['C', 'D'] },
  { id: 'solution', title: 'Solution and IP', sections: ['E', 'F'] },
  { id: 'market', title: 'Market and business', sections: ['G', 'H'] },
  { id: 'plans', title: 'Plans, risk and documents', sections: ['I', 'J', 'K'], docs: true },
  { id: 'review', title: 'Review and declare', sections: [], review: true },
];

type AFile = { name: string; type: string; dataUrl: string; label: string; size: number };
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Shell({ children }: { children: React.ReactNode }) {
  return (
  <div className="min-h-screen bg-theme-background text-theme-text-primary flex flex-col">
    <a href="#apply-main" className="skip-link">Skip to form</a>
    <header className="bg-theme-card border-b border-theme-border">
      <div className="max-w-3xl mx-auto px-4 h-16 flex items-center gap-3">
        <img src="/images/rtbi-icon.png" alt="" className="h-9 w-9 object-contain" />
        <div className="leading-tight"><p className="font-extrabold">RTBI Portal</p><p className="text-sm text-theme-text-secondary">Ramaiah Technology Business Incubator</p></div>
      </div>
    </header>
    <main id="apply-main" tabIndex={-1} className="flex-1 outline-none">{children}</main>
    <footer className="border-t border-theme-border bg-theme-card text-sm text-theme-text-secondary">
      <div className="max-w-3xl mx-auto px-4 py-4">Applying does not imply any fee, equity or revenue share. Screening is administrative and does not replace merit evaluation.</div>
    </footer>
  </div>
);
}

export default function ApplyPage() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sections, setSections] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<AFile[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [signedName, setSignedName] = useState('');
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitErr, setSubmitErr] = useState('');
  const [doneId, setDoneId] = useState('');
  const [draftRestored, setDraftRestored] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // Draft: text answers only (never files). Restored once on load.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      setName(d.name || ''); setEmail(d.email || ''); setSections(d.sections || {}); setStep(Math.min(d.step || 0, STEPS.length - 1));
      if (d.name || d.email || Object.keys(d.sections || {}).length) setDraftRestored(true);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (doneId) return;
    const t = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ name, email, sections, step })); } catch { /* ignore */ } }, 500);
    return () => clearTimeout(t);
  }, [name, email, sections, step, doneId]);
  useEffect(() => { if (first.current) { first.current = false; return; } headingRef.current?.focus(); window.scrollTo({ top: 0 }); }, [step]);

  const cur = STEPS[step];
  const secs = useMemo(() => APPLICATION_SECTIONS.filter(s => cur.sections.includes(s.key)), [cur]);

  const validateStep = (i: number): Record<string, string> => {
    const st = STEPS[i]; const e: Record<string, string> = {};
    if (st.contact) {
      if (!name.trim()) e.name = 'Enter your name.';
      if (!EMAIL.test(email.trim())) e.email = 'Enter a valid email address, for example name@example.com.';
    }
    APPLICATION_SECTIONS.filter(s => st.sections.includes(s.key)).forEach(s => s.fields.forEach(f => { if (f.required && !(sections[f.key] || '').trim()) e[f.key] = `${f.label.replace(/ \(.*/, '')} is required.`; }));
    if (st.review) {
      if (!accepted) e.accepted = 'You must accept the declaration to submit.';
      if (!signedName.trim()) e.signedName = 'Type your full name as your signature.';
    }
    return e;
  };

  const goNext = () => {
    const e = validateStep(step); setErrors(e);
    if (Object.keys(e).length) { setSubmitErr(`Please fix ${Object.keys(e).length} item${Object.keys(e).length === 1 ? '' : 's'} before continuing.`); return; }
    setSubmitErr(''); setStep(step + 1);
  };
  const goBack = () => { setErrors({}); setSubmitErr(''); setStep(step - 1); };
  const jump = (i: number) => { if (i < step) { setErrors({}); setSubmitErr(''); setStep(i); } };

  const addFiles = async (list: FileList | null, label: string) => {
    if (!list) return;
    const next = [...files]; const problems: string[] = [];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_FILES) { problems.push(`Only ${MAX_FILES} files can be attached.`); break; }
      if (f.size > MAX_FILE_BYTES) { problems.push(`"${f.name}" is larger than 10 MB.`); continue; }
      next.push({ name: f.name, type: f.type, dataUrl: await readFileAsDataUrl(f), label, size: f.size });
    }
    setFiles(next);
    if (problems.length) toast.error('Some files were not added', { description: problems.join(' ') });
    else if (list.length) toast.success(`${list.length} file${list.length === 1 ? '' : 's'} added`);
  };

  const submit = async () => {
    // Re-check every step so nothing slipped through (e.g. a draft restored mid-way).
    for (let i = 0; i < STEPS.length; i++) {
      const e = validateStep(i);
      if (Object.keys(e).length) { setErrors(e); setStep(i); setSubmitErr(`Please fix ${Object.keys(e).length} item${Object.keys(e).length === 1 ? '' : 's'}.`); return; }
    }
    setBusy(true); setSubmitErr('');
    try {
      const r = await submitPublicApplication({ applicantName: name, applicantEmail: email, sections, files: files.map(({ size, ...f }) => f), declaration: { accepted, signedName }, hp });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      setDoneId(r.id);
    } catch (e: any) { setSubmitErr(e.message); toast.error('Submission failed', { description: e.message }); }
    setBusy(false);
  };

  if (doneId) return (
    <Shell>
      <div className="max-w-xl mx-auto px-4 py-12">
        <div className="glass-panel rounded-2xl p-8 text-center space-y-4" role="status">
          <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-700" aria-hidden="true" />
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">Application received</h1>
          <p>Your application ID is <b className="font-mono text-lg">{doneId}</b>.</p>
          <p className="text-theme-text-secondary">We have emailed you an acknowledgement. Please quote this ID in any correspondence. If anything is missing, we will write to you with a deadline.</p>
        </div>
      </div>
    </Shell>
  );

  const requiredField = (f: { key: string; label: string; long?: boolean; required?: boolean }) => (
    <FormField key={f.key} label={f.label} required={f.required} error={errors[f.key]}>
      {p => f.long
        ? <textarea {...p} rows={4} className={inputClass} value={sections[f.key] || ''} onChange={e => setSections(s => ({ ...s, [f.key]: e.target.value }))} />
        : <input {...p} className={inputClass} value={sections[f.key] || ''} onChange={e => setSections(s => ({ ...s, [f.key]: e.target.value }))} />}
    </FormField>
  );

  return (
    <Shell>
      <div className="max-w-3xl mx-auto px-4 py-6 md:py-8 space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Apply for incubation</h1>
          <p className="text-theme-text-secondary mt-1">Fields marked * are required. Your answers are saved on this device as you go, so you can come back later.</p>
        </div>

        {draftRestored && <p role="status" className="text-sm rounded-xl border border-sky-300 bg-sky-50 text-sky-900 dark:bg-sky-500/15 dark:text-sky-100 px-4 py-2.5">We restored your saved answers. Uploaded files are not saved, so please add them again before submitting.</p>}

        <nav aria-label="Application progress">
          <p className="text-sm font-semibold mb-2" aria-live="polite">Step {step + 1} of {STEPS.length}: {cur.title}</p>
          <div className="h-2 rounded-full bg-theme-border/40 overflow-hidden mb-3" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Application progress"><div className="h-full bg-primary dark:bg-accent-soft transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
          <ol className="hidden sm:flex flex-wrap gap-2">
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <button type="button" disabled={i > step} onClick={() => jump(i)} aria-current={i === step ? 'step' : undefined}
                  className={`min-h-10 px-3.5 rounded-full border text-sm font-semibold ${i === step ? 'bg-primary text-white border-primary dark:bg-white/15 dark:border-white/30' : i < step ? 'border-emerald-600 text-emerald-800 dark:text-emerald-300 hover:bg-theme-border/20' : 'border-theme-border text-theme-text-secondary opacity-70'}`}>
                  {i < step ? '✓ ' : ''}{s.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <form onSubmit={e => { e.preventDefault(); cur.review ? submit() : goNext(); }} noValidate className="space-y-5">
          <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">{cur.title}</h2>
          {submitErr && <p role="alert" className="text-sm font-medium rounded-xl border border-rose-400 bg-rose-50 text-rose-900 dark:bg-rose-500/15 dark:text-rose-100 px-4 py-3">{submitErr}</p>}

          {cur.contact && (
            <section className="glass-panel rounded-2xl p-5 grid md:grid-cols-2 gap-4" aria-label="Your contact details">
              <FormField label="Your name" required error={errors.name}>{p => <input {...p} autoComplete="name" className={inputClass} value={name} onChange={e => setName(e.target.value)} />}</FormField>
              <FormField label="Contact email" required error={errors.email} hint="We send your acknowledgement here.">{p => <input {...p} type="email" autoComplete="email" className={inputClass} value={email} onChange={e => setEmail(e.target.value)} />}</FormField>
            </section>
          )}

          {secs.map(sec => (
            <fieldset key={sec.key} className="glass-panel rounded-2xl p-5 space-y-4">
              <legend className="px-1 font-bold text-base">{sec.label}</legend>
              {sec.fields.map(requiredField)}
            </fieldset>
          ))}

          {cur.docs && (
            <fieldset className="glass-panel rounded-2xl p-5 space-y-4">
              <legend className="px-1 font-bold text-base">Supporting documents</legend>
              <p className="text-sm text-theme-text-secondary">Up to {MAX_FILES} files, 10 MB each. Anything missing will be requested in writing; staff do not fill gaps for you. Attached: {files.length}/{MAX_FILES}.</p>
              <div className="grid md:grid-cols-2 gap-3">
                {DOC_SLOTS.map(l => (
                  <FormField key={l} label={l}>{p => <input {...p} type="file" multiple className={inputClass} onChange={e => { addFiles(e.target.files, l); e.target.value = ''; }} />}</FormField>
                ))}
              </div>
              {files.length > 0 && (
                <ul className="divide-y divide-theme-border rounded-xl border border-theme-border">
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center gap-3 px-3 py-2">
                      <FileUp className="h-4 w-4 shrink-0 text-theme-text-secondary" aria-hidden="true" />
                      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold truncate">{f.name} <span className="font-normal text-theme-text-secondary">({kb(f.size)})</span></span><span className="block text-sm text-theme-text-secondary truncate">{f.label}</span></span>
                      <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="h-11 w-11 flex items-center justify-center rounded-lg text-rose-700 dark:text-rose-300 hover:bg-theme-border/20"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          )}

          {cur.review && (
            <>
              <section className="glass-panel rounded-2xl p-5 space-y-4" aria-label="Review your answers">
                <p className="text-sm text-theme-text-secondary">Check your answers. Use “Edit” to change anything.</p>
                {[{ i: 0, label: 'Contact', rows: [['Name', name], ['Email', email]] as [string, string][] }, ...STEPS.slice(0, -1).map((s, i) => ({ i, label: s.title, rows: APPLICATION_SECTIONS.filter(x => s.sections.includes(x.key)).flatMap(x => x.fields.map(f => [f.label.replace(/ \(.*/, ''), sections[f.key] || ''] as [string, string])) }))].map((g, gi) => (
                  <div key={gi} className="border-t border-theme-border pt-3 first:border-0 first:pt-0">
                    <div className="flex items-center justify-between"><h3 className="font-bold">{g.label}</h3><button type="button" className="min-h-11 px-3 text-sm font-semibold underline text-accent-strong dark:text-accent-soft" onClick={() => jump(g.i)}>Edit<span className="sr-only"> {g.label}</span></button></div>
                    <dl className="mt-1 grid sm:grid-cols-[14rem_1fr] gap-x-4 gap-y-1 text-sm">
                      {g.rows.filter(r => r[1]).map(([k, v]) => (<React.Fragment key={k}><dt className="text-theme-text-secondary">{k}</dt><dd className="break-words whitespace-pre-line">{v}</dd></React.Fragment>))}
                    </dl>
                  </div>
                ))}
                <p className="text-sm text-theme-text-secondary">Documents attached: {files.length}</p>
              </section>

              <fieldset className="glass-panel rounded-2xl p-5 space-y-4">
                <legend className="px-1 font-bold text-base">Declaration</legend>
                <div className="space-y-1.5">
                  <label className={`flex items-start gap-3 text-sm cursor-pointer ${errors.accepted ? 'text-rose-700 dark:text-rose-300' : ''}`}>
                    <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-primary)]" checked={accepted} aria-invalid={errors.accepted ? true : undefined} onChange={e => setAccepted(e.target.checked)} />
                    <span>I declare the information is accurate, give RTBI permission to verify it, have disclosed any conflicts of interest, and acknowledge the confidentiality and data-use terms.</span>
                  </label>
                  {errors.accepted && <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300">{errors.accepted}</p>}
                </div>
                <FormField label="Signature (type your full name)" required error={errors.signedName}>{p => <input {...p} autoComplete="name" className={inputClass} value={signedName} onChange={e => setSignedName(e.target.value)} />}</FormField>
                <input aria-hidden="true" tabIndex={-1} autoComplete="off" className="hidden" value={hp} onChange={e => setHp(e.target.value)} />
              </fieldset>
            </>
          )}

          <div className="flex items-center justify-between gap-3 sticky bottom-0 -mx-4 px-4 py-3 bg-theme-background border-t border-theme-border">
            <button type="button" onClick={goBack} disabled={step === 0 || busy} className="inline-flex items-center gap-2 min-h-12 px-5 rounded-xl border border-theme-border font-semibold hover:bg-theme-border/20 disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back</button>
            {cur.review
              ? <button type="submit" disabled={busy} className="inline-flex items-center gap-2 min-h-12 px-6 rounded-xl bg-accent text-white font-bold hover:bg-primary-light disabled:opacity-60"><Send className="h-4 w-4" aria-hidden="true" /> {busy ? 'Submitting…' : 'Submit application'}</button>
              : <button type="submit" className="inline-flex items-center gap-2 min-h-12 px-6 rounded-xl bg-accent text-white font-bold hover:bg-primary-light">Next <ChevronRight className="h-4 w-4" aria-hidden="true" /></button>}
          </div>
        </form>
      </div>
    </Shell>
  );
}
