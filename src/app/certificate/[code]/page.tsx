'use client';

import React, { useEffect, useState, use } from 'react';
import { ShieldCheck, AlertTriangle } from 'lucide-react';

interface Verified {
  code: string;
  attendeeName: string;
  eventName: string;
  eventDate: string;
  issuedAt: string;
}

export default function VerifyCertificatePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [data, setData] = useState<Verified | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');

  useEffect(() => {
    fetch(`/api/certificate/${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setData(d);
        setState('ok');
      })
      .catch(() => setState('missing'));
  }, [code]);

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg p-6 sm:p-8 text-center space-y-4">
        {state === 'loading' && <p className="text-slate-500 text-sm">Checking certificate…</p>}
        {state === 'missing' && (
          <>
            <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
            <h1 className="text-lg font-bold text-slate-900">Certificate not found</h1>
            <p className="text-sm text-slate-600">We could not verify certificate ID <span className="font-mono">{code}</span>. Please check the ID and try again.</p>
          </>
        )}
        {state === 'ok' && data && (
          <>
            <ShieldCheck className="h-10 w-10 text-emerald-600 mx-auto" />
            <h1 className="text-lg font-bold text-slate-900">Valid certificate</h1>
            <p className="text-sm text-slate-600">
              Issued to <strong>{data.attendeeName}</strong> for attending <strong>{data.eventName}</strong>
              {data.eventDate ? ` (${data.eventDate})` : ''}, by RTBI, RUAS.
            </p>
            <p className="text-xs text-slate-500">Certificate ID <span className="font-mono">{data.code}</span> · issued {new Date(data.issuedAt).toLocaleDateString()}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/certificate/${encodeURIComponent(data.code)}/image`} alt="Certificate" className="w-full rounded-lg border border-slate-200" />
          </>
        )}
      </div>
    </main>
  );
}
