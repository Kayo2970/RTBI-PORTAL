'use client';

import React from 'react';
import { AcidSquaresBackground, type AcidSquaresBackgroundProps } from '@/components/acid-squares-background';

export interface AeroShardsBackgroundProps extends AcidSquaresBackgroundProps {
  shardColor?: string;
  count?: number;
  placement?: string;
  material?: string;
  markers?: string;
  depthOfField?: number;
  vignette?: number;
  holdToGather?: boolean;
  spread?: number;
  speed?: number;
}

/**
 * AeroShardsBackground wrapper
 * Updated to render AcidSquares from React Bits matching the RTBI Portal interface colors.
 */
export function AeroShardsBackground({
  isDark = true,
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
  shardColor,
  ...rest
}: AeroShardsBackgroundProps) {
  return (
    <AcidSquaresBackground
      isDark={isDark}
      className={className}
      color={color}
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
      {...rest}
    />
  );
}

export { AcidSquaresBackground };
export default AeroShardsBackground;
