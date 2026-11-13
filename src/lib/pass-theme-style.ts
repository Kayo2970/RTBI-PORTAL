import type { CSSProperties } from 'react';
import { PassTheme, DEFAULT_PASS_THEME } from '@/lib/local-data';

/** Inline style that paints an event's themed artwork (with legibility overlay) on a pass face. */
export function passThemeStyle(theme: PassTheme | undefined | null, fallbackBackground?: string): CSSProperties | undefined {
  if (!theme || (!theme.backgroundUrl && !theme.backgroundColor && !theme.foregroundColor && !theme.labelColor)) {
    return fallbackBackground ? { background: fallbackBackground } : undefined;
  }
  const overlay = typeof theme.overlay === 'number' ? theme.overlay : DEFAULT_PASS_THEME.overlay;
  const color = theme.backgroundColor || DEFAULT_PASS_THEME.backgroundColor;
  const style: Record<string, string> = {
    color: theme.foregroundColor || DEFAULT_PASS_THEME.foregroundColor,
    '--pass-label': theme.labelColor || DEFAULT_PASS_THEME.labelColor,
    '--pass-fg': theme.foregroundColor || DEFAULT_PASS_THEME.foregroundColor,
  };
  if (theme.backgroundUrl) {
    style.background = `linear-gradient(rgba(0,0,0,${overlay}), rgba(0,0,0,${overlay})), url("${theme.backgroundUrl}") center / cover no-repeat, ${color}`;
  } else if (theme.backgroundColor) {
    style.background = `linear-gradient(145deg, ${color} 0%, #030712 100%)`;
  } else if (fallbackBackground) {
    style.background = fallbackBackground;
  }
  return style as CSSProperties;
}
