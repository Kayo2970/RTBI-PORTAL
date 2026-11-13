'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, Save, Palette } from 'lucide-react';
import { DEFAULT_PASS_THEME, PassTheme, authHeaders } from '@/lib/local-data';
import { passThemeStyle } from '@/lib/pass-theme-style';
import { AppleWalletPosterPreview } from './apple-wallet-poster-preview';
import { HolderCoverPreview } from './interactive-keycard-holder';
import { EventTitleToggle } from './pass-design-controls';

interface Props {
  eventId: string;
  eventName: string;
  /** Called after a successful save/load so previews elsewhere (wallet card, keycard) can use it. */
  onThemeChange?: (theme: PassTheme | undefined) => void;
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });

/** Event-level pass look: background artwork, logo, colours. Applies to the keycard, wallet pass and emailed boarding pass. */
export function PassThemeEditor({ eventId, eventName, onThemeChange }: Props) {
  const [theme, setTheme] = useState<PassTheme>({});
  const [draft, setDraft] = useState<PassTheme>({});
  const [pendingBg, setPendingBg] = useState<string | null | undefined>(undefined); // undefined = unchanged, null = remove
  const [pendingLogo, setPendingLogo] = useState<string | null | undefined>(undefined);
  const [pendingEmailArt, setPendingEmailArt] = useState<string | null | undefined>(undefined);
  const emailInput = useRef<HTMLInputElement>(null);
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const bgInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  const eligible = Boolean(eventId) && eventId !== 'standalone' && !eventId.startsWith('custom-');

  const load = useCallback(async () => {
    if (!eligible) return;
    // Switching event: drop the previous event's unsaved draft straight away
    setDraft({});
    setPendingBg(undefined);
    setPendingLogo(undefined);
    setPendingEmailArt(undefined);
    try {
      const res = await fetch(`/api/events/${eventId}/pass-theme`, { headers: authHeaders() });
      if (!res.ok) return;
      const data: PassTheme = await res.json();
      setTheme(data);
      setDraft(data);
      setPendingBg(undefined);
      setPendingLogo(undefined);
      setPendingEmailArt(undefined);
    } catch {
      /* ignore */
    }
  }, [eventId, eligible, onThemeChange]);

  useEffect(() => {
    load();
  }, [load]);

  // Live preview: report the *draft* (saved + unsaved edits + not-yet-uploaded images) to the Studio on every
  // change, so the luxury card, wallet poster and ticket update before anything is saved.
  useEffect(() => {
    if (!eligible) {
      onThemeChange?.(undefined);
      return;
    }
    const t: PassTheme = { ...draft };
    if (pendingBg === null) {
      delete t.backgroundUrl;
      delete t.walletBackgroundUrl;
    } else if (pendingBg) {
      t.backgroundUrl = pendingBg;
      t.walletBackgroundUrl = pendingBg;
    }
    if (pendingLogo === null) delete t.logoUrl;
    else if (pendingLogo) t.logoUrl = pendingLogo;
    if (pendingEmailArt === null) delete t.emailArtworkUrl;
    else if (pendingEmailArt) t.emailArtworkUrl = pendingEmailArt;
    onThemeChange?.(t);
  }, [draft, pendingBg, pendingLogo, pendingEmailArt, eligible, onThemeChange]);

  if (!eligible) {
    return (
      <p className="text-[11px] text-slate-500">
        Select an existing event to customise its pass background, logo and colours.
      </p>
    );
  }

  const merged: PassTheme = {
    ...draft,
    backgroundUrl: pendingBg === null ? undefined : pendingBg || draft.backgroundUrl,
    logoUrl: pendingLogo === null ? undefined : pendingLogo || draft.logoUrl,
  };
  const val = {
    bg: draft.backgroundColor || DEFAULT_PASS_THEME.backgroundColor,
    fg: draft.foregroundColor || DEFAULT_PASS_THEME.foregroundColor,
    label: draft.labelColor || DEFAULT_PASS_THEME.labelColor,
    overlay: typeof draft.overlay === 'number' ? draft.overlay : DEFAULT_PASS_THEME.overlay,
  };
  // Emailed ticket: shares the background unless a custom design is switched on
  const emailOwn = draft.emailUseBackground === false;
  const em = {
    bg: draft.emailBackgroundColor || val.bg,
    fg: draft.emailForegroundColor || val.fg,
    label: draft.emailLabelColor || val.label,
    overlay: typeof draft.emailOverlay === 'number' ? draft.emailOverlay : val.overlay,
    art: pendingEmailArt === null ? undefined : pendingEmailArt || draft.emailArtworkUrl,
  };
  const ticketTheme: PassTheme = emailOwn
    ? { backgroundUrl: em.art, backgroundColor: em.bg, foregroundColor: em.fg, labelColor: em.label, overlay: em.overlay, logoUrl: merged.logoUrl }
    : merged;
  const tk = emailOwn ? em : val;

  const ticketPreview = (
    <div
      className="relative rounded-2xl overflow-hidden border border-white/10 shadow-lg"
      style={{ ...passThemeStyle(ticketTheme, `linear-gradient(145deg, ${tk.bg} 0%, #030712 100%)`), aspectRatio: '1160 / 420' }}
    >
      <div className="absolute inset-0 flex">
        <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
          <div className="flex items-center gap-2">
            {merged.logoUrl && <img src={merged.logoUrl} alt="" className="h-6 w-auto object-contain" />}
            <div>
              <div className="text-[9px] font-black tracking-widest" style={{ color: tk.label }}>RTBI • RUAS</div>
              <div className="text-[8px]" style={{ color: tk.label }}>OFFICIAL EVENT PASS</div>
            </div>
          </div>
          <div>
            <div className="text-sm font-black truncate" style={{ color: tk.fg }}>{eventName}</div>
            <div className="text-[8px] mt-1" style={{ color: tk.label }}>VIP DIGNITARY</div>
            <div className="text-xs font-bold" style={{ color: tk.fg }}>Attendee Name</div>
          </div>
        </div>
        <div className="w-[25%] bg-white/95 flex flex-col items-center justify-center border-l-2 border-dashed border-slate-400/50">
          <div className="h-10 w-10 bg-slate-900 rounded-sm" />
          <div className="text-[7px] font-bold text-slate-700 mt-1">SCAN AT ENTRY</div>
        </div>
      </div>
    </div>
  );

  const posterPreview = (
    <AppleWalletPosterPreview
      attendeeName="Attendee Name"
      guestCategory="VIP Dignitary"
      passType="VIP Pass"
      roomOrVenue="Main Auditorium"
      eventName={eventName}
      validity="10 Oct – 12 Oct 2026"
      serialNumber="LEADS-EVT-2026-XXXXXX"
      validDaysCount={3}
      logoUrl={merged.logoUrl || '/images/rtbi-icon.png'}
      theme={{ ...merged, walletBackgroundUrl: pendingBg || draft.walletBackgroundUrl }}
      passColor={val.bg}
    />
  );

  const pick = async (e: React.ChangeEvent<HTMLInputElement>, kind: 'bg' | 'logo' | 'email') => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return setMessage('Please choose an image file.');
    if (file.size > 12 * 1024 * 1024) return setMessage('Image is too large (max 12 MB).');
    const url = await readAsDataUrl(file);
    if (kind === 'bg') setPendingBg(url);
    else if (kind === 'email') setPendingEmailArt(url);
    else setPendingLogo(url);
    setMessage('');
  };

  // Only explicit email colours are stored; a colour the user reset is sent as null so the server clears it
  const emailColourUpdates = (): Record<string, string | null> => {
    const out: Record<string, string | null> = {};
    for (const k of ['emailBackgroundColor', 'emailForegroundColor', 'emailLabelColor'] as const) {
      if (draft[k]) out[k] = draft[k] as string;
      else if (theme[k]) out[k] = null;
    }
    return out;
  };

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`/api/events/${eventId}/pass-theme`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          backgroundColor: val.bg,
          foregroundColor: val.fg,
          labelColor: val.label,
          overlay: val.overlay,
          // Event default for the wallet poster title; null (Auto) clears a previous choice
          showEventTitle: draft.showEventTitle ?? null,
          showPortalTitle: draft.showPortalTitle ?? null,
          emailUseBackground: !emailOwn,
          emailOverlay: em.overlay,
          // Email colours are only stored when explicitly chosen; otherwise the ticket follows the general colours
          ...emailColourUpdates(),
          ...(pendingEmailArt !== undefined ? { emailArtwork: pendingEmailArt === null ? null : { dataUrl: pendingEmailArt } } : {}),
          ...(pendingBg !== undefined ? { background: pendingBg === null ? null : { dataUrl: pendingBg } } : {}),
          ...(pendingLogo !== undefined ? { logo: pendingLogo === null ? null : { dataUrl: pendingLogo } } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setTheme(data);
      setDraft(data);
      setPendingBg(undefined);
      setPendingLogo(undefined);
      setPendingEmailArt(undefined);
      setMessage(
        data.walletErrors?.length
          ? `Saved, but WalletWallet rejected the update: ${data.walletErrors[0]} (background/logo need a Pro key and a publicly reachable portal URL).`
          : data.walletUpdated
          ? `Saved. ${data.walletUpdated} wallet pass(es) updated live.`
          : 'Saved. New passes, emails and wallet cards will use this look.'
      );
    } catch (e: any) {
      setMessage(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    pendingBg !== undefined ||
    pendingLogo !== undefined ||
    pendingEmailArt !== undefined ||
    emailOwn !== (theme.emailUseBackground === false) ||
    draft.emailBackgroundColor !== theme.emailBackgroundColor ||
    draft.emailForegroundColor !== theme.emailForegroundColor ||
    draft.emailLabelColor !== theme.emailLabelColor ||
    (emailOwn && (em.overlay !== (typeof theme.emailOverlay === 'number' ? theme.emailOverlay : (typeof theme.overlay === 'number' ? theme.overlay : DEFAULT_PASS_THEME.overlay)))) ||
    val.bg !== (theme.backgroundColor || DEFAULT_PASS_THEME.backgroundColor) ||
    val.fg !== (theme.foregroundColor || DEFAULT_PASS_THEME.foregroundColor) ||
    val.label !== (theme.labelColor || DEFAULT_PASS_THEME.labelColor) ||
    draft.showEventTitle !== theme.showEventTitle ||
    draft.showPortalTitle !== theme.showPortalTitle ||
    val.overlay !== (typeof theme.overlay === 'number' ? theme.overlay : DEFAULT_PASS_THEME.overlay);

  const colourField = (label: string, key: 'backgroundColor' | 'foregroundColor' | 'labelColor', value: string) => (
    <label className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
      {label}
      <input
        type="color"
        value={value}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        className="h-7 w-10 rounded border border-slate-300 dark:border-white/20 bg-transparent cursor-pointer"
      />
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
        <Palette className="h-3.5 w-3.5 text-accent" /> Pass look for “{eventName}”
      </div>

      {/* Folder + pass preview: the leather holder cover carries the same logo as the pass inside it */}
      <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Folder &amp; pass preview</div>
          <div className="flex rounded-full border border-white/15 p-0.5 text-[10px] font-bold">
            {(['horizontal', 'vertical'] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOrientation(o)}
                className={`px-3 py-1 rounded-full capitalize cursor-pointer ${orientation === o ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start justify-center">
          <div className="shrink-0 text-center">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Leather folder cover</div>
            <div className="flex justify-center pb-2">
              <HolderCoverPreview logoUrl={merged.logoUrl} width={190} />
            </div>
            <div className="text-[10px] text-slate-500 mt-1">{merged.logoUrl ? 'Debossed with the event logo' : 'Default RTBI logo — upload one below'}</div>
          </div>
          <div className="min-w-0 flex-1 max-w-full text-center">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              {orientation === 'horizontal' ? 'Horizontal pass (email ticket)' : 'Vertical pass (Apple / Google Wallet)'}
            </div>
            {orientation === 'horizontal' ? (
              <div className="w-full max-w-[420px] mx-auto text-left">{ticketPreview}</div>
            ) : (
              <div className="inline-block" style={{ zoom: 0.7 }}>{posterPreview}</div>
            )}
          </div>
        </div>
      </div>

      {/* Wallet preview: exactly what iOS 27 draws from the portrait 690×1010 crop WalletWallet receives */}
      <div className="flex flex-col sm:flex-row gap-4 items-start">
        <div className="shrink-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Apple / Google Wallet (iOS 27 poster) <span className="ml-1 normal-case tracking-normal font-semibold text-amber-500">· Apple fixes the text: white</span></div>
          <div style={{ zoom: 0.8 }}>{posterPreview}</div>
          <div className="mt-3 max-w-[300px]">
            <EventTitleToggle scope="event" value={draft.showEventTitle} onChange={(v) => setDraft((d) => ({ ...d, showEventTitle: v }))} />
          </div>
          <div className="mt-3 max-w-[300px]">
            <EventTitleToggle scope="event" target="portal" value={draft.showPortalTitle} onChange={(v) => setDraft((d) => ({ ...d, showPortalTitle: v }))} />
          </div>
        </div>
        <ul className="text-[10.5px] text-slate-500 space-y-1.5 list-disc pl-4 pt-5">
          <li>Artwork is cropped to <strong>portrait 690×1010</strong> (centre crop) — keep faces/logos in the middle.</li>
          <li>Apple dims the image and prints <strong>white text</strong> over it: top = logo, middle = details, bottom = QR. Avoid busy detail there.</li>
          <li>Older iPhones / Android show the classic card with your base colour; the artwork shows on iOS 27+.</li>
          <li>The image is sent to WalletWallet as a public URL on this portal and re-hosted by them once; re-uploading creates a new URL and updates installed passes.</li>
        </ul>
      </div>

      {/* Live boarding-pass preview (email + portal ticket) */}
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 -mb-1">Emailed boarding-pass ticket{emailOwn ? ' (custom design)' : ' (uses the event background)'}</div>
      {ticketPreview}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => bgInput.current?.click()}
          className="py-2 px-3 rounded-xl border border-dashed border-slate-400 dark:border-white/25 text-[11px] font-bold flex items-center justify-center gap-1.5 hover:border-accent cursor-pointer"
        >
          <ImagePlus className="h-3.5 w-3.5" /> {merged.backgroundUrl ? 'Replace background' : 'Upload background'}
        </button>
        <button
          type="button"
          onClick={() => logoInput.current?.click()}
          className="py-2 px-3 rounded-xl border border-dashed border-slate-400 dark:border-white/25 text-[11px] font-bold flex items-center justify-center gap-1.5 hover:border-accent cursor-pointer"
        >
          <ImagePlus className="h-3.5 w-3.5" /> {merged.logoUrl ? 'Replace logo' : 'Upload logo'}
        </button>
        <input ref={bgInput} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e, 'bg')} />
        <input ref={logoInput} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e, 'logo')} />
        {merged.backgroundUrl && (
          <button type="button" onClick={() => setPendingBg(null)} className="text-[10px] text-rose-400 hover:underline flex items-center justify-center gap-1 cursor-pointer">
            <Trash2 className="h-3 w-3" /> Remove background
          </button>
        )}
        {merged.logoUrl && (
          <button type="button" onClick={() => setPendingLogo(null)} className="text-[10px] text-rose-400 hover:underline flex items-center justify-center gap-1 cursor-pointer">
            <Trash2 className="h-3 w-3" /> Remove logo
          </button>
        )}
      </div>

      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 -mb-1">Portal card &amp; ticket colours <span className="normal-case tracking-normal font-semibold text-slate-400">(the Wallet poster ignores these — Apple draws its own white text)</span></div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {colourField('Base colour', 'backgroundColor', val.bg)}
        {colourField('Text colour', 'foregroundColor', val.fg)}
        {colourField('Label colour', 'labelColor', val.label)}
      </div>

      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
        Darken artwork for legibility: {Math.round(val.overlay * 100)}%
        <input
          type="range"
          min={0}
          max={0.9}
          step={0.05}
          value={val.overlay}
          onChange={(e) => setDraft((d) => ({ ...d, overlay: Number(e.target.value) }))}
          className="w-full accent-sky-500"
        />
      </label>

      {/* Separate design for the emailed ticket */}
      <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Email ticket design</div>
          <div className="flex rounded-full border border-white/15 p-0.5 text-[10px] font-bold">
            {([false, true] as const).map((own) => (
              <button
                key={String(own)}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, emailUseBackground: !own }))}
                className={`px-3 py-1 rounded-full cursor-pointer ${emailOwn === own ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {own ? 'Custom design' : 'Same as background'}
              </button>
            ))}
          </div>
        </div>
        {emailOwn && (
          <>
            <p className="text-[10.5px] text-slate-500">
              Upload art at <strong>1160 × 420 px</strong>. The right 290 px is covered by the white tear-off stub with the QR; the name, event, venue and dates are drawn over the main 870 px.{' '}
              <a href={`/api/events/${eventId}/pass-theme/template`} className="text-accent underline font-semibold" onClick={async (e) => {
                e.preventDefault();
                const res = await fetch(`/api/events/${eventId}/pass-theme/template`, { headers: authHeaders() });
                if (!res.ok) return setMessage('Could not download the template.');
                const url = URL.createObjectURL(await res.blob());
                const a = document.createElement('a');
                a.href = url;
                a.download = 'rtbi-email-ticket-template-1160x420.png';
                a.click();
                URL.revokeObjectURL(url);
              }}>Download template with safe zones</a>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => emailInput.current?.click()} className="py-2 px-3 rounded-xl border border-dashed border-slate-400 dark:border-white/25 text-[11px] font-bold flex items-center justify-center gap-1.5 hover:border-accent cursor-pointer">
                <ImagePlus className="h-3.5 w-3.5" /> {em.art ? 'Replace ticket art' : 'Upload ticket art'}
              </button>
              {em.art && (
                <button type="button" onClick={() => setPendingEmailArt(null)} className="text-[10px] text-rose-400 hover:underline flex items-center justify-center gap-1 cursor-pointer">
                  <Trash2 className="h-3 w-3" /> Remove ticket art
                </button>
              )}
              <input ref={emailInput} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e, 'email')} />
            </div>
            <div className="flex items-center justify-between text-[10.5px] text-slate-500">
              <span>{draft.emailBackgroundColor || draft.emailForegroundColor || draft.emailLabelColor ? 'Ticket uses its own colours.' : 'Ticket follows the general colours above.'}</span>
              {(draft.emailBackgroundColor || draft.emailForegroundColor || draft.emailLabelColor) && (
                <button type="button" onClick={() => setDraft((d) => ({ ...d, emailBackgroundColor: undefined, emailForegroundColor: undefined, emailLabelColor: undefined }))} className="text-sky-400 hover:underline cursor-pointer">
                  Match general colours
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {([
                ['Base colour', 'emailBackgroundColor', em.bg],
                ['Text colour', 'emailForegroundColor', em.fg],
                ['Label colour', 'emailLabelColor', em.label],
              ] as const).map(([lbl, key, v]) => (
                <label key={key} className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  {lbl}
                  <input type="color" value={v} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} className="h-7 w-10 rounded border border-slate-300 dark:border-white/20 bg-transparent cursor-pointer" />
                </label>
              ))}
            </div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              Darken ticket art: {Math.round(em.overlay * 100)}%
              <input type="range" min={0} max={0.9} step={0.05} value={em.overlay} onChange={(e) => setDraft((d) => ({ ...d, emailOverlay: Number(e.target.value) }))} className="w-full accent-sky-500" />
            </label>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        className="w-full py-2.5 rounded-xl bg-accent text-white text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
      >
        <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save pass look'}
      </button>
      <p className="text-[10.5px] text-slate-500">
        Applies to the portal keycard, the emailed boarding pass and the Apple/Google Wallet pass. Text/label colours below affect the portal card and email only — Apple draws wallet text in white.
      </p>
      {message && <p className="text-[11px] font-semibold text-accent">{message}</p>}
    </div>
  );
}
