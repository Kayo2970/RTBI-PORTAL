'use client';

import React, { useEffect, useRef } from 'react';
import { Calendar, ChevronDown, Palette, Sparkles } from 'lucide-react';
import { PassBarcodeFormat, PassQrOptions, PassQrShape, PassTheme, DEFAULT_QR_OPTIONS, expandDateRange } from '@/lib/local-data';
import { drawStyledQr } from '@/lib/qr-style';
import { contrastRatio } from '@/lib/wallet-poster-spec';
import { FALLBACK_ORIGIN } from '@/lib/app-origin';

export const PASS_COLOR_PRESETS = [
  { name: 'Obsidian Black', hex: '#0b1526', ring: 'ring-slate-500' },
  { name: 'Sapphire Navy', hex: '#0d2342', ring: 'ring-sky-500' },
  { name: 'Emerald Forest', hex: '#063024', ring: 'ring-emerald-500' },
  { name: 'Amethyst Purple', hex: '#2b124c', ring: 'ring-purple-500' },
  { name: 'Burgundy Wine', hex: '#3e0f1e', ring: 'ring-rose-500' },
  { name: 'Amber Bronze', hex: '#3a2408', ring: 'ring-amber-500' },
  { name: 'Titanium Slate', hex: '#1e2530', ring: 'ring-slate-400' },
];

export const PASS_GRADIENT_PRESETS = [
  { name: 'Deep Sapphire', value: 'linear-gradient(145deg, #0d2342 0%, #030712 100%)', baseColor: '#0d2342', endColor: '#030712' },
  { name: 'Royal Emerald', value: 'linear-gradient(145deg, #063024 0%, #021a14 100%)', baseColor: '#063024', endColor: '#021a14' },
  { name: 'Ruby Crimson', value: 'linear-gradient(145deg, #3e0f1e 0%, #150207 100%)', baseColor: '#3e0f1e', endColor: '#150207' },
  { name: 'Obsidian Gold', value: 'linear-gradient(145deg, #1f1f23 0%, #78350f 100%)', baseColor: '#18181b', endColor: '#78350f' },
  { name: 'Amethyst Night', value: 'linear-gradient(145deg, #2b124c 0%, #0d0617 100%)', baseColor: '#2b124c', endColor: '#0d0617' },
  { name: 'Ocean Cyan', value: 'linear-gradient(145deg, #0369a1 0%, #082f49 100%)', baseColor: '#0369a1', endColor: '#082f49' },
  { name: 'Sunset Bronze', value: 'linear-gradient(145deg, #7c2d12 0%, #1c1917 100%)', baseColor: '#7c2d12', endColor: '#1c1917' },
  { name: 'Titanium Slate', value: 'linear-gradient(145deg, #334155 0%, #0f172a 100%)', baseColor: '#1e293b', endColor: '#0f172a' },
];

/** Gradient / solid colour design of the pass card. Shared by the Studio and the Edit Pass dialog. */
export function PassColorControls({
  colorMode, setColorMode, passColor, setPassColor, passGradient, setPassGradient, gradientEndColor, setGradientEndColor, activeTheme,
}: {
  colorMode: 'gradient' | 'solid';
  setColorMode: (m: 'gradient' | 'solid') => void;
  passColor: string;
  setPassColor: (c: string) => void;
  passGradient: string;
  setPassGradient: (g: string) => void;
  gradientEndColor: string;
  setGradientEndColor: (c: string) => void;
  activeTheme?: PassTheme;
}) {
  return (
    <>
            {/* 4.5. Pass Color & Gradient Customization */}
            <div className="space-y-3 p-3.5 rounded-2xl bg-slate-50/70 dark:bg-white/5 border border-slate-200 dark:border-white/10">
              <div className="flex items-center justify-between">
                <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5 text-accent" />
                  <span>Pass Color &amp; Gradient Customization</span>
                </label>
              {activeTheme?.backgroundUrl && (
                <p className="text-[10.5px] text-sky-400">Event background image is active on the card — the colour/gradient below is only the fallback.</p>
              )}
                <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-white/10 p-0.5 rounded-lg text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => setColorMode('gradient')}
                    className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                      colorMode === 'gradient'
                        ? 'bg-accent text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-white'
                    }`}
                  >
                    Gradient
                  </button>
                  <button
                    type="button"
                    onClick={() => setColorMode('solid')}
                    className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                      colorMode === 'solid'
                        ? 'bg-accent text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-white'
                    }`}
                  >
                    Solid
                  </button>
                </div>
              </div>

              {colorMode === 'gradient' ? (
                <div className="space-y-2.5">
                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                    Select a luxury dual-tone gradient preset or customize both gradient stops:
                  </div>
                  {/* Gradient Presets */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {PASS_GRADIENT_PRESETS.map((gp) => {
                      const isSelected = passGradient === gp.value;
                      return (
                        <button
                          type="button"
                          key={gp.name}
                          onClick={() => {
                            setPassGradient(gp.value);
                            setPassColor(gp.baseColor);
                            setGradientEndColor(gp.endColor);
                          }}
                          className={`px-2.5 py-1.5 rounded-xl border text-left transition-all cursor-pointer relative overflow-hidden flex items-center justify-between ${
                            isSelected
                              ? 'ring-2 ring-accent border-white shadow-md'
                              : 'border-white/15 opacity-85 hover:opacity-100'
                          }`}
                          style={{ background: gp.value }}
                        >
                          <span className="text-[10px] font-extrabold text-white drop-shadow truncate">
                            {gp.name}
                          </span>
                          {isSelected && <Sparkles className="h-3 w-3 text-white drop-shadow shrink-0" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Dual Tone Color Pickers */}
                  <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-200/80 dark:border-white/10">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">Start Color:</span>
                      <label className="relative cursor-pointer flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-200 dark:bg-white/10 border border-slate-300 dark:border-white/15 text-[10px] font-bold text-slate-700 dark:text-slate-200">
                        <div className="w-3.5 h-3.5 rounded-full border border-white/40 shadow-inner" style={{ backgroundColor: passColor }} />
                        <span>{passColor}</span>
                        <input
                          type="color"
                          value={passColor}
                          onChange={(e) => {
                            const newStart = e.target.value;
                            setPassColor(newStart);
                            setPassGradient(`linear-gradient(145deg, ${newStart} 0%, ${gradientEndColor} 100%)`);
                          }}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                      </label>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">End Color:</span>
                      <label className="relative cursor-pointer flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-200 dark:bg-white/10 border border-slate-300 dark:border-white/15 text-[10px] font-bold text-slate-700 dark:text-slate-200">
                        <div className="w-3.5 h-3.5 rounded-full border border-white/40 shadow-inner" style={{ backgroundColor: gradientEndColor }} />
                        <span>{gradientEndColor}</span>
                        <input
                          type="color"
                          value={gradientEndColor}
                          onChange={(e) => {
                            const newEnd = e.target.value;
                            setGradientEndColor(newEnd);
                            setPassGradient(`linear-gradient(145deg, ${passColor} 0%, ${newEnd} 100%)`);
                          }}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                    Solid pass theme (applied directly to digital card &amp; Apple Wallet pass):
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {PASS_COLOR_PRESETS.map((cp) => {
                      const isSelected = passColor.toLowerCase() === cp.hex.toLowerCase();
                      return (
                        <button
                          type="button"
                          key={cp.hex}
                          onClick={() => {
                            setPassColor(cp.hex);
                            setPassGradient(`linear-gradient(145deg, ${cp.hex} 0%, #030712 100%)`);
                          }}
                          title={cp.name}
                          className={`h-7 w-7 rounded-xl transition-all cursor-pointer relative flex items-center justify-center border ${
                            isSelected
                              ? 'scale-110 ring-2 ring-accent border-white shadow-md'
                              : 'border-white/20 hover:scale-105 opacity-85 hover:opacity-100'
                          }`}
                          style={{ backgroundColor: cp.hex }}
                        >
                          {isSelected && <Sparkles className="h-3 w-3 text-white drop-shadow" />}
                        </button>
                      );
                    })}

                    <div className="flex items-center gap-1.5 ml-auto">
                      <label className="relative cursor-pointer flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/20 border border-slate-300 dark:border-white/15 text-[10px] font-bold text-slate-700 dark:text-slate-200 transition-all">
                        <span>Custom</span>
                        <input
                          type="color"
                          value={passColor}
                          onChange={(e) => {
                            setPassColor(e.target.value);
                            setPassGradient(`linear-gradient(145deg, ${e.target.value} 0%, #030712 100%)`);
                          }}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

    </>
  );
}

/** Text + label colour overrides (blank = automatic). */
export function PassTextColorControls({
  textColor, setTextColor, labelColor, setLabelColor,
}: {
  textColor: string;
  setTextColor: (c: string) => void;
  labelColor: string;
  setLabelColor: (c: string) => void;
}) {
  return (
    <>
            {/* 4.6 Text colours */}
            <div className="space-y-2">
              <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px] flex items-center justify-between">
                <span>Pass Text Colours</span>
                {(textColor || labelColor) && (
                  <button type="button" onClick={() => { setTextColor(''); setLabelColor(''); }} className="text-[10px] text-sky-400 hover:underline">
                    Reset to auto
                  </button>
                )}
              </label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ['Text (name, event)', textColor, setTextColor, '#ffffff'],
                  ['Labels & accents', labelColor, setLabelColor, '#38bdf8'],
                ] as const).map(([lbl, val, set, fallback]) => (
                  <label key={lbl} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-300 dark:border-white/15 bg-slate-50 dark:bg-slate-900/60 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    {lbl}
                    <input type="color" value={val || fallback} onChange={(e) => set(e.target.value)} className="h-7 w-10 rounded border border-slate-300 dark:border-white/20 bg-transparent cursor-pointer" />
                  </label>
                ))}
              </div>
              <p className="text-[10.5px] text-slate-500">
                Applies to the pass card, the public pass page and the emailed ticket. Apple/Google Wallet draws its own white text on poster backgrounds.
              </p>
            </div>

    </>
  );
}

/** One pass, one QR, many days: pick which of the event's days this pass is valid on. */
export function PassValidityPicker({
  eventDays, effectiveValidDays, selectedValidDays, setSelectedValidDays, toggleValidDay, validityDate, setValidityDate, displayValidity,
}: {
  eventDays: string[];
  effectiveValidDays: string[];
  selectedValidDays: string[] | null;
  setSelectedValidDays: (d: string[] | null) => void;
  toggleValidDay: (d: string) => void;
  validityDate: string;
  setValidityDate: (v: string) => void;
  displayValidity: string;
}) {
  return (
              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px] flex items-center justify-between">
                  <span>Valid On (one pass, one QR for all selected days)</span>
                  {selectedValidDays && (
                    <button
                      type="button"
                      onClick={() => setSelectedValidDays(null)}
                      className="text-[10px] text-sky-400 hover:underline"
                    >
                      All event days
                    </button>
                  )}
                </label>
                {eventDays.length > 1 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {eventDays.map((d) => {
                      const on = effectiveValidDays.includes(d);
                      return (
                        <button
                          type="button"
                          key={d}
                          onClick={() => toggleValidDay(d)}
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-all cursor-pointer ${
                            on
                              ? 'bg-sky-500/20 border-sky-400 text-sky-600 dark:text-sky-200'
                              : 'bg-slate-50 dark:bg-slate-900/60 border-slate-300 dark:border-white/15 text-slate-500 line-through'
                          }`}
                        >
                          {new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="relative">
                    <Calendar className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="date"
                      value={validityDate}
                      onChange={(e) => setValidityDate(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-accent text-xs"
                    />
                  </div>
                )}
                <p className="text-[10.5px] text-slate-500">
                  Valid: <strong>{displayValidity}</strong>
                  {effectiveValidDays.length > 1 ? ` · ${effectiveValidDays.length} days` : ''}
                </p>
              </div>
  );
}

export { expandDateRange };


/** One collapsible group ("dropdown") of the pass designer. */
export function PassSection({
  title, hint, icon, open, onToggle, children, keepMounted,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  /** Keep the content mounted (hidden) while collapsed, e.g. when it loads data other previews depend on. */
  keepMounted?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const wasOpen = useRef(open);
  // When a menu opens, bring it into view (below the sticky header). Other menus collapse as it opens, so wait a frame.
  useEffect(() => {
    if (open && !wasOpen.current) {
      const t = setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      wasOpen.current = open;
      return () => clearTimeout(t);
    }
    wasOpen.current = open;
  }, [open]);
  return (
    <section ref={ref} className="scroll-mt-20 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/[0.03] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer hover:bg-slate-100/70 dark:hover:bg-white/[0.04] transition-colors"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          {icon && <span className="text-accent shrink-0">{icon}</span>}
          <span className="min-w-0">
            <span className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-100">{title}</span>
            {hint && <span className="block text-[10.5px] text-slate-500 dark:text-slate-400 font-medium normal-case tracking-normal truncate">{hint}</span>}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {(open || keepMounted) && (
        <div className={`px-4 pb-4 pt-1 space-y-4 border-t border-slate-200/70 dark:border-white/10 ${open ? '' : 'hidden'}`}>{children}</div>
      )}
    </section>
  );
}

const label = 'block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px] mb-1.5';
const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer transition-all ${
    on ? 'border-accent bg-accent/15 text-accent' : 'border-slate-300 dark:border-white/15 text-slate-500 dark:text-slate-400 hover:border-accent/50'
  }`;

/**
 * "Event title on the wallet pass": Auto prints the title only when the artwork doesn't already carry it.
 * Used by the event's Pass look editor (the event default), the Studio / Edit Pass (per pass) and the wallet previews.
 */
export function EventTitleToggle({
  value, onChange, eventDefault, scope = 'pass', target = 'wallet',
}: {
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
  eventDefault?: boolean;
  scope?: 'event' | 'pass';
  /** 'wallet' = Apple/Google Wallet artwork; 'portal' = the 3D card on the pass page. */
  target?: 'wallet' | 'portal';
}) {
  const portal = target === 'portal';
  const autoName = portal ? 'Show' : 'Auto';
  const defaultName = eventDefault === undefined ? autoName : eventDefault ? (portal ? 'Show' : 'Always show') : 'Hide';
  return (
    <div>
      <span className={label}>{portal ? 'Event title on the portal card' : 'Event title on the wallet pass'}</span>
      <div className="flex flex-wrap gap-2">
        {([[scope === 'pass' ? `Event default (${defaultName})` : portal ? 'Show (default)' : 'Auto', undefined], [portal ? 'Show' : 'Always show', true], ['Hide', false]] as Array<[string, boolean | undefined]>).map(([name, v]) => (
          <button key={name} type="button" onClick={() => onChange(v)} className={chip(value === v)}>{name}</button>
        ))}
      </div>
      <p className="text-[10.5px] text-slate-500 mt-1">
        {portal ? (
          <>Controls the event title printed on the front of the 3D card people open from their pass link. The date and guest details stay. {scope === 'event' ? 'This is the default for every pass of the event.' : 'Follows the event default unless you pick Show or Hide here.'}</>
        ) : (
          <>Controls the title we print on the Apple / Google Wallet artwork (and in the Add-to-Wallet sheet). If your uploaded artwork image already has the title written in it, <strong>Hide cannot remove that</strong> — edit the image itself. {scope === 'event' ? 'Default for every pass of this event. Auto prints the title only when your artwork doesn\'t already contain it.' : 'Auto follows the event default. Auto itself prints the title only when your event artwork doesn\'t already contain it.'}</>
        )}
      </p>
    </div>
  );
}

/** Text size of the designed artwork (wallet poster, emailed ticket, portal card) and whether the poster prints the event title. */
/** On/off for the event artwork on the portal card — off lets the pass's own colours/gradient show while designing. */
export function CardArtworkToggle({ value, onChange, hasArtwork }: { value: boolean | undefined; onChange: (v: boolean | undefined) => void; hasArtwork: boolean }) {
  const on = value !== false;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 p-3">
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <span className="min-w-0">
          <span className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">Event artwork on the card</span>
          <span className="block text-[10.5px] text-slate-500 mt-0.5">
            {hasArtwork
              ? on ? 'On — the event picture covers the card, so colour changes are hidden. Switch off to see your colours.' : 'Off — the card uses the colours / gradient chosen here.'
              : 'This event has no artwork, so the card already uses your colours.'}
          </span>
        </span>
        <input
          type="checkbox"
          checked={on}
          disabled={!hasArtwork}
          onChange={(e) => onChange(e.target.checked ? undefined : false)}
          className="h-5 w-5 accent-sky-500 shrink-0"
          aria-label="Show event artwork on the card"
        />
      </label>
    </div>
  );
}

export function PassFontControls({
  fontScale, setFontScale, showEventTitle, setShowEventTitle, eventDefault, showPortalTitle, setShowPortalTitle, portalDefault,
}: {
  fontScale: number;
  setFontScale: (n: number) => void;
  showEventTitle: boolean | undefined;
  setShowEventTitle: (v: boolean | undefined) => void;
  /** The event's own default (shown as a hint; a pass value overrides it). */
  eventDefault?: boolean;
  showPortalTitle?: boolean;
  setShowPortalTitle?: (v: boolean | undefined) => void;
  portalDefault?: boolean;
}) {
  const sizes: Array<[string, number]> = [['Small', 0.85], ['Normal', 1], ['Large', 1.15], ['X-Large', 1.3]];
  return (
    <div className="space-y-3">
      <div>
        <span className={label}>Text size</span>
        <div className="flex flex-wrap items-center gap-2">
          {sizes.map(([name, v]) => (
            <button key={name} type="button" onClick={() => setFontScale(v)} className={chip(Math.abs(fontScale - v) < 0.01)}>{name}</button>
          ))}
          <input
            type="range"
            min={0.8}
            max={1.3}
            step={0.05}
            value={fontScale}
            onChange={(e) => setFontScale(Number(e.target.value))}
            className="flex-1 min-w-[120px] accent-sky-500"
            aria-label="Text size"
          />
          <span className="text-[11px] font-bold tabular-nums text-slate-500 w-10 text-right">{Math.round(fontScale * 100)}%</span>
        </div>
        <p className="text-[10.5px] text-slate-500 mt-1">Applies to the event title, guest name and details on the portal card, the emailed ticket and the wallet pass artwork. Apple draws its own small field row on the wallet pass.</p>
      </div>
      <EventTitleToggle value={showEventTitle} onChange={setShowEventTitle} eventDefault={eventDefault} />
      {setShowPortalTitle && <EventTitleToggle target="portal" value={showPortalTitle} onChange={setShowPortalTitle} eventDefault={portalDefault} />}
    </div>
  );
}

const QR_FORMATS: Array<[PassBarcodeFormat, string]> = [['QR', 'QR code'], ['Aztec', 'Aztec'], ['PDF417', 'PDF417'], ['Code128', 'Code 128']];
const QR_SHAPES: Array<[PassQrShape, string]> = [['square', 'Square'], ['rounded', 'Rounded'], ['dots', 'Dots']];
const QR_COLOR_PRESETS: Array<[string, string, string, string]> = [
  ['Classic', '#0B1B2E', '#ffffff', ''],
  ['Black', '#000000', '#ffffff', ''],
  ['Emerald', '#064e3b', '#ecfdf5', ''],
  ['Royal', '#1e3a8a', '#eff6ff', '#0b1b2e'],
  ['Gold', '#451a03', '#fef3c7', '#92400e'],
];

/** Live canvas preview of the styled QR, drawn by the same routine as the card, ticket and wallet artwork. */
function QrLivePreview({ value }: { value: PassQrOptions }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let cancelled = false;
    const draw = (logo?: HTMLImageElement) => {
      if (!cancelled) drawStyledQr(ctx, `${FALLBACK_ORIGIN}/pass/LEADS-EVT-2026-SAMPLE`, 0, 0, 240, { dark: value.dark, light: value.light, eye: value.eye || undefined, shape: value.shape, logo });
    };
    if (!value.logo) return draw();
    const img = new Image();
    img.onload = () => draw(img);
    img.onerror = () => draw();
    img.src = '/images/rtbi-icon.png';
    return () => {
      cancelled = true;
    };
  }, [value.dark, value.light, value.eye, value.shape, value.logo]);
  return <canvas ref={ref} width={240} height={240} className="h-28 w-28 rounded-xl border border-slate-300 dark:border-white/15 shrink-0" aria-label="QR preview" />;
}

/** Full QR customisation: shape, colours (dots, background, corner eyes), centre logo, wallet barcode type/caption and wallet mode. */
export function PassQrControls({ value, onChange }: { value: PassQrOptions; onChange: (patch: Partial<PassQrOptions>) => void }) {
  const ratio = contrastRatio(value.dark, value.light);
  const weak = ratio < 4;
  const inverted = value.dark.length === 7 && value.light.length === 7 && contrastRatio(value.dark, '#000000') > contrastRatio(value.light, '#000000');
  const colour = (name: string, key: 'dark' | 'light' | 'eye', fallback: string) => (
    <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
      {name}
      <input type="color" value={value[key] || fallback} onChange={(e) => onChange({ [key]: e.target.value })} className="h-7 w-9 rounded cursor-pointer bg-transparent" />
    </label>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <QrLivePreview value={value} />
        <div className="space-y-3 min-w-0">
          <div>
            <span className={label}>Shape</span>
            <div className="flex flex-wrap gap-2">
              {QR_SHAPES.map(([sh, name]) => (
                <button key={sh} type="button" onClick={() => onChange({ shape: sh })} className={chip(value.shape === sh)}>{name}</button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={value.logo} onChange={(e) => onChange({ logo: e.target.checked })} className="accent-sky-500" />
            Logo in the centre
          </label>
        </div>
      </div>

      <div>
        <span className={label}>Colours</span>
        <div className="flex flex-wrap items-center gap-2">
          {QR_COLOR_PRESETS.map(([name, d, l, e]) => (
            <button key={name} type="button" onClick={() => onChange({ dark: d, light: l, eye: e })} className={`flex items-center gap-2 ${chip(value.dark.toLowerCase() === d.toLowerCase() && value.light.toLowerCase() === l.toLowerCase() && (value.eye || '').toLowerCase() === e.toLowerCase())}`}>
              <span className="h-3.5 w-3.5 rounded border border-black/20" style={{ background: `linear-gradient(135deg, ${d} 50%, ${l} 50%)` }} />
              {name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-2">
          {colour('Dots', 'dark', DEFAULT_QR_OPTIONS.dark)}
          {colour('Background', 'light', DEFAULT_QR_OPTIONS.light)}
          {colour('Corner eyes', 'eye', value.dark)}
          {value.eye && <button type="button" onClick={() => onChange({ eye: '' })} className="text-[11px] font-bold text-accent hover:underline cursor-pointer">Eyes = dots</button>}
        </div>
        {(weak || inverted) && (
          <p className="text-[10.5px] text-amber-500 font-semibold mt-1.5">
            {inverted ? 'Light dots on a dark background may not scan on some phones — keep the dots darker than the background.' : 'Low contrast — some scanners may struggle. Pick darker dots or a lighter background.'}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-white/10 p-3 space-y-2">
        <label className="flex items-start gap-2 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
          <input type="checkbox" checked={value.inWallet} onChange={(e) => onChange({ inWallet: e.target.checked })} className="accent-sky-500 mt-0.5" />
          <span>
            Use this exact QR on the Apple / Google Wallet pass too (recommended)
            <span className="block font-medium text-slate-500 dark:text-slate-400 mt-0.5">
              Keeps your QR identical on the 3D card, the emailed ticket and the wallet pass. It is drawn into the wallet artwork instead of Apple&apos;s native black-on-white barcode — scanning still works, but the wallet no longer auto-brightens the screen for the barcode. Turn this off to use Apple&apos;s native barcode.
            </span>
          </span>
        </label>
        {!value.inWallet && (
          <div className="space-y-3 pt-1">
            <div>
              <span className={label}>Wallet barcode type</span>
              <div className="flex flex-wrap gap-2">
                {QR_FORMATS.map(([f, name]) => (
                  <button key={f} type="button" onClick={() => onChange({ format: f })} className={chip(value.format === f)}>{name}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div>
          <span className={label}>Caption under the wallet QR</span>
          <div className="flex flex-wrap gap-2">
            {([['serial', 'Pass ID'], ['name', 'Guest name'], ['none', 'None']] as const).map(([v, name]) => (
              <button key={v} type="button" onClick={() => onChange({ altText: v })} className={chip(value.altText === v)}>{name}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
