'use client';

import React, { useState } from 'react';
import { submitPublicApplication, readFileAsDataUrl } from '@/lib/incubation/client';
import { APPLICATION_SECTIONS } from '@/lib/incubation/types';

const inputCls = 'w-full bg-theme-background/40 border border-theme-border/40 rounded-xl px-3 py-2 text-sm';
const FILE_SUGGESTIONS = ['Founder declaration (signed)', 'Project plan / business model', 'Identity / authorisation documents (as lawfully required)', 'Certificate of incorporation / registration', 'Technology evidence (technical note, prototype, demo)', 'Problem and customer evidence', 'IP or assignment details'];

export default function ApplyPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sections, setSections] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<{ name: string; type: string; dataUrl: string; label: string }[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [signedName, setSignedName] = useState('');
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [doneId, setDoneId] = useState('');

  const addFiles = async (list: FileList | null, label: string) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) next.push({ name: f.name, type: f.type, dataUrl: await readFileAsDataUrl(f), label });
    setFiles(next);
  };

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = await submitPublicApplication({ applicantName: name, applicantEmail: email, sections, files, declaration: { accepted, signedName }, hp });
      setDoneId(r.id);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  if (doneId) return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="glass-panel rounded-2xl p-8 max-w-lg text-center space-y-3">
        <h1 className="text-xl font-bold">Application received</h1>
        <p className="text-sm">Your application ID is <b className="font-mono">{doneId}</b>. We have emailed you an acknowledgement. Please quote this ID in any correspondence.</p>
        <p className="text-xs text-theme-text-secondary">Screening is administrative and does not replace merit evaluation. If anything is missing, we will write to you with a deadline.</p>
      </div>
    </main>
  );

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-5">
        <header>
          <h1 className="text-2xl font-bold">RTBI incubation — application</h1>
          <p className="text-xs text-theme-text-secondary">Fields marked * are required. Use only the criteria in the published call; no fee, equity or revenue share is implied by applying.</p>
        </header>

        <section className="glass-panel rounded-2xl p-5 grid md:grid-cols-2 gap-3">
          <label className="text-xs">Your name *<input className={inputCls} value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="text-xs">Contact email *<input type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} /></label>
        </section>

        {APPLICATION_SECTIONS.map(sec => (
          <section key={sec.key} className="glass-panel rounded-2xl p-5 space-y-3">
            <h2 className="font-bold text-sm">{sec.key}. {sec.label}</h2>
            {sec.fields.map(f => (
              <label key={f.key} className="text-xs block">{f.label}{f.required ? ' *' : ''}
                {f.long
                  ? <textarea rows={3} className={inputCls} value={sections[f.key] || ''} onChange={e => setSections(p => ({ ...p, [f.key]: e.target.value }))} />
                  : <input className={inputCls} value={sections[f.key] || ''} onChange={e => setSections(p => ({ ...p, [f.key]: e.target.value }))} />}
              </label>
            ))}
          </section>
        ))}

        <section className="glass-panel rounded-2xl p-5 space-y-3">
          <h2 className="font-bold text-sm">Supporting documents</h2>
          <p className="text-xs text-theme-text-secondary">Up to 8 files, 10 MB each. Anything missing will be requested in writing; staff do not fill gaps for you.</p>
          <div className="grid md:grid-cols-2 gap-2">
            {FILE_SUGGESTIONS.map(l => (
              <label key={l} className="text-xs block">{l}<input type="file" multiple className={inputCls} onChange={e => { addFiles(e.target.files, l); e.target.value = ''; }} /></label>
            ))}
          </div>
          {files.length > 0 && <ul className="text-xs space-y-1">{files.map((f, i) => <li key={i} className="flex justify-between"><span>{f.label}: {f.name}</span><button className="text-red-400" onClick={() => setFiles(files.filter((_, j) => j !== i))}>remove</button></li>)}</ul>}
        </section>

        <section className="glass-panel rounded-2xl p-5 space-y-3">
          <h2 className="font-bold text-sm">L. Declarations</h2>
          <label className="text-xs flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
            I declare the information is accurate, give RTBI permission to verify it, have disclosed any conflicts of interest, and acknowledge the confidentiality and data-use terms.</label>
          <label className="text-xs block">Signature (type your full name) *<input className={inputCls} value={signedName} onChange={e => setSignedName(e.target.value)} /></label>
          <input aria-hidden tabIndex={-1} autoComplete="off" className="hidden" value={hp} onChange={e => setHp(e.target.value)} />
        </section>

        {err && <div className="text-sm text-red-400">{err}</div>}
        <button onClick={submit} disabled={busy} className="px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-50">{busy ? 'Submitting…' : 'Submit application'}</button>
      </div>
    </main>
  );
}
