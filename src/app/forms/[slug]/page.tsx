'use client';

import React, { useState, useEffect, useRef, useCallback, use } from 'react';
import { CheckCircle2, ChevronLeft, Send, Sparkles, AlertTriangle, ShieldCheck, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import Link from 'next/link';
import { getForms, getEvents, addSubmission, PublicFormItem, FormEventInfo, resolveFieldDefault, hasLockedDefault, formatEventDateRange, isFormClosed } from '@/lib/local-data';
import { TermsModal } from '@/components/terms-modal';
import { PrivacyPolicyModal } from '@/components/privacy-policy-modal';
import { GhostFibers } from '@/components/ui/ghost-fibers';
import { DEFAULT_HEADER_FRAMING, headerImageStyle } from '@/components/form-header-framing';

export default function PublicFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = use(params);
  const slug = resolvedParams.slug;

  const [form, setForm] = useState<PublicFormItem | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  // Fields whose pre-filled answer is locked (shown, but the respondent can't change it)
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());
  const [honeypot, setHoneypot] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [closed, setClosed] = useState(false);
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
  // Zoom for the form card: 1 = normal, "Fit" scales it up/down so the whole card fills the screen
  const [zoom, setZoom] = useState(1);
  const cardRef = useRef<HTMLDivElement>(null);
  const clampZoom = (z: number) => Math.min(2.5, Math.max(0.5, Math.round(z * 100) / 100));
  const fitToScreen = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    // offsetWidth/Height are unaffected by CSS zoom on the element itself, so this is the natural size
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    setZoom(clampZoom(Math.min((window.innerWidth - 32) / w, (window.innerHeight - 32) / h)));
  }, []);
  const formOpenedAt = React.useRef(Date.now());

  // Public form links are opened standalone (shared via QR code, email, etc.)
  // outside the dashboard's own theme toggle, so they'd otherwise inherit
  // whatever `.dark` state the browser happened to be left in (or none at
  // all) — force the same dynamic dark glassmorphic background the rest of
  // the app uses, since dark is the only theme this page is designed for.
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applyForm = (matchedForm: PublicFormItem | undefined) => {
      if (cancelled) return;
      // A form that's never been approved (still pending, or was rejected)
      // has no live public link yet — treat it exactly like a missing slug
      // rather than exposing an unreviewed form to respondents.
      if (!matchedForm || matchedForm.approvalStatus === 'pending_create' || matchedForm.approvalStatus === 'rejected') {
        setNotFound(true);
        setLoading(false);
        return;
      }
      // "Type of Event" used to be a tick-several list; forms built from the Feedback template back then still
      // store it that way, so present it as the single choice it now is.
      matchedForm = {
        ...matchedForm,
        fields: matchedForm.fields.map(f => (f.id === 'f_event_type' && f.type === 'multiselect' ? { ...f, type: 'select' as const } : f)),
      };
      setForm(matchedForm);
      // Past its close time: the API's own (server-clock) `closed` flag wins; the local check covers the staff-preview cache.
      setClosed(!!(matchedForm as any).closed || isFormClosed(matchedForm));
      // Linked-event details for "default = event name / date / venue": live from the public API when we have it,
      // else (staff previewing from the local cache) from the locally cached event.
      let eventInfo: FormEventInfo | undefined = (matchedForm as any).eventInfo;
      if (!eventInfo && matchedForm.eventId) {
        const ev = getEvents().find(e => e.id === matchedForm.eventId);
        if (ev) eventInfo = { name: ev.title, date: ev.datesTBD ? undefined : formatEventDateRange(ev), venue: ev.location || undefined };
      }
      if (!eventInfo && matchedForm.eventName) eventInfo = { name: matchedForm.eventName };
      const initialData: Record<string, any> = {};
      const locked = new Set<string>();
      matchedForm.fields.forEach(f => {
        const def = resolveFieldDefault(f, eventInfo);
        if (f.type === 'multiselect') initialData[f.id] = Array.isArray(def) ? def : [];
        else if (f.type === 'checkbox') initialData[f.id] = def === true;
        else initialData[f.id] = def === undefined || def === null || Array.isArray(def) || typeof def === 'boolean' ? '' : String(def);
        // Only lock when there is actually something filled in, so nobody gets stuck on an empty locked field
        const v = initialData[f.id];
        if (hasLockedDefault(f) && (f.type === 'checkbox' ? v === true : Array.isArray(v) ? v.length > 0 : v !== '')) locked.add(f.id);
      });
      setFormData(initialData);
      setLockedIds(locked);
      setLoading(false);
    };

    const localMatch = getForms().find(f => f.slug.toLowerCase() === slug.toLowerCase());
    if (localMatch) {
      // Already cached in this browser (e.g. staff previewing right after
      // building it) — show it immediately, no need to wait on the network.
      applyForm(localMatch);
      return;
    }

    // A real respondent filling this out from a shared/QR link has never
    // logged into the dashboard in this browser, so localStorage starts
    // completely empty and there's no session to call the member-only
    // /api/data poll with (syncWithServer() 401s for them). Resolve the slug
    // through the dedicated public, unauthenticated endpoint instead — same
    // approach POST /api/submissions already uses for the write side of this
    // exact flow.
    fetch(`/api/public-forms/${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(publicForm => {
        if (cancelled) return;
        applyForm(publicForm || undefined);
      })
      .catch(() => {
        if (cancelled) return;
        applyForm(undefined);
      });

    return () => { cancelled = true; };
  }, [slug]);

  const handleInputChange = (fieldId: string, value: any) => {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
  };

  const handleMultiselectToggle = (fieldId: string, option: string) => {
    setFormData(prev => {
      const current: string[] = Array.isArray(prev[fieldId]) ? prev[fieldId] : [];
      const next = current.includes(option)
        ? current.filter(o => o !== option)
        : [...current, option];
      return { ...prev, [fieldId]: next };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    // The page may have been left open past the deadline.
    if (isFormClosed(form)) {
      setClosed(true);
      return;
    }

    // Honeypot spam protection: a real human never fills or fires this field
    // in under a second, so only treat it as a bot when both signals agree —
    // this field's name deliberately avoids "url"/"website"/etc. substrings
    // that browser/password-manager autofill heuristics key off of, but the
    // time check keeps things safe even if an autofill engine still catches it.
    const filledTooFast = Date.now() - formOpenedAt.current < 1500;
    if (honeypot.trim() !== '' && filledTooFast) {
      setIsSubmitted(true);
      return;
    }

    setSubmitError(false);
    setIsSubmitting(true);
    const { synced } = addSubmission({
      formId: form.id,
      slug: form.slug,
      data: formData,
    });

    const ok = await synced;
    setIsSubmitting(false);
    if (!ok) {
      // The server refuses responses once a form has closed — check whether that's why, so the respondent sees
      // the closed message rather than a generic "try again" error.
      try {
        const res = await fetch(`/api/public-forms/${encodeURIComponent(form.slug)}`, { cache: 'no-store' });
        if (res.ok && (await res.json()).closed) {
          setClosed(true);
          return;
        }
      } catch { /* fall through to the generic error */ }
      setSubmitError(true);
      return;
    }
    setIsSubmitted(true);
  };

  const backgroundShader = form?.backgroundImageUrl ? (
    // Custom background picture for this form only; a light scrim keeps the frosted card readable
    <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {/* scale-110 hides the soft edge a CSS blur leaves around the image */}
      <img src={form.backgroundImageUrl} alt="" className="h-full w-full object-cover scale-110" style={{ filter: `blur(${form.backgroundBlur ?? 0}px)` }} />
      <div className="absolute inset-0 bg-black" style={{ opacity: (form.backgroundDim ?? 10) / 100 }} />
    </div>
  ) : (
    <div className="fixed inset-0 pointer-events-none -z-10 opacity-75 dark:opacity-90 overflow-hidden">
      {/* Colourful blobs: the frosted-glass card blurs these so the page reads as vivid but soft */}
      <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-fuchsia-500/60 blur-3xl" />
      <div className="absolute top-1/3 -right-24 h-[28rem] w-[28rem] rounded-full bg-cyan-400/50 blur-3xl" />
      <div className="absolute -bottom-24 left-1/4 h-96 w-96 rounded-full bg-amber-400/50 blur-3xl" />
      <div className="absolute bottom-1/4 -left-16 h-72 w-72 rounded-full bg-emerald-400/40 blur-3xl" />
      <GhostFibers
        lineColor="#361C6A"
        glowColor="#03d8fc"
        speed={0.2}
        scale={2}
        rotation={-24}
        rotationSpeed={0.25}
        layers={4}
        waveAmplitude={0.015}
        waveFrequency={3}
        waveSpeed={0.15}
        layerSpeed={0.08}
        twist={0.1}
        twistFrequency={5}
        twistSpeed={1.2}
        lineFrequency={5}
        lineSpacing={2}
        lineSharpness={16}
        glowFalloff={10}
        glowIntensity={1.6}
        brightness={2}
        blueBoost={1.25}
        vignette={0.8}
        grain={0.05}
        dpr={1}
      />
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-space-theme flex flex-col items-center justify-center p-4 relative z-0 overflow-hidden select-none">
        {backgroundShader}
        <div className="glass-panel rounded-2xl px-6 py-4 flex items-center gap-3 border border-white/15 shadow-2xl backdrop-blur-xl">
          <div className="h-4 w-4 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs font-semibold text-theme-text-primary">Loading form details...</span>
        </div>
      </div>
    );
  }

  if (closed) {
    return (
      <div className="min-h-screen bg-space-theme text-theme-text-primary flex flex-col items-center justify-center p-4 relative z-0 overflow-hidden select-none">
        {backgroundShader}
        <div className="glass-panel w-full max-w-md rounded-3xl p-8 flex flex-col items-center text-center space-y-5 border border-white/20 dark:border-white/15 shadow-2xl backdrop-blur-2xl bg-theme-card/90">
          <div className="h-14 w-14 bg-amber-500/15 rounded-2xl flex items-center justify-center border border-amber-500/30 text-amber-400">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <div className="space-y-1.5">
            {form?.title && <p className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary">{form.title}</p>}
            <h1 className="text-lg font-bold text-theme-text-primary">Form Closed</h1>
            <p className="text-xs text-theme-text-secondary leading-relaxed">
              Sorry, this form is currently closed. Please contact the administrator.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-space-theme text-theme-text-primary flex flex-col items-center justify-center p-4 relative z-0 overflow-hidden select-none">
        {backgroundShader}
        <div className="glass-panel w-full max-w-md rounded-3xl p-8 flex flex-col items-center text-center space-y-5 border border-white/20 dark:border-white/15 shadow-2xl backdrop-blur-2xl bg-theme-card/90">
          <div className="h-14 w-14 bg-amber-500/15 rounded-2xl flex items-center justify-center border border-amber-500/30 text-amber-400">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold text-theme-text-primary">Form Not Found</h1>
            <p className="text-xs text-theme-text-secondary leading-relaxed">
              The public form at <code className="text-accent font-mono">/forms/{slug}</code> does not exist, has expired, or the link has changed.
            </p>
          </div>
          <Link
            href="/"
            className="px-4 py-2 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-accent/20 cursor-pointer"
          >
            Return to Portal Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-space-theme text-theme-text-primary flex flex-col items-center justify-center p-4 py-12 relative z-0 overflow-hidden select-none">
      {backgroundShader}
      
      {isSubmitted ? (
        // Submission Success View
        <div className="glass-panel w-full max-w-md rounded-3xl p-8 flex flex-col items-center text-center space-y-6 border border-emerald-500/30 shadow-2xl backdrop-blur-2xl bg-theme-card/90 animate-in zoom-in-95 duration-300">
          <div className="h-16 w-16 bg-emerald-500/15 rounded-full flex items-center justify-center border border-emerald-500/30">
            <CheckCircle2 className="h-9 w-9 text-emerald-400" />
          </div>
          
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-theme-text-primary">Response Recorded!</h1>
            <p className="text-xs text-theme-text-secondary leading-relaxed">
              Thank you for your submission. Your details have been securely recorded for <strong className="text-theme-text-primary">{form?.title}</strong>.
            </p>
          </div>

          <div className="border-t border-theme-border/40 pt-4 w-full text-center">
            <Link 
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline font-semibold"
            >
              <ChevronLeft className="h-4 w-4" />
              Return to MSRUAS LEADS
            </Link>
          </div>
        </div>
      ) : (
        // Public Form Fill View (Clean light/dark responsive card with GhostFibers background)
        <div
          ref={cardRef}
          style={{ zoom } as React.CSSProperties}
          className="glass-panel w-full max-w-xl rounded-3xl p-6 md:p-8 flex flex-col space-y-6 relative overflow-hidden border border-white/30 shadow-2xl backdrop-blur-2xl bg-white/25 dark:bg-white/10"
        >
          
          {/* Top Banner Accent */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#001f53] via-accent to-[#03d8fc]"></div>

          {form?.headerImageUrl && (
            // Full-bleed banner: negative margins cancel the card padding; overflow-hidden crops the zoomed picture
            <div
              className="-mx-6 md:-mx-8 -mt-6 md:-mt-8 !mb-0 w-[calc(100%+3rem)] md:w-[calc(100%+4rem)] max-w-none overflow-hidden"
              style={{ height: form.headerHeight ?? DEFAULT_HEADER_FRAMING.height }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={form.headerImageUrl}
                alt=""
                className="h-full w-full object-cover"
                style={headerImageStyle({
                  posX: form.headerPosX ?? DEFAULT_HEADER_FRAMING.posX,
                  posY: form.headerPosY ?? DEFAULT_HEADER_FRAMING.posY,
                  zoom: form.headerZoom ?? DEFAULT_HEADER_FRAMING.zoom,
                  height: form.headerHeight ?? DEFAULT_HEADER_FRAMING.height,
                })}
              />
            </div>
          )}

          {/* Form Header */}
          <div className="flex flex-col items-center text-center space-y-2 pt-1">
            {form?.headerText && (
              <p className="w-full text-[11px] font-bold uppercase tracking-widest text-accent border-b border-theme-border/40 pb-2">{form.headerText}</p>
            )}
            <div className="h-11 w-11 bg-accent/15 border border-accent/30 rounded-2xl flex items-center justify-center shadow-lg text-accent">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-theme-text-primary tracking-tight leading-tight">{form?.title}</h1>
              <p className="text-xs text-theme-text-secondary mt-1">{form?.description || 'Please complete the requested information below.'}</p>
              {form?.eventName && (
                <p className="text-xs text-accent font-semibold mt-1 flex items-center justify-center gap-1">
                  <span>For event:</span>
                  <span className="underline">{form.eventName}</span>
                </p>
              )}
            </div>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSubmit} className="space-y-4 pt-1 text-xs">
            
            {/* Honeypot field (hidden from human users for spam bot mitigation).
                Deliberately avoids "url"/"website"/"email"/etc. in its name —
                those substrings make browser & password-manager autofill
                heuristics blind-fill this field for real human respondents,
                which silently drops their submission (it looked like a bot).
                Positioned off-screen rather than display:none, since some
                autofill engines still populate display:none inputs. */}
            <input
              type="text"
              name="hp_field_xk92"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}
              aria-hidden="true"
            />

            {form?.fields.map((field) => {
              const locked = lockedIds.has(field.id);
              const lockedCls = locked ? ' opacity-80 cursor-not-allowed' : '';
              return (
              <div key={field.id} className="space-y-1.5">
                <label className="block font-semibold text-theme-text-primary">
                  {field.label} {field.required && <span className="text-danger">*</span>}
                  {locked && <span className="ml-1.5 text-[10px] font-medium text-theme-text-secondary">🔒 pre-filled</span>}
                </label>

                {field.type === 'scale' ? (
                  <div className={`space-y-1${lockedCls}`}>
                    <div className="flex items-center gap-2" role="radiogroup" aria-label={field.label}>
                      {[1, 2, 3, 4, 5].map(n => (
                        <label
                          key={n}
                          className={`flex-1 flex items-center justify-center py-3 rounded-xl border cursor-pointer text-sm font-bold transition-all shadow-sm ${
                            Number(formData[field.id]) === n
                              ? 'bg-accent border-accent text-white shadow-accent/30'
                              : 'bg-theme-background/60 border-theme-border/60 text-theme-text-secondary hover:border-accent/60 hover:text-theme-text-primary'
                          }`}
                        >
                          <input
                            type="radio"
                            name={field.id}
                            value={n}
                            required={field.required}
                            checked={Number(formData[field.id]) === n}
                            disabled={locked}
                            onChange={() => handleInputChange(field.id, n)}
                            className="sr-only"
                          />
                          {n}
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-theme-text-secondary px-0.5">
                      <span>1 = Low</span>
                      <span>5 = High</span>
                    </div>
                  </div>
                ) : field.type === 'textarea' ? (
                  <textarea
                    required={field.required}
                    value={formData[field.id] || ''}
                    onChange={(e) => handleInputChange(field.id, e.target.value)}
                    rows={3}
                    readOnly={locked}
                    placeholder="Enter your response..."
                    className={`w-full px-4 py-3 bg-theme-background/60 border border-theme-border/60 rounded-xl text-theme-text-primary placeholder:text-theme-text-secondary/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all text-xs${lockedCls}`}
                  />
                ) : field.type === 'select' && field.options ? (
                  <select
                    required={field.required}
                    value={formData[field.id] || ''}
                    disabled={locked}
                    onChange={(e) => handleInputChange(field.id, e.target.value)}
                    className={`w-full px-4 py-3 bg-theme-background/60 border border-theme-border/60 rounded-xl text-theme-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all text-xs${lockedCls}`}
                  >
                    <option value="">Select an option...</option>
                    {field.options.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : field.type === 'checkbox' ? (
                  <label className="flex items-center gap-2.5 cursor-pointer text-theme-text-primary">
                    <input
                      type="checkbox"
                      checked={Boolean(formData[field.id])}
                      disabled={locked}
                      onChange={(e) => handleInputChange(field.id, e.target.checked)}
                      className="h-4 w-4 rounded border-theme-border/80 bg-theme-background text-accent focus:ring-accent"
                    />
                    <span className="text-xs font-medium">Yes</span>
                  </label>
                ) : field.type === 'multiselect' && field.options ? (
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label={field.label}>
                    {field.options.map(opt => {
                      const selected: string[] = Array.isArray(formData[field.id]) ? formData[field.id] : [];
                      const checked = selected.includes(opt);
                      return (
                        <label
                          key={opt}
                          className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border cursor-pointer text-xs font-medium transition-all ${
                            checked
                              ? 'bg-accent/20 border-accent text-theme-text-primary shadow-sm'
                              : 'bg-theme-background/60 border-theme-border/60 text-theme-text-secondary hover:border-accent/60'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={locked}
                            onChange={() => handleMultiselectToggle(field.id, opt)}
                            className="h-4 w-4 rounded border-theme-border/80 bg-theme-background text-accent focus:ring-accent"
                          />
                          {opt}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <input
                    type={field.type === 'email' ? 'email' : field.type === 'number' ? 'number' : 'text'}
                    required={field.required}
                    value={formData[field.id] || ''}
                    readOnly={locked}
                    onChange={(e) => handleInputChange(field.id, e.target.value)}
                    placeholder={`Enter ${field.label.toLowerCase()}...`}
                    className={`w-full px-4 py-3 bg-theme-background/60 border border-theme-border/60 rounded-xl text-theme-text-primary placeholder:text-theme-text-secondary/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all text-xs${lockedCls}`}
                  />
                )}
              </div>
              );
            })}

            {submitError && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-danger/40 bg-danger/10 text-danger text-xs">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>We couldn&apos;t confirm your submission reached the server. Please try again.</span>
              </div>
            )}

            <div className="pt-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 bg-accent hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-xl shadow-accent/25 flex items-center justify-center gap-2.5 cursor-pointer text-xs uppercase tracking-wider"
              >
                <Send className="h-4 w-4" />
                {isSubmitting ? 'Submitting...' : 'Submit Registration'}
              </button>
            </div>

            <div className="flex items-center justify-center gap-1.5 text-[10px] text-theme-text-secondary pt-2">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Encrypted & Verified &bull; LEADS Next Gen MSRUAS</span>
            </div>
          </form>
        </div>
      )}

      {!isSubmitted && (
        <div className="fixed bottom-4 right-4 z-20 flex items-center gap-1 p-1 rounded-xl border border-white/30 bg-white/25 dark:bg-white/10 backdrop-blur-xl shadow-lg">
          <button type="button" onClick={() => setZoom((z) => clampZoom(z - 0.1))} title="Zoom out" className="p-2 rounded-lg text-theme-text-primary hover:bg-white/30 cursor-pointer"><ZoomOut className="h-4 w-4" /></button>
          <button type="button" onClick={fitToScreen} title="Zoom to fit the screen" className="flex items-center gap-1 px-2 py-2 rounded-lg text-[11px] font-semibold text-theme-text-primary hover:bg-white/30 cursor-pointer"><Maximize className="h-4 w-4" />Fit</button>
          <button type="button" onClick={() => setZoom((z) => clampZoom(z + 0.1))} title="Zoom in" className="p-2 rounded-lg text-theme-text-primary hover:bg-white/30 cursor-pointer"><ZoomIn className="h-4 w-4" /></button>
          <button type="button" onClick={() => setZoom(1)} title="Reset zoom" className="px-2 py-2 rounded-lg text-[11px] font-semibold text-theme-text-secondary hover:bg-white/30 cursor-pointer">{Math.round(zoom * 100)}%</button>
        </div>
      )}

      {/* Footer Info */}
      <footer className="mt-8 text-center text-[11px] text-theme-text-secondary space-y-1 max-w-lg px-4 pb-6">
        <p>
          By visiting or using this portal, you agree to our{' '}
          <button
            type="button"
            onClick={() => setIsTermsOpen(true)}
            className="font-semibold text-accent underline hover:text-accent/80 transition-colors cursor-pointer"
          >
            Terms & Conditions
          </button>{' '}and{' '}
          <button
            type="button"
            onClick={() => setIsPrivacyOpen(true)}
            className="font-semibold text-accent underline hover:text-accent/80 transition-colors cursor-pointer"
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
    </div>
  );
}
