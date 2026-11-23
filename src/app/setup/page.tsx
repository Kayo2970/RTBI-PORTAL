'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SetupWizard } from '@/components/setup-wizard';
import { LoadingScreen } from '@/components/loading-screen';
import dynamic from 'next/dynamic';

const AcidSquaresBackground = dynamic(
  () => import('@/components/acid-squares-background').then((m) => m.AcidSquaresBackground),
  { ssr: false }
);

export default function SetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [isKeyConfigured, setIsKeyConfigured] = useState(false);
  const [suggestedKey, setSuggestedKey] = useState('');

  useEffect(() => {
    async function checkSetup() {
      if (typeof window !== 'undefined' && window.location.search.includes('preview=true')) {
        setNeedsSetup(true);
        setIsKeyConfigured(false);
        setSuggestedKey('e8b491a520d4f3b7c891340156d98a213e4b7c8f90123456789abcdef0123456');
        setLoading(false);
        return;
      }
      try {
        const res = await fetch('/api/setup');
        const data = await res.json();
        if (data.needsSetup) {
          setNeedsSetup(true);
          setIsKeyConfigured(Boolean(data.isKeyConfigured));
          setSuggestedKey(data.suggestedKey || '');
        } else {
          // If setup already done, go to login
          router.replace('/');
        }
      } catch (err) {
        console.error('Failed to check setup status:', err);
      } finally {
        setLoading(false);
      }
    }
    checkSetup();
  }, [router]);

  if (loading) {
    return <LoadingScreen duration={2000} subtitle="Checking system setup status..." />;
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-space-theme text-theme-text-primary relative z-0 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none -z-10 opacity-70 dark:opacity-85">
        <AcidSquaresBackground
          color="#120f17"
          accentColor="#ff4fb8"
          secondaryColor="#3b6bff"
          tileSize={1}
          gap={0.12}
          roundness={0.25}
          rotation={35}
          waves={1}
          pulse={1}
          lighting="split"
          tilt={0.7}
          grain={0.12}
          intro={true}
          mouseInteraction={true}
        />
      </div>
      <div className="w-full max-w-lg space-y-4 relative z-10">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="h-14 w-14 flex items-center justify-center">
            <img
              src="/images/rtbi-icon.png"
              alt="RTBI Logo"
              className="h-full w-full object-contain filter drop-shadow-[0_4px_10px_rgba(54,28,106,0.35)]"
            />
          </div>
          <h1 className="text-xl font-extrabold tracking-wider uppercase text-theme-text-primary">
            RTBI PORTAL
          </h1>
          <p className="text-xs text-theme-text-secondary font-medium">
            Initial Operations & Database Provisioning Wizard
          </p>
        </div>

        {/* Setup Wizard Card */}
        <SetupWizard
          initialSuggestedKey={suggestedKey}
          isKeyConfigured={isKeyConfigured}
          onComplete={() => router.push('/dashboard/home')}
        />
      </div>
    </div>
  );
}
