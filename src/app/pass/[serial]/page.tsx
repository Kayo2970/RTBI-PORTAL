'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  ShieldCheck,
  Calendar,
  MapPin,
  Clock,
  Download,
  Share2,
  AlertTriangle,
  CheckCircle2,
  Ticket,
  ChevronRight,
  ExternalLink,
  QrCode,
  Smartphone,
} from 'lucide-react';
import { EventPassItem, PassTheme, getPassValidDays, getPassAttendanceSummary, formatValidDaysLabel } from '@/lib/local-data';
import { WalletProgressBar, fetchWalletPrepared, openWalletPass, useWalletProgress, WalletTarget } from '@/components/wallet-progress';
import { EventPassKeycard } from '@/components/event-pass-keycard';
import { CardQrModal } from '@/components/card-qr-modal';
import { FALLBACK_ORIGIN } from '@/lib/app-origin';

export default function PublicEventPassPage({
  params,
}: {
  params: Promise<{ serial: string }>;
}) {
  const { serial } = use(params);

  const [pass, setPass] = useState<EventPassItem | null>(null);
  const [theme, setTheme] = useState<PassTheme | undefined>(undefined);
  const [archived, setArchived] = useState<{ eventName: string; socials: Record<string, string> } | null>(null);
  const [walletNotice, setWalletNotice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [walletLoadingMsg, setWalletLoadingMsg] = useState('');
  const walletProgress = useWalletProgress(5000);
  const [walletError, setWalletError] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('dark');
    // Email wallet buttons redirect here with ?wallet=unavailable when the wallet pass couldn't be issued
    setWalletNotice(new URLSearchParams(window.location.search).get('wallet') === 'unavailable');
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pass/${serial}`)
      .then((res) => {
        if (!res.ok) throw new Error('Pass not found');
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data.archived) {
          setArchived({ eventName: data.eventName, socials: data.socials || {} });
        } else if (!cancelled && data.pass) {
          setPass(data.pass);
          setTheme(data.theme);
        } else if (!cancelled) {
          setNotFound(true);
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [serial]);

  const origin = typeof window !== 'undefined' ? window.location.origin : FALLBACK_ORIGIN;
  const passUrl = pass ? `${origin}/pass/${pass.serialNumber}` : '';

  // Build the wallet pass behind a progress bar (it can take a few seconds the first time), then hand it to the device
  const startWallet = async (target: WalletTarget) => {
    if (!pass) return;
    setWalletError('');
    setWalletLoadingMsg(`Getting your pass converted for ${target === 'apple' ? 'Apple' : 'Google'} Wallet…`);
    try {
      const prepared = await walletProgress.run(() => fetchWalletPrepared(pass.serialNumber));
      openWalletPass(pass.serialNumber, target, prepared);
    } catch (err: any) {
      console.error('Wallet error:', err);
      setWalletError(err.message || 'Unable to generate the wallet pass.');
    } finally {
      setWalletLoadingMsg('');
    }
  };
  const handleAddToAppleWallet = () => startWallet('apple');
  const handleAddToGoogleWallet = () => startWallet('google');

  // Download .ics calendar invite
  const handleAddToCalendar = () => {
    if (!pass) return;
    const title = `${pass.eventName} (${pass.passType})`;
    const location = pass.roomOrVenue || pass.eventVenue || 'Main Auditorium, RUAS';
    const description = `Official admission pass for ${pass.attendeeName}.\nPass Serial: ${pass.serialNumber}\nView digital pass: ${passUrl}`;
    
    // All-day event spanning the pass's valid days (falls back to a single day today if unknown)
    const days = getPassValidDays(pass);
    const compact = (iso: string) => iso.replace(/-/g, '');
    const first = days[0] || new Date().toISOString().slice(0, 10);
    const lastPlusOne = new Date(`${days[days.length - 1] || first}T00:00:00Z`);
    lastPlusOne.setUTCDate(lastPlusOne.getUTCDate() + 1);
    const startTime = compact(first);
    const endTime = compact(lastPlusOne.toISOString().slice(0, 10));

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//RTBI//Official Event Pass//EN',
      'BEGIN:VEVENT',
      `SUMMARY:${title}`,
      `LOCATION:${location}`,
      `DESCRIPTION:${description}`,
      `DTSTART;VALUE=DATE:${startTime}`,
      `DTEND;VALUE=DATE:${endTime}`,
      `UID:${pass.id}@rtbi-portal`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pass.serialNumber}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Share Pass link
  const handleSharePass = async () => {
    if (!pass) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Official Pass for ${pass.eventName}`,
          text: `Here is the official digital pass for ${pass.attendeeName} (${pass.passType}) at RTBI.`,
          url: passUrl,
        });
        return;
      } catch (e) {}
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(passUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-space-theme flex flex-col items-center justify-center p-4 relative z-0 overflow-hidden">
        <div className="glass-panel rounded-3xl px-8 py-6 flex items-center gap-3 border border-white/15 shadow-2xl backdrop-blur-2xl text-white">
          <div className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <span className="text-sm font-semibold tracking-wide">Loading Official Event Pass…</span>
        </div>
      </div>
    );
  }

  if (archived) {
    const labels: Record<string, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X', youtube: 'YouTube', facebook: 'Facebook', website: 'Website' };
    const links = Object.entries(archived.socials).filter(([, url]) => /^https?:\/\//i.test(url));
    return (
      <div className="min-h-screen bg-space-theme text-theme-text-primary flex flex-col items-center justify-center p-4 relative z-0 overflow-hidden">
        <div className="glass-panel w-full max-w-md rounded-3xl p-8 flex flex-col items-center text-center space-y-5 border border-white/20 shadow-2xl backdrop-blur-2xl bg-slate-900/90 text-white">
          <div className="h-14 w-14 rounded-2xl bg-accent/20 border border-accent/30 flex items-center justify-center text-accent">
            <Sparkles className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-black">Thank you for being part of</h1>
            <p className="text-lg font-bold text-accent">{archived.eventName}</p>
            <p className="text-xs text-slate-300 leading-relaxed">
              This event has wrapped up and your pass is now retired. We loved having you with us — follow us on our socials for more exciting events from RTBI.
            </p>
          </div>
          {links.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {links.map(([key, url]) => (
                <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-bold transition-all inline-flex items-center gap-1.5">
                  {labels[key] || key} <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}
          <p className="text-[10.5px] text-slate-500">RTBI • RUAS</p>
        </div>
      </div>
    );
  }

  if (notFound || !pass) {
    return (
      <div className="min-h-screen bg-space-theme text-theme-text-primary flex flex-col items-center justify-center p-4 relative z-0 overflow-hidden">
        <div className="glass-panel w-full max-w-md rounded-3xl p-8 flex flex-col items-center text-center space-y-4 border border-white/20 dark:border-white/15 shadow-2xl backdrop-blur-2xl bg-slate-900/90 text-white">
          <div className="h-14 w-14 rounded-2xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h1 className="text-lg font-bold">Event Pass Not Found</h1>
          <p className="text-xs text-slate-300">
            This event pass does not exist or may have been revoked. Please check your invitation email or contact the event organizers.
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/15 transition-all inline-flex items-center gap-2"
            >
              <span>Return to Centre</span>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const validDays = getPassValidDays(pass);
  const attendance = getPassAttendanceSummary(pass);
  const isCheckedIn = attendance.attended > 0;
  const isCancelled = pass.status === 'Cancelled';
  const isMultiDay = validDays.length > 1;

  return (
    <div className="min-h-screen bg-space-theme text-theme-text-primary flex flex-col items-center p-4 sm:p-6 md:p-8 relative z-0 overflow-x-hidden">
      {/* Top Floating Branding */}
      <div className="w-full max-w-2xl flex items-center justify-between gap-4 mb-4 pb-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-accent/20 border border-accent/30 flex items-center justify-center text-accent">
            <Sparkles className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="text-xs font-black tracking-wider uppercase text-white flex items-center gap-1.5">
              RTBI
              <span className="text-[10px] text-accent font-normal">• RUAS</span>
            </div>
            <p className="text-[10.5px] text-slate-400">Official Digital Turnstile Credential</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isCancelled ? (
            <span className="px-2.5 py-1 rounded-full text-[10.5px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Cancelled
            </span>
          ) : isCheckedIn ? (
            <span className="px-2.5 py-1 rounded-full text-[10.5px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {isMultiDay ? `Checked In (${attendance.attended}/${attendance.total} days)` : 'Checked In'}
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full text-[10.5px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" /> Verified Pass
            </span>
          )}
        </div>
      </div>

      {/* Main 3D Leather Card Holder Presentation */}
      <div className="w-full max-w-2xl flex flex-col items-center justify-center my-2 overflow-visible">
        <EventPassKeycard
          pass={pass}
          theme={theme}
          origin={origin}
          showActions={true}
          autoOpen={false}
          walletError={walletError}
        />
      </div>

      {walletNotice && (
        <div className="w-full max-w-md my-3 p-3 bg-amber-500/15 border border-amber-500/40 rounded-2xl text-amber-200 text-xs font-semibold text-center">
          We couldn&apos;t add this pass to your wallet right now. Please try again in a minute, or use the QR code below.
        </div>
      )}

      {/* Wallet Loading Banner */}
      {walletLoadingMsg && <WalletProgressBar progress={walletProgress.progress} label={walletLoadingMsg} />}

      {/* Actions & Digital Wallet Suite */}
      <div className="w-full max-w-md space-y-3 mt-4">
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={handleAddToAppleWallet}
            disabled={Boolean(walletLoadingMsg)}
            className="py-3 px-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-2xl border border-white/15 transition-all text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
          >
            <Smartphone className="h-4 w-4 text-slate-300" />
            <span>Apple Wallet</span>
          </button>

          <button
            type="button"
            onClick={handleAddToGoogleWallet}
            disabled={Boolean(walletLoadingMsg)}
            className="py-3 px-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-2xl border border-white/15 transition-all text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
          >
            <ExternalLink className="h-4 w-4 text-emerald-400" />
            <span>Google Wallet</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={handleAddToCalendar}
            className="py-2.5 px-3 bg-slate-900/80 hover:bg-slate-800 text-slate-200 font-semibold rounded-xl border border-white/10 transition-all text-xs flex items-center justify-center gap-2 cursor-pointer"
          >
            <Calendar className="h-3.5 w-3.5 text-sky-400" />
            <span>Add to Calendar</span>
          </button>

          <button
            type="button"
            onClick={handleSharePass}
            className="py-2.5 px-3 bg-slate-900/80 hover:bg-slate-800 text-slate-200 font-semibold rounded-xl border border-white/10 transition-all text-xs flex items-center justify-center gap-2 cursor-pointer"
          >
            <Share2 className="h-3.5 w-3.5 text-amber-400" />
            <span>{copiedLink ? 'Link Copied!' : 'Share Pass'}</span>
          </button>
        </div>

        {/* Turnstile Access Summary Card */}
        <div className="glass-panel rounded-2xl p-4 border border-white/10 bg-slate-950/60 backdrop-blur-xl text-white space-y-2.5 mt-4">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 border-b border-white/10 pb-2">
            <span>Event Turnstile Entry Guidelines</span>
            <span className="font-mono text-accent">{pass.serialNumber}</span>
          </div>

          <div className="space-y-1 text-[11.5px] text-slate-300">
            <div className="flex items-start gap-2">
              <MapPin className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />
              <span><strong>Assigned Venue:</strong> {pass.roomOrVenue || pass.eventVenue || 'Main Auditorium'}</span>
            </div>
            <div className="flex items-start gap-2">
              <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span><strong>Date &amp; Schedule:</strong> {validDays.length > 0 ? formatValidDaysLabel(validDays) : pass.validityDate || pass.eventDate || '2026'}</span>
            </div>
            <div className="flex items-start gap-2">
              <QrCode className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <span>Present this QR code or your Apple/Google Wallet pass at official turnstiles for high-speed automated check-in.</span>
            </div>
          </div>
        </div>
      </div>

      <CardQrModal
        isOpen={isQrOpen}
        onClose={() => setIsQrOpen(false)}
        url={passUrl}
        title="Event Admission QR Code"
        subtitle={pass.attendeeName}
      />
    </div>
  );
}
