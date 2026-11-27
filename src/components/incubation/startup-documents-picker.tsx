'use client';

import React, { useState } from 'react';
import { RTBI_MANDATORY_DOCUMENTS } from '@/lib/incubation/onboarding';
import { readFileAsDataUrl, type DocUpload } from '@/lib/incubation/client';

const MAX_BYTES = 15 * 1024 * 1024;
const inputCls = 'w-full bg-theme-background/40 border border-theme-border/40 rounded-xl px-3 py-2 text-xs';

/** Pick the six mandatory RTBI documents while creating a startup. All optional — they can be uploaded later and are verified by staff. */
export function StartupDocumentsPicker({ value, onChange }: { value: Record<string, DocUpload>; onChange: (v: Record<string, DocUpload>) => void }) {
  const [err, setErr] = useState('');
  const pick = async (key: string, file?: File) => {
    if (!file) return;
    if (file.size > MAX_BYTES) { setErr(`"${file.name}" exceeds the 15 MB limit.`); return; }
    setErr('');
    onChange({ ...value, [key]: { name: file.name, type: file.type, dataUrl: await readFileAsDataUrl(file) } });
  };
  const clear = (key: string) => { const n = { ...value }; delete n[key]; onChange(n); };
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold">Startup documents <span className="font-normal text-theme-text-secondary">(optional now — can be uploaded later; staff verify each file)</span></div>
      <div className="grid md:grid-cols-2 gap-2">
        {RTBI_MANDATORY_DOCUMENTS.map(d => (
          <div key={d.key} className="text-xs space-y-1">
            <span className="block">{d.num}. {d.label}{d.required ? ' *' : ''}</span>
            {value[d.key]
              ? <div className="flex items-center justify-between gap-2 rounded-xl border border-theme-border/40 px-3 py-2"><span className="truncate">{value[d.key].name}</span><button type="button" className="text-red-400 shrink-0" onClick={() => clear(d.key)}>Remove</button></div>
              : <input type="file" className={inputCls} onChange={e => { pick(d.key, e.target.files?.[0]); e.target.value = ''; }} />}
          </div>
        ))}
      </div>
      {err && <div className="text-xs text-red-400">{err}</div>}
    </div>
  );
}
