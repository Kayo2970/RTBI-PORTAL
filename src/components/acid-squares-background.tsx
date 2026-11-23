'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import type { AcidSquaresProps } from '@/components/AcidSquares';

const AcidSquares = dynamic(() => import('@/components/AcidSquares'), { ssr: false });

export interface AcidSquaresBackgroundProps extends Partial<AcidSquaresProps> {
  isDark?: boolean;
  className?: string;
}

/**
 * AcidSquares Background Component from React Bits
 * Features 3D WebGL2 responsive grid with wave swells, interactive ripple pulses, and dynamic split lighting.
 */
export function AcidSquaresBackground({
  isDark = true,
  className = '',
  color = '#120f17',
  accentColor = '#ff4fb8',
  secondaryColor = '#3b6bff',
  tileSize = 1,
  gap = 0.12,
  roundness = 0.25,
  rotation = 35,
  waves = 1,
  pulse = 1,
  lighting = 'split',
  tilt = 0.7,
  grain = 0.12,
  intro = true,
  mouseInteraction = true,
  pulseOnClick = true,
  ...rest
}: AcidSquaresBackgroundProps) {
  const effectiveColor = !isDark ? '#e8e5ef' : color;
  const effectiveLightMode = !isDark;

  return (
    <div className={`w-full h-full relative overflow-hidden ${className}`}>
      <AcidSquares
        color={effectiveColor}
        accentColor={accentColor}
        secondaryColor={secondaryColor}
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
