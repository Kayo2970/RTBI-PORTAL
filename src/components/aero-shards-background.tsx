'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { GhostFibers } from '@/components/ui/ghost-fibers';

const AeroShards = dynamic(() => import('@/components/AeroShards'), { ssr: false });

export interface AeroShardsBackgroundProps {
  isDark?: boolean;
  className?: string;
  shardColor?: string;
  accentColor?: string;
  count?: number;
  placement?: 'full' | 'left' | 'right' | 'center';
  material?: 'glass' | 'chrome';
  markers?: 'plus' | 'dots';
  depthOfField?: number;
  vignette?: number;
  mouseInteraction?: boolean;
  pulseOnClick?: boolean;
  holdToGather?: boolean;
  spread?: number;
  speed?: number;
}

/**
 * AeroShards Background Component from React Bits
 * Configured with RTBI official brand palette (#361C6A Royal Purple & #E34A21 Vibrant Vermilion).
 * Automatically falls back to WebGL GhostFibers if WebGPU is unsupported on the client device.
 */
export function AeroShardsBackground({
  isDark = false,
  className = '',
  shardColor = '#361C6A',
  accentColor = '#E34A21',
  count = 1250,
  placement = 'full',
  material = 'glass',
  markers = 'plus',
  depthOfField = 0.75,
  vignette = 0.3,
  mouseInteraction = true,
  pulseOnClick = true,
  holdToGather = true,
  spread = 2,
  speed = 2.56,
}: AeroShardsBackgroundProps) {
  const [hasWebGPU, setHasWebGPU] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
      setHasWebGPU(true);
    } else {
      setHasWebGPU(false);
    }
  }, []);

  return (
    <div className={`w-full h-full relative overflow-hidden ${className}`}>
      {hasWebGPU === false ? (
        <GhostFibers
          lineColor={shardColor}
          glowColor={accentColor}
          lightMode={!isDark}
          speed={0.2}
          scale={2}
          rotation={-24}
          rotationSpeed={0.25}
          layers={4}
          waveAmplitude={0.015}
          waveFrequency={3}
          waveSpeed={0.15}
          layerSpeed={0.08}
          twist={0.1}
          twistFrequency={5}
          twistSpeed={1.2}
          lineFrequency={5}
          lineSpacing={2}
          lineSharpness={16}
          glowFalloff={10}
          glowIntensity={1.6}
          brightness={2}
          blueBoost={1.25}
          vignette={0.8}
          grain={0.05}
          dpr={1}
        />
      ) : (
        <AeroShards
          shardColor={shardColor}
          accentColor={accentColor}
          lightMode={!isDark}
          placement={placement}
          material={material}
          markers={markers}
          count={count}
          depthOfField={depthOfField}
          vignette={vignette}
          mouseInteraction={mouseInteraction}
          pulseOnClick={pulseOnClick}
          holdToGather={holdToGather}
          spread={spread}
          speed={speed}
          onError={() => setHasWebGPU(false)}
        />
      )}
    </div>
  );
}

export default AeroShardsBackground;
