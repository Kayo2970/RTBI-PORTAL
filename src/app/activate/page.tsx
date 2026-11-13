'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ShieldAlert, CheckCircle2, Lock, Eye, EyeOff, LogIn, Sparkles, Cake, Phone, ArrowRight } from 'lucide-react';
import { InteractiveKeycardHolder } from '@/components/interactive-keycard-holder';
import dynamic from 'next/dynamic';

const AeroShardsBackground = dynamic(
  () => import('@/components/aero-shards-background').then((m) => m.AeroShardsBackground),
  { ssr: false }
);

function ActivateAccountForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [status, setStatus] = useState<'loading' | 'invalid' | 'ready' | 'done'>('loading');
  const [validationError, setValidationError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [cardSlug, setCardSlug] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      setValidationError('No activation link provided.');
      return;
    }
    fetch(`/api/auth/activate-account?token=${encodeURIComponent(token)}`)
      .then(res => res.json())
      .then(data => {
        if (data.valid) {
          setName(data.name);
          setEmail(data.email);
          setRole(data.role || 'Member');
          setCardSlug(data.cardSlug || '');
          setStatus('ready');
        } else {
          setValidationError(data.error || 'This activation link is invalid.');
          setStatus('invalid');
        }
      })
      .catch(() => {
        setValidationError('Could not verify this activation link. Please try again.');
        setStatus('invalid');
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');

    if (newPassword.length < 4) {
      setSubmitError('Password must be at least 4 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setSubmitError('Passwords do not match.');
      return;
    }
    if (phone.trim().length < 7) {
      setSubmitError('Enter a valid mobile number.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/activate-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword, dateOfBirth: dateOfBirth || undefined, phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to activate your account.');
      if (data.member) {
        if (data.member.role) setRole(data.member.role);
        if (data.member.cardSlug) setCardSlug(data.member.cardSlug);
      }
      setStatus('done');
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to activate your account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === 'done') {
    const dynamicQr = cardSlug ? `/api/card/${cardSlug}/qr` : '/card/rtbi-qr-code.png';
    return (
      <div className="min-h-screen bg-space-theme text-theme-text-primary flex flex-col items-center justify-center p-4 py-10 relative z-0 overflow-x-hidden">
        {/* Top Celebration Header */}
        <div className="w-full max-w-2xl text-center space-y-3 mb-4 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/15 border border-accent/30 text-accent text-[11px] font-bold tracking-wider uppercase">
            <Sparkles className="h-3.5 w-3.5" /> Official Induction & Credentials Issued
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            Welcome to the Centre, {name.split(' ')[0]}!
          </h1>
          <p className="text-xs md:text-sm text-theme-text-secondary max-w-md mx-auto">
            These are your official executive credentials and digital access pass for the RTBI Portal.
          </p>
        </div>

        {/* 3D Leather Keycard Presentation */}
        <div className="w-full max-w-md my-2 animate-in zoom-in-95 duration-500">
          <InteractiveKeycardHolder
            memberName={name}
            memberRole={role || 'Executive Member'}
            phone={phone}
            email={email}
            cardUrl={cardSlug && typeof window !== 'undefined' ? `${window.location.origin}/card/${cardSlug}` : undefined}
            qrUrl={dynamicQr}
            issuingAuthority="RTBI Portal"
            autoOpen={true}
            showActions={false}
          />
        </div>

        {/* Bottom Navigation Actions */}
        <div className="w-full max-w-sm flex flex-col sm:flex-row items-center gap-3 mt-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <Link
            href="/"
            className="w-full py-3 bg-accent hover:bg-primary-light text-white font-bold rounded-xl transition-all shadow-lg shadow-accent/25 flex items-center justify-center gap-2 text-xs"
          >
            <LogIn className="h-4 w-4" />
            Proceed to Sign In
          </Link>
          {cardSlug && (
            <a
              href={`/card/${cardSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-all border border-white/15 flex items-center justify-center gap-2 text-xs"
            >
              <span>View Public Card</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-space-theme flex flex-col items-center justify-center p-4 md:p-8 relative z-0 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none -z-10 opacity-70 dark:opacity-85">
        <AeroShardsBackground
          shardColor="#361C6A"
          accentColor="#E34A21"
          placement="full"
          material="glass"
          markers="plus"
          count={1250}
          depthOfField={0.75}
          vignette={0.3}
          mouseInteraction
          pulseOnClick
          holdToGather
          spread={2}
          speed={2.56}
        />
      </div>
      <div className="w-full max-w-md glass-panel rounded-3xl p-6 md:p-8 flex flex-col space-y-6 relative z-10 border border-white/15 shadow-2xl">
        {/* Brand Header */}
        <Link
          href="/"
          className="flex flex-col items-center text-center space-y-2 md:space-y-3 hover:opacity-90 transition-all cursor-pointer select-none"
          title="RTBI Portal Home"
        >
          <div className="h-12 w-12 md:h-16 md:w-16 flex items-center justify-center">
            <img
              src="/images/rtbi-icon.png"
              alt="RTBI Logo"
              className="h-full w-full object-contain filter drop-shadow-[0_4px_10px_rgba(54,28,106,0.35)]"
            />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-wider uppercase text-theme-text-primary">
              RTBI PORTAL
            </h1>
            <p className="text-xs text-theme-text-secondary mt-1 font-medium">
              Set up your account to access the operational portal
            </p>
          </div>
        </Link>

        {status === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-8 text-theme-text-secondary text-xs">
            <span className="h-6 w-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            Verifying your activation link...
          </div>
        )}

        {status === 'invalid' && (
          <div className="space-y-4">
            <div className="flex gap-3 p-3.5 bg-danger/10 border border-danger/25 rounded-2xl text-danger text-xs leading-relaxed">
              <ShieldAlert className="h-4.5 w-4.5 shrink-0" />
              <span>{validationError}</span>
            </div>
            <Link
              href="/"
              className="w-full py-3 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 text-xs"
            >
              <LogIn className="h-3.5 w-3.5" />
              Go to Sign In
            </Link>
          </div>
        )}

        {status === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="flex items-center gap-2.5 p-3.5 bg-accent/10 border border-accent/20 rounded-2xl">
              <Sparkles className="h-4 w-4 text-accent shrink-0" />
              <div>
                <p className="font-bold text-theme-text-primary">Welcome, {name}!</p>
                <p className="text-[11px] text-theme-text-secondary">{email}</p>
              </div>
            </div>

            {submitError && (
              <div className="flex gap-3 p-3.5 bg-danger/10 border border-danger/25 rounded-2xl text-danger text-xs leading-relaxed">
                <ShieldAlert className="h-4.5 w-4.5 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                Choose a Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 4 characters"
                  className="w-full pl-10 pr-10 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-accent text-xs transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 p-0.5 rounded text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
                  title={showPassword ? 'Hide password' : 'View password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full pl-10 pr-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-accent text-xs transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                Mobile Number
              </label>
              <div className="relative">
                <Phone className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 XXXXX XXXXX"
                  className="w-full pl-10 pr-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-accent text-xs transition-all"
                />
              </div>
              <p className="text-[11px] text-theme-text-secondary/70">Stored in the Members Directory so the Centre can reach you.</p>
            </div>

            <div className="space-y-1.5">
              <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                Date of Birth <span className="normal-case font-medium text-theme-text-secondary/70">(optional)</span>
              </label>
              <div className="relative">
                <Cake className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full pl-10 pr-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-accent text-xs transition-all"
                />
              </div>
              <p className="text-[11px] text-theme-text-secondary/70">We&apos;ll send you a birthday surprise from the Centre — you can also add this later from Settings.</p>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all duration-200 shadow-md shadow-accent/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-2 text-xs"
            >
              {isSubmitting ? (
                <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Activate My Account
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ActivateAccountPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-space-theme" />}>
      <ActivateAccountForm />
    </Suspense>
  );
}
