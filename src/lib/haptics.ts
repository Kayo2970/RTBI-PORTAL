'use client';

// Vibration API is only supported on Android (Chrome/Edge/Samsung Internet).
// iOS Safari/WebKit does not implement navigator.vibrate — calls below are a
// silent no-op there, so this is safe to call unconditionally on any device.
export type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: 20,
  heavy: 35,
  success: [10, 30, 10],
  warning: [15, 40, 15],
  error: [20, 50, 20, 50, 20],
};

export function triggerHaptic(pattern: HapticPattern = 'light') {
  if (typeof window === 'undefined') return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;

  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Some browsers throw if vibrate() is called outside a user gesture; ignore.
  }
}
