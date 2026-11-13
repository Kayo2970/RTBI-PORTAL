'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SetupWizard } from '@/components/setup-wizard';
import { LoadingScreen } from '@/components/loading-screen';

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
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-gradient-to-br from-theme-background via-theme-background to-primary-dark/20 text-theme-text-primary">
      <div className="w-full max-w-lg space-y-4">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="h-14 w-14 flex items-center justify-center">
            <img
              src="/images/leads-short-logo.png"
              alt="LEADS Logo"
              className="h-full w-full object-contain filter drop-shadow-[0_4px_10px_rgba(46,117,182,0.35)]"
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
