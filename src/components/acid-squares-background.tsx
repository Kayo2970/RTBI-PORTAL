'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { AcidSquaresProps } from '@/components/AcidSquares';

const AcidSquares = dynamic(() => import('@/components/AcidSquares'), { ssr: false });

export interface AcidSquaresBackgroundProps extends Partial<AcidSquaresProps> {
  isDark?: boolean;
  className?: string;
}

/**
 * AcidSquares Background Component from React Bits
 * Configured to match the official Ramaiah Technology Business Incubator (RTBI) Portal theme:
 * Deep Royal Plum (#160B2C), Vibrant Vermilion Accent (#E34A21), and Royal Purple Highlights (#6B2D8C).
 */
export function AcidSquaresBackground({
  isDark: isDarkProp,
  className = '',
  color,
  accentColor,
  secondaryColor,
  tileSize = 1,
  gap = 0.12,
  roundness = 0.25,
  rotation = 35,
  waves = 1,
  pulse = 1,
  lighting = 'split',
  tilt = 0.7,
  grain = 0.08,
  intro = true,
  mouseInteraction = true,
  pulseOnClick = true,
  ...rest
}: AcidSquaresBackgroundProps) {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof isDarkProp === 'boolean') return isDarkProp;
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return true;
  });

  useEffect(() => {
    if (typeof isDarkProp === 'boolean') {
      setIsDarkMode(isDarkProp);
      return;
    }
    const updateTheme = () => {
      if (typeof document !== 'undefined') {
        setIsDarkMode(document.documentElement.classList.contains('dark'));
      }
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [isDarkProp]);

  // Exact matching colors from globals.css:
  // Dark: --background is #160B2C, --accent is #E34A21, --color-primary is #361C6A (with #6B2D8C for specular light)
  // Light: --background is #FAF6EF, --accent is #E34A21, --color-primary is #361C6A
  const effectiveColor = color ?? (isDarkMode ? '#160B2C' : '#FAF6EF');
  const effectiveAccent = accentColor ?? '#E34A21';
  const effectiveSecondary = secondaryColor ?? (isDarkMode ? '#6B2D8C' : '#361C6A');
  const effectiveLightMode = !isDarkMode;

  return (
    <div className={`w-full h-full relative overflow-hidden ${className}`}>
      <AcidSquares
        color={effectiveColor}
        accentColor={effectiveAccent}
        secondaryColor={effectiveSecondary}
        tileSize={tileSize}
        gap={gap}
        roundness={roundness}
        rotation={rotation}
        waves={waves}
        pulse={pulse}
        lighting={lighting}
        tilt={tilt}
        grain={grain}
        intro={intro}
        mouseInteraction={mouseInteraction}
        pulseOnClick={pulseOnClick}
        lightMode={effectiveLightMode}
        {...rest}
      />
    </div>
  );
}

export default AcidSquaresBackground;
