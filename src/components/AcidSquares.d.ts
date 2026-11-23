import React from 'react';

export interface AcidSquaresProps {
  color?: string;
  accentColor?: string;
  secondaryColor?: string;
  tileSize?: number;
  gap?: number;
  roundness?: number;
  softness?: number;
  bulge?: number;
  rotation?: number;
  gloss?: number;
  waves?: number;
  waveScale?: number;
  speed?: number;
  shape?: 'square' | 'round';
  pulse?: number;
  pulseSpeed?: number;
  pulseSpacing?: number;
  pulseWidth?: number;
  pulseOrigin?: 'center' | 'random';
  lighting?: 'split' | 'backlit' | 'overhead';
  brightness?: number;
  tilt?: number;
  zoom?: number;
  depth?: number;
  grain?: number;
  fade?: number;
  opacity?: number;
  intro?: boolean;
  mouseInteraction?: boolean;
  hoverEffect?: 'press' | 'lift' | 'none';
  mouseStrength?: number;
  mouseRadius?: number;
  pulseOnClick?: boolean;
  detail?: 'low' | 'medium' | 'high';
  lightMode?: boolean;
  paused?: boolean;
  dpr?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function AcidSquares(props: AcidSquaresProps): React.JSX.Element;
export function AcidSquares(props: AcidSquaresProps): React.JSX.Element;
