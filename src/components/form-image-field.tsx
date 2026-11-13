'use client';

import React, { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { authHeaders } from '@/lib/local-data';

/** Turn a Google Drive share link into a directly embeddable image URL (the file must be shared "Anyone with the link"). */
export function normalizeImageLink(raw: string): string {
  const link = raw.trim();
  const m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]+)/.exec(link);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w2000` : link;
}

/** Shrink a picked image to at most 1920px wide before upload so phone photos don't hit the size cap. */
function downscale(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1920 / img.width);
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

interface Props {
  label: string;
  hint: string;
  kind: 'header' | 'background';
  value: string;
  onChange: (url: string) => void;
  /** Hide the built-in thumbnail when the caller shows its own preview. */
  showPreview?: boolean;
}

export function FormImageField({ label, hint, kind, value, onChange, showPreview = true }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file?: File) => {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const dataUrl = await downscale(file);
      const res = await fetch('/api/forms/image', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ dataUrl, kind }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed.');
      onChange(data.url);
    } catch (e: any) {
      setError(e.message || 'Upload failed.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="block font-medium text-theme-text-secondary">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(normalizeImageLink(e.target.value))}
          placeholder="Paste an image link (Google Drive share link works) or upload"
          className="flex-1 min-w-0 px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
        />
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-theme-card-border text-theme-text-primary hover:border-accent cursor-pointer disabled:opacity-60">
          <Upload className="h-4 w-4" />{busy ? 'Uploading…' : 'Upload'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
      </div>
      <p className="text-[10px] text-theme-text-secondary">{hint} Drive images must be shared as &quot;Anyone with the link&quot;.</p>
      {error && <p className="text-[11px] text-danger">{error}</p>}
      {value && showPreview && (
        <div className="relative h-24 rounded-xl overflow-hidden border border-theme-card-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="h-full w-full object-cover" />
          <button type="button" onClick={() => onChange('')} title="Remove image" className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white cursor-pointer"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </div>
  );
}
