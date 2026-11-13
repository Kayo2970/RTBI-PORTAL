'use client';

import { useEffect, useState } from 'react';
import { Share, PlusSquare, X } from 'lucide-react';

const DISMISS_KEY = 'ios_install_prompt_dismissed_at';
// Re-offer it a while after a dismissal rather than never again — someone
// who dismisses on a first, unauthenticated visit may not realize the same
// install option is still there once they're using the dashboard daily.
const RESHOW_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function isIos(): boolean {
  const ua = window.navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) return true;
  // iPadOS 13+ reports as "Macintosh" in its UA string but is touch-capable,
  // unlike a real Mac — this is the standard sniff for that case.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function isStandalone(): boolean {
  return (
    (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

/**
 * iOS has no equivalent of Android/Chrome's `beforeinstallprompt` event —
 * Safari never tells the page an install is possible, so without this
 * banner an iOS visitor has no way to discover that "Share → Add to Home
 * Screen" turns this into a full-screen, icon-launched app (see the
 * `appleWebApp` metadata in layout.tsx for the other half of that setup).
 */
export function IosInstallPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isIos() || isStandalone()) return;

    try {
      const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (dismissedAt && Date.now() - dismissedAt < RESHOW_AFTER_MS) return;
    } catch {
      // localStorage unavailable (private mode etc.) — just show it
    }

    const timer = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore — worst case it's offered again next visit
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[60] sm:inset-x-auto sm:right-4 sm:left-4 sm:max-w-sm sm:mx-auto animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="glass-panel rounded-2xl border border-theme-border/20 shadow-2xl p-4 flex items-start gap-3">
        <div className="shrink-0 p-2 rounded-xl bg-accent/15 text-accent border border-accent/20">
          <PlusSquare className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-theme-text-primary">Install this app</p>
          <p className="text-xs text-theme-text-secondary mt-0.5 leading-relaxed">
            Tap <Share className="inline h-3.5 w-3.5 -mt-0.5 mx-0.5" aria-label="Share icon" /> Share, then{' '}
            <span className="font-medium text-theme-text-primary">&quot;Add to Home Screen&quot;</span> for one-tap access, full screen, no browser bar.
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="shrink-0 h-7 w-7 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
