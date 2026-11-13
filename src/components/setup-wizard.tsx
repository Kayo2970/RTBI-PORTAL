'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  KeyRound,
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  AlertTriangle,
  Database,
  CheckCircle2,
} from 'lucide-react';

interface SetupWizardProps {
  initialSuggestedKey?: string;
  isKeyConfigured?: boolean;
  onComplete?: (user: any) => void;
}

export function SetupWizard({
  initialSuggestedKey = '',
  isKeyConfigured = false,
  onComplete,
}: SetupWizardProps) {
  const router = useRouter();

  // Wizard Step: 1 = Super User Account, 2 = Database Encryption Key
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1: Super User fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Step 2: Encryption Key fields
  const [keyMode, setKeyMode] = useState<'generate' | 'custom'>('generate');
  const [generatedKey, setGeneratedKey] = useState(initialSuggestedKey || '');
  const [customKey, setCustomKey] = useState('');
  const [hasCopiedKey, setHasCopiedKey] = useState(false);
  const [keyBackedUpConfirmed, setKeyBackedUpConfirmed] = useState(false);

  // Status & loading
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Generate fallback key client-side if needed
  useEffect(() => {
    if (!generatedKey) {
      const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      setGeneratedKey(randomHex);
    }
  }, [generatedKey]);

  const handleRegenerateKey = () => {
    const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    setGeneratedKey(randomHex);
    setHasCopiedKey(false);
  };

  const handleCopyKey = () => {
    const activeKey = keyMode === 'generate' ? generatedKey : customKey;
    if (activeKey) {
      navigator.clipboard.writeText(activeKey);
      setHasCopiedKey(true);
      setTimeout(() => setHasCopiedKey(false), 2500);
    }
  };

  const handleStep1Next = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Please enter your full name.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    if (password.length < 8) {
      setError('Super User password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setStep(2);
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const activeKey = keyMode === 'generate' ? generatedKey : customKey.trim();

    if (!isKeyConfigured && !activeKey) {
      setError('Please provide or generate a data encryption key.');
      return;
    }

    if (!isKeyConfigured && !keyBackedUpConfirmed) {
      setError('Please confirm that you have saved a copy of the encryption key.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          encryptionKey: activeKey,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to complete setup.');
        setIsLoading(false);
        return;
      }

      setIsSuccess(true);
      if (data.user) {
        localStorage.setItem('user', JSON.stringify(data.user));
      }

      setTimeout(() => {
        if (onComplete) {
          onComplete(data.user);
        } else {
          router.push('/dashboard/home');
        }
      }, 1500);
    } catch {
      setError('Network error: Unable to contact the setup server. Please try again.');
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="glass-panel rounded-3xl p-8 flex flex-col items-center justify-center text-center space-y-5 border border-emerald-500/30 shadow-2xl animate-in zoom-in-95 duration-300">
        <div className="h-16 w-16 bg-emerald-500/20 text-emerald-400 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <CheckCircle2 className="h-10 w-10 animate-bounce" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-theme-text-primary">System Initialized Successfully!</h2>
          <p className="text-xs text-theme-text-secondary mt-1">
            Super User account and AES-256 database encryption configured. Launching RTBI Portal...
          </p>
        </div>
        <div className="w-48 h-1.5 bg-theme-background/60 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 animate-pulse rounded-full w-full"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-3xl p-6 md:p-8 flex flex-col justify-between space-y-6 relative overflow-hidden transition-all duration-300 border border-white/20 shadow-2xl">
      {/* Header with Step Tracker */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-accent/20 rounded-xl text-accent">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20">
                Fresh Install • Step {step} of 2
              </span>
              <h2 className="text-lg font-black tracking-tight text-theme-text-primary mt-1">
                {step === 1 ? 'Super User Setup' : 'Database Encryption Key'}
              </h2>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="grid grid-cols-2 gap-2">
          <div className={`h-1.5 rounded-full transition-all duration-300 ${step >= 1 ? 'bg-accent shadow-sm shadow-accent/50' : 'bg-white/10'}`} />
          <div className={`h-1.5 rounded-full transition-all duration-300 ${step === 2 ? 'bg-accent shadow-sm shadow-accent/50' : 'bg-white/10'}`} />
        </div>

        <p className="text-xs text-theme-text-secondary leading-relaxed">
          {step === 1
            ? 'Create the primary root administrator account. This will be the only account initially; you can add all other faculty and members from the Directory once logged in.'
            : 'Configure the AES-256-GCM encryption key used to encrypt all local database files and backups on disk.'}
        </p>
      </div>

      {/* Error Alert Box */}
      {error && (
        <div className="flex items-start gap-2.5 p-3.5 bg-danger/15 border border-danger/30 rounded-2xl text-danger text-xs leading-relaxed animate-in fade-in duration-200">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Step 1: Super User Account Form */}
      {step === 1 && (
        <form onSubmit={handleStep1Next} className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
              Super User Full Name
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dr. Administrator / Kayomarz Pavri"
                className="w-full pl-10 pr-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-accent text-xs transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
              Super User Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full pl-10 pr-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-accent text-xs transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
              Password (Min 8 Characters)
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
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
                type={showConfirmPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-10 pr-10 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-accent text-xs transition-all"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-2.5 p-0.5 rounded text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
                title={showConfirmPassword ? 'Hide password' : 'View password'}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all duration-200 shadow-md shadow-accent/25 flex items-center justify-center gap-2 cursor-pointer mt-2"
          >
            <span>Proceed to Step 2: Database Security</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      )}

      {/* Step 2: Database Encryption Key Setup Form */}
      {step === 2 && (
        <form onSubmit={handleFinalSubmit} className="space-y-4 text-xs">
          {isKeyConfigured ? (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl flex items-start gap-3 text-emerald-400">
              <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-xs text-theme-text-primary">Environment Key Detected</p>
                <p className="text-[11px] text-theme-text-secondary leading-relaxed">
                  A <code className="bg-black/30 px-1 py-0.5 rounded text-emerald-400">DATA_ENCRYPTION_KEY</code> is
                  already set in your server environment or <code className="bg-black/30 px-1 py-0.5 rounded">.env</code> file.
                  Your database collections will be encrypted with this existing key.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              {/* Option Selector */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setKeyMode('generate')}
                  className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                    keyMode === 'generate'
                      ? 'border-accent bg-accent/15 text-theme-text-primary font-semibold shadow-sm'
                      : 'border-theme-card-border bg-theme-background/30 text-theme-text-secondary hover:border-white/20'
                  }`}
                >
                  <KeyRound className="h-4 w-4 text-accent shrink-0" />
                  <span className="text-[11px]">Generate 256-bit Key</span>
                </button>
                <button
                  type="button"
                  onClick={() => setKeyMode('custom')}
                  className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                    keyMode === 'custom'
                      ? 'border-accent bg-accent/15 text-theme-text-primary font-semibold shadow-sm'
                      : 'border-theme-card-border bg-theme-background/30 text-theme-text-secondary hover:border-white/20'
                  }`}
                >
                  <Database className="h-4 w-4 text-accent shrink-0" />
                  <span className="text-[11px]">Custom Passphrase</span>
                </button>
              </div>

              {/* Key Display / Input */}
              {keyMode === 'generate' ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-theme-text-secondary font-medium">Generated Master Key (Hex):</span>
                    <button
                      type="button"
                      onClick={handleRegenerateKey}
                      className="text-accent hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Regenerate
                    </button>
                  </div>
                  <div className="relative">
                    <div className="p-3 bg-black/40 border border-theme-card-border rounded-xl font-mono text-[11px] text-emerald-400 break-all select-all pr-20">
                      {generatedKey}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyKey}
                      className="absolute right-2 top-2 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-theme-text-primary flex items-center gap-1.5 text-[11px] font-medium transition-all cursor-pointer"
                    >
                      {hasCopiedKey ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-emerald-400 font-semibold">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="block font-semibold text-theme-text-secondary uppercase tracking-wider">
                    Custom Secret Key / Passphrase
                  </label>
                  <input
                    type="text"
                    required
                    value={customKey}
                    onChange={(e) => setCustomKey(e.target.value)}
                    placeholder="Enter your custom encryption passphrase"
                    className="w-full px-3.5 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl font-mono text-xs text-theme-text-primary focus:outline-none focus:border-accent transition-all"
                  />
                </div>
              )}

              {/* Warning & Confirmation Checkbox */}
              <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl space-y-2 text-amber-300">
                <div className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                  <p className="text-[11px] leading-relaxed">
                    <strong>Save this key now!</strong> This key will be saved to your server's <code className="bg-black/40 px-1 py-0.2 rounded font-mono text-white">.env</code>.
                    If the disk is lost or migrated, this key is the only way to decrypt your database.
                  </p>
                </div>
                <label className="flex items-center gap-2 pt-1 border-t border-amber-500/20 text-[11px] cursor-pointer text-theme-text-primary select-none">
                  <input
                    type="checkbox"
                    checked={keyBackedUpConfirmed}
                    onChange={(e) => setKeyBackedUpConfirmed(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-amber-400 accent-accent cursor-pointer"
                  />
                  <span>I have securely copied and saved this encryption key</span>
                </label>
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-4 py-3 bg-white/10 hover:bg-white/15 text-theme-text-primary font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back</span>
            </button>
            <button
              type="submit"
              disabled={isLoading || (!isKeyConfigured && !keyBackedUpConfirmed)}
              className="flex-1 py-3 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all duration-200 shadow-md shadow-accent/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  <span>Complete Setup & Launch</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
