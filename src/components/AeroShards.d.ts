import React from 'react';

export interface AeroShardsProps {
  shardColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  lightMode?: boolean;
  placement?: 'full' | 'left' | 'right' | 'center';
  material?: 'glass' | 'chrome';
  count?: number;
  shardSize?: number;
  spread?: number;
  twist?: number;
  billow?: number;
  speed?: number;
  scale?: number;
  depthOfField?: number;
  glow?: number;
  grain?: number;
  vignette?: number;
  intro?: boolean;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  markers?: 'plus' | 'dots';
  pulseOnClick?: boolean;
  holdToGather?: boolean;
  parallax?: number;
  paused?: boolean;
  dpr?: number;
  className?: string;
  style?: React.CSSProperties;
  onError?: (err: Error) => void;
}

export default function AeroShards(props: AeroShardsProps): React.JSX.Element;
export function AeroShards(props: AeroShardsProps): React.JSX.Element;
