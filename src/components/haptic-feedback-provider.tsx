'use client';

import { useEffect } from 'react';
import { triggerHaptic } from '@/lib/haptics';

// Elements a tap on should feel like "a button was pressed".
const INTERACTIVE_SELECTOR =
  'button, [role="button"], a[href], input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"], select';

/**
 * App-wide short vibration on tap, for phones that support the Vibration API
 * (Android Chrome/Edge/Samsung Internet). iOS Safari has no vibrate() support
 * so this is a silent no-op there — mounted globally instead of wired into
 * every button component individually.
 */
export function HapticFeedbackProvider() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;

      const target = e.target as Element | null;
      const interactive = target?.closest(INTERACTIVE_SELECTOR);
      if (!interactive) return;
      if (interactive.hasAttribute('disabled') || interactive.getAttribute('aria-disabled') === 'true') return;

      triggerHaptic('light');
    };

    document.addEventListener('pointerdown', handlePointerDown, { passive: true });
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  return null;
}
