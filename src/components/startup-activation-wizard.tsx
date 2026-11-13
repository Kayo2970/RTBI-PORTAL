'use client';

import React, { useRef, useState } from 'react';
import {
  ShieldAlert, Lock, Eye, EyeOff, Phone, Cake, ImagePlus, X, ArrowLeft, ArrowRight, Check,
  Rocket, Building2, FileText, SlidersHorizontal, Globe, MapPin, Link2, AtSign, Camera, Sparkles,
} from 'lucide-react';
import {
  STARTUP_SECTORS, STARTUP_STAGES, STARTUP_TEAM_SIZES, MAX_STARTUP_LOGO_BYTES, STARTUP_LOGO_MIME_TYPES,
  type StartupProfileInput,
} from '@/lib/startup-profile';

export interface StartupActivationPayload {
  newPassword: string;
  phone: string;
  dateOfBirth?: string;
  startupProfile: StartupProfileInput;
}

interface Props {
  name: string;
  email: string;
  isSubmitting: boolean;
  submitError: string;
  onSubmit: (payload: StartupActivationPayload) => void;
}

const STEPS = [
  { key: 'account', label: 'Account', icon: Lock },
  { key: 'brand', label: 'Brand', icon: Building2 },
  { key: 'about', label: 'About', icon: FileText },
  { key: 'details', label: 'Details', icon: SlidersHorizontal },
  { key: 'review', label: 'Launch', icon: Rocket },
] as const;

const inputCls =
  'w-full py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-accent text-xs transition-all';
const labelCls = 'block font-semibold text-theme-text-secondary uppercase tracking-wider';
const hintCls = 'text-[11px] text-theme-text-secondary/70';

function Optional() {
  return <span className="normal-case font-medium text-theme-text-secondary/70"> (optional)</span>;
}

export function StartupActivationWizard({ name, email, isSubmitting, submitError, onSubmit }: Props) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');

  // Account
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');

  // Brand
  const [startupName, setStartupName] = useState('');
  const [tagline, setTagline] = useState('');
  const [logoData, setLogoData] = useState('');
  const [logoFileName, setLogoFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // About
  const [aboutUs, setAboutUs] = useState('');
  const [problem, setProblem] = useState('');
  const [solution, setSolution] = useState('');

  // Details
  const [sector, setSector] = useState('');
  const [stage, setStage] = useState('');
  const [foundedYear, setFoundedYear] = useState('');
  const [teamSize, setTeamSize] = useState('');
  const [location, setLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [twitter, setTwitter] = useState('');
  const [instagram, setInstagram] = useState('');

  const handleLogo = (file?: File) => {
    if (!file) return;
    if (!(STARTUP_LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
      setError('Logo must be a PNG, JPG or WebP image.');
      return;
    }
    if (file.size > MAX_STARTUP_LOGO_BYTES) {
      setError('Logo must be 2 MB or smaller.');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      setLogoData(String(reader.result));
      setLogoFileName(file.name);
    };
    reader.readAsDataURL(file);
  };

  /** Returns an error message for the given step, or '' if it's fine to move on. */
  const validate = (s: number): string => {
    if (s === 0) {
      if (newPassword.length < 4) return 'Password must be at least 4 characters.';
      if (newPassword !== confirmPassword) return 'Passwords do not match.';
      if (phone.trim().length < 7) return 'Enter a valid mobile number.';
    }
    if (s === 1 && !startupName.trim()) return 'Enter your startup name.';
    if (s === 2 && aboutUs.trim().length < 20) return 'Tell us a bit more in "About us" (at least 20 characters).';
    if (s === 3) {
      if (!sector) return 'Pick your sector.';
      if (!stage) return 'Pick your current stage.';
      if (foundedYear && !/^(19|20)\d{2}$/.test(foundedYear)) return 'Enter a valid founding year.';
      for (const [label, v] of [['Website', website], ['LinkedIn', linkedin], ['X / Twitter', twitter], ['Instagram', instagram]]) {
        if (v.trim() && !/^https?:\/\/\S+\.\S+/.test(v.trim())) return `${label} must be a full link starting with https://`;
      }
    }
    return '';
  };

  const next = () => {
    const msg = validate(step);
    if (msg) { setError(msg); return; }
    setError('');
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => { setError(''); setStep((s) => Math.max(s - 1, 0)); };

  const submit = () => {
    for (let s = 0; s < STEPS.length - 1; s++) {
      const msg = validate(s);
      if (msg) { setError(msg); setStep(s); return; }
    }
    const socials = {
      linkedin: linkedin.trim() || undefined,
      twitter: twitter.trim() || undefined,
      instagram: instagram.trim() || undefined,
    };
    onSubmit({
      newPassword,
      phone: phone.trim(),
      dateOfBirth: dateOfBirth || undefined,
      startupProfile: {
        startupName: startupName.trim(),
        tagline: tagline.trim() || undefined,
        sector,
        stage,
        foundedYear: foundedYear || undefined,
        teamSize: teamSize || undefined,
        location: location.trim() || undefined,
        website: website.trim() || undefined,
        aboutUs: aboutUs.trim(),
        problem: problem.trim() || undefined,
        solution: solution.trim() || undefined,
        socials: Object.values(socials).some(Boolean) ? socials : undefined,
        logoData: logoData || undefined,
        logoFileName: logoFileName || undefined,
      },
    });
  };

  const shownError = error || submitError;

  return (
    <div className="space-y-5 text-xs">
      <div className="flex items-center gap-2.5 p-3.5 bg-accent/10 border border-accent/20 rounded-2xl">
        <Sparkles className="h-4 w-4 text-accent shrink-0" />
        <div className="min-w-0">
          <p className="font-bold text-theme-text-primary truncate">Welcome, {name}!</p>
          <p className="text-[11px] text-theme-text-secondary truncate">{email} · let&apos;s build your startup profile</p>
        </div>
      </div>

      {/* Stepper */}
      <ol className="flex items-center justify-between gap-1" aria-label="Setup progress">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const done = i < step;
          const active = i === step;
          return (
            <li key={s.key} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center border transition-all ${
                  active ? 'bg-accent text-white border-accent shadow-md shadow-accent/30'
                    : done ? 'bg-accent/20 text-accent border-accent/40'
                    : 'bg-theme-background/40 text-theme-text-secondary border-theme-card-border'
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-3.5 w-3.5" />}
              </div>
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${active ? 'text-theme-text-primary' : 'text-theme-text-secondary'}`}>
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      {shownError && (
        <div role="alert" className="flex gap-3 p-3.5 bg-danger/10 border border-danger/25 rounded-2xl text-danger leading-relaxed">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{shownError}</span>
        </div>
      )}

      {/* Step 0 — Account */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className={labelCls}>Choose a Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
              <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 4 characters" className={`${inputCls} pl-10 pr-10`} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 p-0.5 rounded text-theme-text-secondary hover:text-theme-text-primary cursor-pointer"
                title={showPassword ? 'Hide password' : 'View password'}>
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Confirm Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
              <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password" className={`${inputCls} pl-10 pr-4`} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Founder Mobile Number</label>
            <div className="relative">
              <Phone className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 XXXXX XXXXX" className={`${inputCls} pl-10 pr-4`} />
            </div>
            <p className={hintCls}>Stored in the Members Directory so the Centre can reach you.</p>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Date of Birth<Optional /></label>
            <div className="relative">
              <Cake className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
              <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)}
                max={new Date().toISOString().split('T')[0]} className={`${inputCls} pl-10 pr-4`} />
            </div>
          </div>
        </div>
      )}

      {/* Step 1 — Brand */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className={labelCls}>Startup Logo<Optional /></label>
            <div className="flex items-center gap-4">
              <div className="h-24 w-24 shrink-0 rounded-2xl border border-dashed border-theme-card-border bg-theme-background/40 flex items-center justify-center overflow-hidden">
                {logoData ? (
                  <img src={logoData} alt="Logo preview" className="h-full w-full object-contain p-1.5" />
                ) : (
                  <ImagePlus className="h-7 w-7 text-theme-text-secondary/60" />
                )}
              </div>
              <div className="space-y-2">
                <input ref={fileRef} type="file" accept={STARTUP_LOGO_MIME_TYPES.join(',')} className="hidden"
                  onChange={(e) => { handleLogo(e.target.files?.[0]); e.target.value = ''; }} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/15 rounded-xl font-semibold text-theme-text-primary cursor-pointer transition-all">
                    {logoData ? 'Replace' : 'Upload logo'}
                  </button>
                  {logoData && (
                    <button type="button" onClick={() => { setLogoData(''); setLogoFileName(''); }}
                      className="px-3 py-2 rounded-xl text-danger hover:bg-danger/10 font-semibold flex items-center gap-1 cursor-pointer transition-all">
                      <X className="h-3.5 w-3.5" /> Remove
                    </button>
                  )}
                </div>
                <p className={hintCls}>PNG, JPG or WebP · max 2 MB · square works best.</p>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Startup Name</label>
            <input value={startupName} onChange={(e) => setStartupName(e.target.value)} maxLength={120}
              placeholder="e.g. Acme Robotics" className={`${inputCls} px-4`} />
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Tagline<Optional /></label>
            <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={140}
              placeholder="One line on what you do" className={`${inputCls} px-4`} />
            <p className={`${hintCls} text-right`}>{tagline.length}/140</p>
          </div>
        </div>
      )}

      {/* Step 2 — About */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className={labelCls}>About Us</label>
            <textarea value={aboutUs} onChange={(e) => setAboutUs(e.target.value)} rows={5} maxLength={2000}
              placeholder="Who you are, what you're building and why it matters." className={`${inputCls} px-4 resize-none`} />
            <p className={`${hintCls} text-right`}>{aboutUs.length}/2000</p>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>The Problem<Optional /></label>
            <textarea value={problem} onChange={(e) => setProblem(e.target.value)} rows={3} maxLength={1000}
              placeholder="What pain are you solving, and for whom?" className={`${inputCls} px-4 resize-none`} />
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Your Solution<Optional /></label>
            <textarea value={solution} onChange={(e) => setSolution(e.target.value)} rows={3} maxLength={1000}
              placeholder="How does your product or service solve it?" className={`${inputCls} px-4 resize-none`} />
          </div>
        </div>
      )}

      {/* Step 3 — Details */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className={labelCls}>Sector</label>
              <select value={sector} onChange={(e) => setSector(e.target.value)} className={`${inputCls} px-3`}>
                <option value="">Select sector…</option>
                {STARTUP_SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Stage</label>
              <select value={stage} onChange={(e) => setStage(e.target.value)} className={`${inputCls} px-3`}>
                <option value="">Select stage…</option>
                {STARTUP_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Founded<Optional /></label>
              <input value={foundedYear} onChange={(e) => setFoundedYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric" placeholder="YYYY" className={`${inputCls} px-4`} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Team Size<Optional /></label>
              <select value={teamSize} onChange={(e) => setTeamSize(e.target.value)} className={`${inputCls} px-3`}>
                <option value="">Select…</option>
                {STARTUP_TEAM_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Location<Optional /></label>
            <div className="relative">
              <MapPin className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, State" className={`${inputCls} pl-10 pr-4`} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Website<Optional /></label>
            <div className="relative">
              <Globe className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
              <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://yourstartup.com" className={`${inputCls} pl-10 pr-4`} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Social Links<Optional /></label>
            <div className="space-y-2">
              {([
                [Link2, linkedin, setLinkedin, 'https://linkedin.com/company/…'],
                [AtSign, twitter, setTwitter, 'https://x.com/…'],
                [Camera, instagram, setInstagram, 'https://instagram.com/…'],
              ] as const).map(([Icon, value, setter, ph], i) => (
                <div key={i} className="relative">
                  <Icon className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
                  <input type="url" value={value} onChange={(e) => setter(e.target.value)} placeholder={ph} className={`${inputCls} pl-10 pr-4`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 4 — Review */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-theme-card-border bg-theme-background/40 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-14 w-14 shrink-0 rounded-xl bg-white/5 border border-theme-card-border flex items-center justify-center overflow-hidden">
                {logoData ? <img src={logoData} alt="" className="h-full w-full object-contain p-1" /> : <Building2 className="h-6 w-6 text-theme-text-secondary/60" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-theme-text-primary truncate">{startupName}</p>
                {tagline && <p className="text-[11px] text-theme-text-secondary truncate">{tagline}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[sector, stage, teamSize && `Team ${teamSize}`, foundedYear && `Since ${foundedYear}`, location].filter(Boolean).map((chip) => (
                <span key={String(chip)} className="px-2 py-0.5 rounded-full bg-accent/15 border border-accent/25 text-accent text-[10px] font-bold">{chip}</span>
              ))}
            </div>
            <p className="text-theme-text-secondary leading-relaxed whitespace-pre-line line-clamp-6">{aboutUs}</p>
          </div>
          <p className={hintCls}>You can go back to any step to change something. Submitting activates your account and publishes this profile to the Centre.</p>
        </div>
      )}

      {/* Nav */}
      <div className="flex items-center gap-3 pt-1">
        {step > 0 && (
          <button type="button" onClick={back} disabled={isSubmitting}
            className="px-4 py-3 bg-white/10 hover:bg-white/20 border border-white/15 text-theme-text-primary font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-50">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={next}
            className="flex-1 py-3 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl shadow-md shadow-accent/20 flex items-center justify-center gap-2 cursor-pointer transition-all">
            Continue <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={isSubmitting}
            className="flex-1 py-3 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl shadow-md shadow-accent/20 flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {isSubmitting ? <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Rocket className="h-4 w-4" /> Launch My Profile</>}
          </button>
        )}
      </div>
    </div>
  );
}
