'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { authHeaders } from '@/lib/local-data';

/** Client-safe mirror of the server's blur limits (src/lib/email-background.ts). */
export const EMAIL_BLUR_MAX = 40;
export const EMAIL_BLUR_DEFAULT = 12;

/** What a mail-merge screen asks for on one send: the saved default, no background, or a picture of its own. */
export interface EmailBackgroundPick {
  mode: 'default' | 'none' | 'custom';
  storageKey?: string;
  blur: number;
}
export const DEFAULT_BACKGROUND_PICK: EmailBackgroundPick = { mode: 'default', blur: EMAIL_BLUR_DEFAULT };

/** The `background` value to send to the API for this pick (undefined = leave it to the Email Settings default). */
export function backgroundChoiceFor(p: EmailBackgroundPick): 'default' | 'none' | { storageKey: string; blur: number } | undefined {
  if (p.mode === 'none') return 'none';
  if (p.mode === 'custom' && p.storageKey) return { storageKey: p.storageKey, blur: p.blur };
  return undefined;
}

/** Shrink a picked image to at most 1600px wide before upload so phone photos don't hit the size cap. */
function downscale(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

/** Upload + blur slider + live preview of the blurred result. Controlled by `storageKey` / `blur`. */
export function EmailBackgroundField({
  storageKey,
  blur,
  onChange,
  disabled,
}: {
  storageKey?: string;
  blur: number;
  onChange: (next: { storageKey?: string; blur: number }) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewing, setPreviewing] = useState(false);

  // The preview is the real blurred JPEG the recipients get, fetched (debounced) from the server.
  useEffect(() => {
    if (!storageKey) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await fetch(`/api/email/background?key=${encodeURIComponent(storageKey)}&blur=${blur}`, { headers: authHeaders(), cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setPreviewUrl(res.ok ? data.url : '');
      } catch {
        if (!cancelled) setPreviewUrl('');
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [storageKey, blur]);

  const handleFile = async (file?: File) => {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const dataUrl = await downscale(file);
      const res = await fetch('/api/email/background', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ dataUrl }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.storageKey) throw new Error(data.error || 'Upload failed.');
      onChange({ storageKey: data.storageKey, blur });
    } catch (e: any) {
      setError(e.message || 'Upload failed.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
        <button type="button" disabled={busy || disabled} onClick={() => fileRef.current?.click()} className="px-3 py-2 rounded-xl border border-dashed border-theme-border/60 text-xs font-semibold text-theme-text-secondary hover:bg-theme-border/10 flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
          {storageKey ? 'Replace picture' : 'Upload a picture'}
        </button>
        {storageKey && (
          <button type="button" disabled={disabled} onClick={() => onChange({ storageKey: undefined, blur })} className="px-3 py-2 rounded-xl text-xs font-semibold text-rose-400 border border-rose-500/30 flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
            <X className="h-3.5 w-3.5" /> Remove
          </button>
        )}
        <span className="text-[10px] text-theme-text-secondary">JPG, PNG or WebP, up to 6 MB.</span>
      </div>
      {error && <p className="text-[11px] text-danger">{error}</p>}
      {storageKey && (
        <>
          <label className="flex items-center gap-3 text-xs text-theme-text-secondary">
            <span className="font-semibold w-20 shrink-0">Blur: {blur}px</span>
            <input type="range" min={0} max={EMAIL_BLUR_MAX} value={blur} disabled={disabled} onChange={(e) => onChange({ storageKey, blur: Number(e.target.value) })} className="flex-1 accent-sky-500" />
          </label>
          <div className="relative h-36 rounded-xl overflow-hidden border border-theme-border/40 bg-slate-100 dark:bg-slate-900">
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Blurred background preview" className="absolute inset-0 h-full w-full object-cover" />
            )}
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="w-full max-w-xs rounded-lg bg-white shadow-md border border-slate-200 p-3 text-[10px] text-slate-600">
                <div className="h-2 w-24 rounded bg-slate-300 mb-2" />
                <div className="h-1.5 w-full rounded bg-slate-200 mb-1" />
                <div className="h-1.5 w-4/5 rounded bg-slate-200" />
              </div>
            </div>
            {previewing && <Loader2 className="absolute top-2 right-2 h-4 w-4 animate-spin text-white drop-shadow" />}
          </div>
        </>
      )}
      <p className="text-[10px] text-theme-text-secondary leading-relaxed">
        Shown behind the e-mail; the message itself stays on a white card so it is easy to read. Desktop Outlook ignores background pictures and shows a plain light background instead.
      </p>
    </div>
  );
}

/** Per-send choice for a mail-merge screen: use the saved default, no background, or a custom blurred picture. */
export function EmailBackgroundPicker({
  value,
  onChange,
  disabled,
}: {
  value: EmailBackgroundPick;
  onChange: (next: EmailBackgroundPick) => void;
  disabled?: boolean;
}) {
  const opts: Array<[EmailBackgroundPick['mode'], string]> = [
    ['default', 'Use the default'],
    ['none', 'No background'],
    ['custom', 'Custom picture'],
  ];
  return (
    <div className="space-y-2 p-3 rounded-xl border border-slate-200 dark:border-white/10" data-testid="email-background-picker">
      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">Email background (blurred picture)</label>
      <div className="flex flex-wrap gap-4 text-xs font-bold text-slate-700 dark:text-slate-200">
        {opts.map(([mode, text]) => (
          <label key={mode} className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" disabled={disabled} checked={value.mode === mode} onChange={() => onChange({ ...value, mode })} /> {text}
          </label>
        ))}
      </div>
      {value.mode === 'default' && <p className="text-[10px] text-slate-500">Uses the background set in Email → Settings, if there is one.</p>}
      {value.mode === 'custom' && (
        <EmailBackgroundField storageKey={value.storageKey} blur={value.blur} disabled={disabled} onChange={(n) => onChange({ ...value, storageKey: n.storageKey, blur: n.blur })} />
      )}
    </div>
  );
}
