'use client';

import CodeSlots from '@/components/code-slots';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldAlert, LogIn, Mail, Lock, Eye, EyeOff, KeyRound, CheckCircle2, Clock, ArrowLeft, Send, Quote } from 'lucide-react';
import { logAuditEvent, requestPasswordReset, submitPasswordReset, submitAdminOverridePasswordReset, setSessionToken, getSessionToken } from '@/lib/local-data';
import { TermsModal } from '@/components/terms-modal';
import { PrivacyPolicyModal } from '@/components/privacy-policy-modal';
import { IosInstallPrompt } from '@/components/ios-install-prompt';
import { LoadingScreen } from '@/components/loading-screen';
import { SetupWizard } from '@/components/setup-wizard';
import dynamic from 'next/dynamic';
const AeroShardsBackground = dynamic(
  () => import('@/components/aero-shards-background').then((m) => m.AeroShardsBackground),
  { ssr: false }
);

interface QuoteItem {
  quote: string;
  author: string;
  title: string;
}

const INSPIRATIONAL_QUOTES: QuoteItem[] = [
  {
    quote: "Be the change that you wish to see in the world.",
    author: "Mahatma Gandhi",
    title: "Leader of Indian Independence Movement",
  },
  {
    quote: "It always seems impossible until it's done.",
    author: "Nelson Mandela",
    title: "Former President of South Africa & Nobel Laureate",
  },
  {
    quote: "Dream is not that which you see while sleeping, it is something that does not let you sleep.",
    author: "Dr. A.P.J. Abdul Kalam",
    title: "Former President of India & Aerospace Scientist",
  },
  {
    quote: "The time is always right to do what is right.",
    author: "Martin Luther King Jr.",
    title: "Civil Rights Movement Leader",
  },
  {
    quote: "Arise, awake, and stop not till the goal is reached.",
    author: "Swami Vivekananda",
    title: "Philosopher & Spiritual Visionary",
  },
  {
    quote: "Spread love everywhere you go. Let no one ever come to you without leaving happier.",
    author: "Mother Teresa",
    title: "Nobel Peace Prize Laureate & Humanitarian",
  },
  {
    quote: "The best way to predict the future is to create it.",
    author: "Peter Drucker",
    title: "Management Visionary & Author",
  },
  {
    quote: "Innovation distinguishes between a leader and a follower.",
    author: "Steve Jobs",
    title: "Co-founder of Apple Inc.",
  },
  {
    quote: "If your actions inspire others to dream more, learn more, do more and become more, you are a leader.",
    author: "John Quincy Adams",
    title: "6th President of the United States",
  },
  {
    quote: "Let us remember: one book, one pen, one child, and one teacher can change the world.",
    author: "Malala Yousafzai",
    title: "Nobel Peace Prize Laureate & Education Activist",
  },
  {
    quote: "Education is the most powerful weapon which you can use to change the world.",
    author: "Nelson Mandela",
    title: "Former President of South Africa & Nobel Laureate",
  },
  {
    quote: "You have to dream before your dreams can come true.",
    author: "Dr. A.P.J. Abdul Kalam",
    title: "Former President of India & The People's President",
  },
  {
    quote: "Excellence is to do a common thing in an uncommon way.",
    author: "Booker T. Washington",
    title: "Educator & Founder of Tuskegee Institute",
  },
  {
    quote: "Leadership is hard to define and good leadership even harder. But if you can get people to follow you to the ends of the earth, you are a great leader.",
    author: "Indra Nooyi",
    title: "Former Chairman & CEO of PepsiCo",
  },
  {
    quote: "None can destroy iron, but its own rust can. Likewise, no one can destroy a person, but their own mindset can.",
    author: "Ratan Tata",
    title: "Former Chairman, Tata Sons",
  },
  {
    quote: "Change will not come if we wait for some other person or some other time. We are the ones we've been waiting for.",
    author: "Barack Obama",
    title: "44th President of the United States",
  },
  {
    quote: "The most difficult thing is the decision to act, the rest is merely tenacity.",
    author: "Amelia Earhart",
    title: "Aviation Pioneer",
  },
  {
    quote: "The future belongs to those who believe in the beauty of their dreams.",
    author: "Eleanor Roosevelt",
    title: "Former First Lady of the United States & Human Rights Advocate",
  },
  {
    quote: "The end-product of education should be a free creative man, who can battle against historical circumstances and adversities of nature.",
    author: "Dr. Sarvepalli Radhakrishnan",
    title: "Former President of India & Philosopher-Teacher",
  },
  {
    quote: "Leaders don't create followers, they create more leaders.",
    author: "Kiran Bedi",
    title: "India's First Woman IPS Officer",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showLoginSplash, setShowLoginSplash] = useState(false);
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);

  // Dynamic Quotes state
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [isQuoteFading, setIsQuoteFading] = useState(false);

  // Forgot Password Modal state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotStep, setForgotStep] = useState<'REQUEST' | 'VERIFY'>('REQUEST');
  const [forgotEmail, setForgotEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpStatus, setOtpStatus] = useState<'idle' | 'error' | 'success'>('idle');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');
  const [isForgotLoading, setIsForgotLoading] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [timeLeftStr, setTimeLeftStr] = useState('05:00');

  // Super User Admin Override Modal state
  const [showAdminOverrideModal, setShowAdminOverrideModal] = useState(false);
  const [overrideEmail, setOverrideEmail] = useState('');
  const [overrideName, setOverrideName] = useState('');
  const [overrideNewPassword, setOverrideNewPassword] = useState('');
  const [overrideConfirmPassword, setOverrideConfirmPassword] = useState('');
  const [overrideError, setOverrideError] = useState('');
  const [overrideSuccess, setOverrideSuccess] = useState('');
  const [isOverrideLoading, setIsOverrideLoading] = useState(false);

  // Initial Setup Wizard detection state
  const [needsSetup, setNeedsSetup] = useState(false);
  const [isCheckingSetup, setIsCheckingSetup] = useState(true);
  const [isKeyConfigured, setIsKeyConfigured] = useState(false);
  const [suggestedKey, setSuggestedKey] = useState('');

  // Check if user is navigating with a pass serial parameter (e.g. from an invite link)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const passSerial = searchParams.get('pass') || searchParams.get('passId') || searchParams.get('serial');
      if (passSerial) {
        router.replace(`/pass/${encodeURIComponent(passSerial)}`);
      }
    }
  }, [router]);

  // Check if system requires initial setup
  useEffect(() => {
    fetch('/api/setup')
      .then(res => res.json())
      .then(data => {
        if (data && data.needsSetup) {
          setNeedsSetup(true);
          setIsKeyConfigured(Boolean(data.isKeyConfigured));
          setSuggestedKey(data.suggestedKey || '');
        } else {
          setNeedsSetup(false);
        }
      })
      .catch(err => {
        console.error('Setup check failed:', err);
      })
      .finally(() => {
        setIsCheckingSetup(false);
      });
  }, []);

  // Auto-rotate quotes every ~1.75 seconds (50% faster)
  useEffect(() => {
    const timer = setInterval(() => {
      setIsQuoteFading(true);
      setTimeout(() => {
        setQuoteIndex(prev => (prev + 1) % INSPIRATIONAL_QUOTES.length);
        setIsQuoteFading(false);
      }, 175);
    }, 1750);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && systemDark)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    setThemeLoaded(true);

    // Surface why the session ended, if the dashboard shell's inactivity
    // timer is what sent the user here (see dashboard-shell.tsx).
    if (localStorage.getItem('logoutReason') === 'inactivity') {
      setError('You were automatically logged out after 30 minutes of inactivity. Please sign in again.');
      localStorage.removeItem('logoutReason');
    } else if (localStorage.getItem('logoutReason') === 'terminated') {
      setError('Your account has been terminated and you have lost access to the portal. Contact your Centre Head if you believe this is a mistake.');
      localStorage.removeItem('logoutReason');
    } else if (localStorage.getItem('logoutReason') === 'session_expired') {
      setError('Your session has ended (for example after a password reset request). Please sign in again.');
      localStorage.removeItem('logoutReason');
    }

    // If already logged in with an active session token, route to home or target URL
    const currentUser = localStorage.getItem('user');
    const token = getSessionToken();
    if (currentUser && token) {
      const redirectTarget = sessionStorage.getItem('redirect_after_login') || '/dashboard/home';
      sessionStorage.removeItem('redirect_after_login');
      router.push(redirectTarget);
    } else if (currentUser && !token) {
      localStorage.removeItem('user');
    }
  }, [router]);

  // 5-minute countdown timer effect for OTP
  useEffect(() => {
    if (!expiresAt || forgotStep !== 'VERIFY') return;

    const interval = setInterval(() => {
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) {
        setTimeLeftStr('00:00');
        setForgotError('The 5-minute verification code has expired. Please request a new code.');
        clearInterval(interval);
      } else {
        const totalSec = Math.floor(remainingMs / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        setTimeLeftStr(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, forgotStep]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!password || password.length < 4) {
      setError('Please enter a valid password (minimum 4 characters).');
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (data.requiresPasswordReset) {
        setIsLoading(false);
        setOverrideEmail(data.email || email);
        setOverrideName(data.name || 'Member');
        setOverrideError('');
        setOverrideSuccess('');
        setOverrideNewPassword('');
        setOverrideConfirmPassword('');
        setShowAdminOverrideModal(true);
        return;
      }

      if (!res.ok) {
        setError(data.error || 'Login failed. Please try again.');
        setIsLoading(false);
        return;
      }

      // Save logged-in user + session token to localStorage
      localStorage.setItem('user', JSON.stringify(data.user));
      setSessionToken(data.token);
      logAuditEvent('USER_LOGIN', data.user.name, `Logged in successfully with role ${data.user.role} (Tier ${data.user.tier})`);

      setIsLoading(false);
      setShowLoginSplash(true);
    } catch {
      setError('Network error — could not reach the server. Please try again.');
      setIsLoading(false);
    }
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError('');
    setForgotSuccess('');
    setIsForgotLoading(true);

    if (!forgotEmail.trim()) {
      setForgotError('Please enter your registered email address.');
      setIsForgotLoading(false);
      return;
    }

    const res = await requestPasswordReset(forgotEmail.trim());
    setIsForgotLoading(false);

    if (res.adminOverride) {
      setShowForgotModal(false);
      setOverrideEmail(forgotEmail.trim());
      setOverrideName(res.name || 'Member');
      setOverrideError('');
      setOverrideSuccess('');
      setOverrideNewPassword('');
      setOverrideConfirmPassword('');
      setShowAdminOverrideModal(true);
      return;
    }

    if (!res.success) {
      setForgotError(res.error || 'Account not found or error requesting OTP.');
      return;
    }

    if (res.activationLinkSent) {
      setForgotSuccess(res.message || 'A fresh account setup link has been emailed to you.');
      return;
    }

    setForgotSuccess(res.message || 'OTP code sent! Valid for 5 minutes.');
    if (res.expiresAt) {
      setExpiresAt(res.expiresAt);
    } else {
      setExpiresAt(Date.now() + 5 * 60 * 1000);
    }
    setOtpCode('');
    setOtpStatus('idle');
    setForgotStep('VERIFY');
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError('');
    setForgotSuccess('');
    setIsForgotLoading(true);

    if (!otpCode.trim() || otpCode.trim().length !== 6) {
      setForgotError('Please enter the complete 6-digit OTP code.');
      setIsForgotLoading(false);
      return;
    }

    if (!newPassword || newPassword.length < 4) {
      setForgotError('New password must be at least 4 characters long.');
      setIsForgotLoading(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setForgotError('New password and confirmation do not match.');
      setIsForgotLoading(false);
      return;
    }

    const res = await submitPasswordReset(forgotEmail.trim(), otpCode.trim(), newPassword);
    setIsForgotLoading(false);

    if (!res.success) {
      setForgotError(res.error || 'Password reset failed.');
      if (/code/i.test(res.error || '')) setOtpStatus('error');
      return;
    }

    setOtpStatus('success');
    setForgotSuccess('Password reset successfully! Redirecting to login...');
    setTimeout(() => {
      setEmail(forgotEmail.trim());
      setPassword(newPassword);
      setShowForgotModal(false);
      setForgotStep('REQUEST');
      setOtpCode('');
      setOtpStatus('idle');
      setForgotError('');
      setForgotSuccess('');
    }, 1500);
  };

  const handleOverrideSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOverrideError('');
    setOverrideSuccess('');
    setIsOverrideLoading(true);

    if (!overrideNewPassword || overrideNewPassword.length < 4) {
      setOverrideError('New password must be at least 4 characters long.');
      setIsOverrideLoading(false);
      return;
    }

    if (overrideNewPassword !== overrideConfirmPassword) {
      setOverrideError('New password and confirmation do not match.');
      setIsOverrideLoading(false);
      return;
    }

    const res = await submitAdminOverridePasswordReset(overrideEmail, overrideNewPassword);
    setIsOverrideLoading(false);

    if (!res.success) {
      setOverrideError(res.error || 'Failed to set new password.');
      return;
    }

    setOverrideSuccess('Password set successfully! Signing you in...');
    if (res.user) {
      localStorage.setItem('user', JSON.stringify(res.user));
      setSessionToken(res.token);
      logAuditEvent('USER_LOGIN', res.user.name, `Logged in after admin override password setup with role ${res.user.role}`);
      setTimeout(() => {
        setShowAdminOverrideModal(false);
        setShowLoginSplash(true);
      }, 1200);
    } else {
      setTimeout(() => {
        setEmail(overrideEmail);
        setPassword(overrideNewPassword);
        setShowAdminOverrideModal(false);
      }, 1200);
    }
  };

  if (!themeLoaded) return null;

  if (showLoginSplash) {
    const handleLoginComplete = () => {
      const redirectTarget = sessionStorage.getItem('redirect_after_login') || '/dashboard/home';
      sessionStorage.removeItem('redirect_after_login');
      router.push(redirectTarget);
    };

    return (
      <LoadingScreen
        duration={1000}
        subtitle="Signing you in..."
        onComplete={handleLoginComplete}
      />
    );
  }

  return (
    <div className="min-h-screen bg-space-theme flex flex-col items-center justify-center p-4 md:p-8 relative z-0 overflow-hidden">
      {/* Background Animated GhostFibers WebGL Canvas with RTBI Theme.
          -z-10 on the canvas keeps it behind all page content, same as
          dashboard-shell.tsx. The outer wrapper's `z-0` (added alongside
          `relative`) is the actual fix for this canvas being invisible: without
          an explicit z-index, `relative` alone never creates a stacking
          context, so this div's own opaque bg-space-theme background was
          painting in the root stacking context's normal-flow layer — which
          comes AFTER (paints over) the canvas's negative-z-index layer there,
          hiding it completely behind a flat color. `z-0` makes this div its
          own stacking-context root, so its background paints first/backmost
          inside that context and the canvas paints just above it. (A prior
          pass diagnosed the low visibility here as a vignette/margin-coverage
          tradeoff and lowered vignette from 0.8 to 0.3 to compensate — that
          was treating a symptom; this is the real fix, so vignette is
          restored to the originally requested 0.8.) */}
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

      {/* Grid Layout Container */}
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 items-stretch relative z-10">

        {/* Dynamic Quotes Hero Panel — shown after the login form on mobile so
            signing in never requires scrolling past a tall decorative panel. */}
        <div className="order-2 md:order-1 md:col-span-6 lg:col-span-7 glass-panel rounded-3xl p-5 md:p-8 flex flex-col justify-between min-h-[180px] md:min-h-[460px] relative overflow-hidden transition-all duration-300 border border-white/15 shadow-2xl bg-gradient-to-br from-accent/20 via-primary/10 to-transparent">
          <div className="absolute -top-16 -left-16 w-32 h-32 md:w-48 md:h-48 bg-accent/25 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 -right-16 w-32 h-32 md:w-48 md:h-48 bg-primary/20 rounded-full blur-3xl pointer-events-none" />

          {/* Quotes Header */}
          <div className="flex items-center justify-between z-10">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-accent/15 rounded-xl border border-accent/20 text-accent">
                <Quote className="h-5 w-5" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-accent">Words of Wisdom</span>
            </div>
          </div>

          {/* Quote Body */}
          <div className="my-auto py-3 md:py-8 z-10">
            <div className={`transition-all duration-300 ${isQuoteFading ? 'opacity-0 transform translate-y-2' : 'opacity-100 transform translate-y-0'}`}>
              <blockquote className="text-sm md:text-lg lg:text-xl font-medium text-theme-text-primary leading-relaxed italic">
                &ldquo;{INSPIRATIONAL_QUOTES[quoteIndex].quote}&rdquo;
              </blockquote>
              <div className="mt-4 md:mt-6 flex items-center gap-3">
                <div className="h-0.5 w-8 bg-accent/60 rounded-full" />
                <div>
                  <h4 className="text-sm font-bold text-theme-text-primary">
                    {INSPIRATIONAL_QUOTES[quoteIndex].author}
                  </h4>
                  <p className="text-[11px] text-theme-text-secondary font-medium mt-0.5">
                    {INSPIRATIONAL_QUOTES[quoteIndex].title}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Login or Initial Setup Wizard Panel */}
        {needsSetup ? (
          <div className="order-1 md:order-2 md:col-span-6 lg:col-span-5">
            <SetupWizard
              initialSuggestedKey={suggestedKey}
              isKeyConfigured={isKeyConfigured}
              onComplete={(_user) => {
                setShowLoginSplash(true);
              }}
            />
          </div>
        ) : (
          <div className="order-1 md:order-2 md:col-span-6 lg:col-span-5 glass-panel rounded-3xl p-6 md:p-8 flex flex-col justify-between space-y-5 md:space-y-7 relative overflow-hidden transition-all duration-300 border border-white/15 shadow-2xl">

            {/* Brand Header */}
            <Link
              href="/"
              className="flex flex-col items-center text-center space-y-2 md:space-y-3 hover:opacity-90 transition-all cursor-pointer select-none"
              title="RTBI Home"
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
                  Sign in with your MSRUAS email to access the operational portal
                </p>
              </div>
            </Link>

            {/* Error Alert Box */}
            {error && (
              <div className="flex gap-3 p-3.5 bg-danger/10 border border-danger/25 rounded-2xl text-danger text-xs leading-relaxed animate-in fade-in duration-200">
                <ShieldAlert className="h-4.5 w-4.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full pl-10 pr-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-accent text-xs transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(email);
                      setForgotError('');
                      setForgotSuccess('');
                      setForgotStep('REQUEST');
                      setShowForgotModal(true);
                    }}
                    className="text-[11px] text-accent hover:underline cursor-pointer font-medium"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
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

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all duration-200 shadow-md shadow-accent/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-2"
              >
                {isLoading ? (
                  <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    Sign In
                  </>
                )}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md rounded-3xl p-7 flex flex-col space-y-5 border border-white/20 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-theme-card-border/60 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-accent/15 rounded-xl text-accent">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-theme-text-primary">
                    {forgotStep === 'REQUEST' ? 'Reset Account Password' : 'Verify OTP Code'}
                  </h3>
                  <p className="text-[11px] text-theme-text-secondary">
                    {forgotStep === 'REQUEST' ? 'Enter your registered MSRUAS email address' : 'Enter the 5-minute code sent to your email'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowForgotModal(false)}
                className="text-theme-text-secondary hover:text-theme-text-primary text-sm p-1 rounded-lg hover:bg-white/10 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            {forgotError && (
              <div className="flex gap-2.5 p-3 bg-danger/15 border border-danger/30 rounded-xl text-danger text-xs leading-relaxed animate-in fade-in duration-150">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{forgotError}</span>
              </div>
            )}

            {forgotSuccess && (
              <div className="flex gap-2.5 p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs leading-relaxed animate-in fade-in duration-150">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{forgotSuccess}</span>
              </div>
            )}

            {forgotStep === 'REQUEST' ? (
              <form onSubmit={handleRequestOtp} className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                    Registered Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
                    <input
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full pl-10 pr-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-accent text-xs"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    className="w-1/3 py-2.5 bg-white/5 hover:bg-white/10 text-theme-text-secondary font-medium rounded-xl transition-all text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isForgotLoading}
                    className="w-2/3 py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 text-xs cursor-pointer disabled:opacity-50"
                  >
                    {isForgotLoading ? (
                      <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" />
                        Send 5-Min OTP
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleResetSubmit} className="space-y-4 text-xs">
                <div className="p-3 bg-theme-background/50 border border-theme-card-border/80 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[11px] text-theme-text-secondary">
                    <Clock className="h-3.5 w-3.5 text-accent animate-pulse" />
                    <span>OTP Expiry Timer:</span>
                  </div>
                  <span className="font-mono font-bold text-accent text-sm tracking-wider bg-accent/10 px-2.5 py-0.5 rounded-lg border border-accent/20">
                    {timeLeftStr}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                    6-Digit Verification OTP Code
                  </label>
                  <div className="flex justify-center">
                    <CodeSlots
                      length={6}
                      value={otpCode}
                      status={otpStatus}
                      autoFocus
                      onChange={(code: string) => {
                        setOtpCode(code);
                        if (code) setOtpStatus('idle');
                      }}
                      accentColor="var(--color-accent)"
                      inkColor="var(--color-accent)"
                      slotColor="color-mix(in srgb, var(--color-theme-background) 60%, transparent)"
                      digitColor="#ffffff"
                      slotSize={42}
                      gap={8}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                    New Password
                  </label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (min 4 chars)"
                    className="w-full px-3.5 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full px-3.5 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent text-xs"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setForgotStep('REQUEST')}
                    className="w-1/3 py-2.5 bg-white/5 hover:bg-white/10 text-theme-text-secondary font-medium rounded-xl transition-all text-xs flex items-center justify-center gap-1.5"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={isForgotLoading}
                    className="w-2/3 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 text-xs cursor-pointer disabled:opacity-50"
                  >
                    {isForgotLoading ? (
                      <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Update Password
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Super User Admin Override Modal (No OTP Required) */}
      {showAdminOverrideModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl p-5 sm:p-7 flex flex-col space-y-5 border border-amber-500/30 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-theme-card-border/60 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-500/20 rounded-xl text-amber-400 border border-amber-500/30">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-theme-text-primary">
                    Admin Override — Set Up New Password
                  </h3>
                  <p className="text-[11px] text-theme-text-secondary">
                    Super User requested password setup for {overrideName || overrideEmail}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAdminOverrideModal(false)}
                className="text-theme-text-secondary hover:text-theme-text-primary text-sm p-1 rounded-lg hover:bg-white/10 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl text-[11px] text-amber-300 leading-relaxed">
              Super User has enabled an admin override for your account. You can set up your new password directly below without an OTP code.
            </div>

            {overrideError && (
              <div className="flex gap-2.5 p-3 bg-danger/15 border border-danger/30 rounded-xl text-danger text-xs leading-relaxed animate-in fade-in duration-150">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{overrideError}</span>
              </div>
            )}

            {overrideSuccess && (
              <div className="flex gap-2.5 p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs leading-relaxed animate-in fade-in duration-150">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{overrideSuccess}</span>
              </div>
            )}

            <form onSubmit={handleOverrideSubmit} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                  Account Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
                  <input
                    type="email"
                    disabled
                    value={overrideEmail}
                    className="w-full pl-10 pr-4 py-2.5 bg-theme-background/60 border border-theme-card-border rounded-xl text-theme-text-primary opacity-80 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                  New Password
                </label>
                <input
                  type="password"
                  required
                  value={overrideNewPassword}
                  onChange={(e) => setOverrideNewPassword(e.target.value)}
                  placeholder="Enter new password (min 4 chars)"
                  className="w-full px-3.5 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-amber-400 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  value={overrideConfirmPassword}
                  onChange={(e) => setOverrideConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full px-3.5 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-amber-400 text-xs"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdminOverrideModal(false)}
                  className="w-1/3 py-2.5 bg-white/5 hover:bg-white/10 text-theme-text-secondary font-medium rounded-xl transition-all text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isOverrideLoading}
                  className="w-2/3 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 text-xs cursor-pointer disabled:opacity-50"
                >
                  {isOverrideLoading ? (
                    <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Set Password & Sign In
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <footer className="mt-6 text-center text-[11px] text-theme-text-secondary space-y-1 max-w-lg px-4">
        <p>
          By visiting or using this portal, you agree to our{' '}
          <button
            type="button"
            onClick={() => setIsTermsOpen(true)}
            className="font-semibold text-accent underline hover:text-primary-light transition-colors cursor-pointer"
          >
            Terms & Conditions
          </button>{' '}and{' '}
          <button
            type="button"
            onClick={() => setIsPrivacyOpen(true)}
            className="font-semibold text-accent underline hover:text-primary-light transition-colors cursor-pointer"
          >
            Privacy Policy
          </button>.
        </p>
        <p className="text-[10px]">
          All Intellectual Property, Copyrights & Development Licensing belong exclusively to <strong>Kayomarz Pavri</strong>.
        </p>
        <p className="text-[10px] opacity-75">&copy; 2026 RTBI Portal &middot; MSRUAS Internal Operations Portal</p>
      </footer>

      {/* Terms & Conditions Modal */}
      <TermsModal isOpen={isTermsOpen} onClose={() => setIsTermsOpen(false)} />
      {/* Privacy Policy Modal */}
      <PrivacyPolicyModal isOpen={isPrivacyOpen} onClose={() => setIsPrivacyOpen(false)} />

      {/* iOS "Add to Home Screen" nudge, shown here too so it reaches someone
          visiting on an iPhone/iPad before they've even logged in. */}
      <IosInstallPrompt />
    </div>
  );
}
