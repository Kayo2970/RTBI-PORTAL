'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { WalletProgressBar, fetchWalletPrepared, openWalletPass, useWalletProgress, WalletTarget } from '@/components/wallet-progress';

function WalletInner() {
  const { serial } = useParams<{ serial: string }>();
  const target: WalletTarget = useSearchParams().get('to') === 'google' ? 'google' : 'apple';
  const { progress, run } = useWalletProgress(5000);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const name = target === 'apple' ? 'Apple Wallet' : 'Google Wallet';

  useEffect(() => {
    let cancelled = false;
    run(() => fetchWalletPrepared(serial))
      .then((prepared) => {
        if (cancelled) return;
        openWalletPass(serial, target, prepared);
        setDone(true);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial, target]);

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center">
      <img src="/card/rtbi-logo.png" alt="RTBI" className="h-14 w-14 object-contain mb-5" />
      {error ? (
        <div className="max-w-md space-y-4">
          <p className="text-rose-300 text-sm font-semibold">{error}</p>
          <a href={`/pass/${encodeURIComponent(serial)}`} className="inline-block px-5 py-2.5 rounded-xl bg-sky-600 text-sm font-bold">View your digital pass instead</a>
        </div>
      ) : (
        <>
          <WalletProgressBar progress={progress} label={`Getting your pass converted for ${name}…`} />
          <p className="text-xs text-slate-400 max-w-sm mt-2">
            {done
              ? target === 'apple'
                ? 'Your pass is ready — tap “Add” when your phone asks.'
                : 'Opening Google Wallet…'
              : 'Hang tight — we are preparing your personal pass.'}
          </p>
          {done && (
            <a href={`/pass/${encodeURIComponent(serial)}`} className="mt-5 text-xs text-sky-300 underline">View digital pass</a>
          )}
        </>
      )}
    </main>
  );
}

export default function WalletPage() {
  return (
    <Suspense fallback={null}>
      <WalletInner />
    </Suspense>
  );
}
