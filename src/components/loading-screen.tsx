'use client';

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';


interface LoadingScreenProps {
  /** How long the splash stays on screen before onComplete fires, in ms. */
  duration?: number;
  subtitle?: string;
  onComplete?: () => void;
}

/**
 * Full-screen branded splash shown during login and dashboard module transitions
 * with the animated AeroShards WebGPU/WebGL backdrop behind the rotating logo badge.
 */
export function LoadingScreen({ duration = 500, subtitle, onComplete }: LoadingScreenProps) {
  useEffect(() => {
    if (!onComplete) return;
    const timer = setTimeout(onComplete, duration);
    return () => clearTimeout(timer);
  }, [duration, onComplete]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-space-theme overflow-hidden select-none">
      {/* Background Animated AcidSquares WebGL2 Canvas */}
      <div className="absolute inset-0 pointer-events-none z-0 opacity-80 dark:opacity-95">
        
      </div>

      {/* Subtle Frosted Radial Glass Layer */}
      <div className="absolute inset-0 bg-space-theme/40 backdrop-blur-[2px] pointer-events-none z-[1]" />

      {/* Centered Elevated RTBI Logo Badge */}
      <div className="relative z-10 flex flex-col items-center gap-5 animate-splash-logo p-6 rounded-3xl glass-panel border border-white/20 shadow-2xl backdrop-blur-md">
        <div className="relative h-24 w-24 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-4 border-accent/20 border-t-accent animate-spin"></div>
          <img
            src="/images/rtbi-icon.png"
            alt="RTBI Logo"
            className="h-13 w-13 object-contain filter drop-shadow-[0_4px_12px_rgba(54,28,106,0.45)]"
          />
        </div>
        <div className="text-center">
          <h1 className="text-sm font-extrabold tracking-wider uppercase text-theme-text-primary">
            RTBI PORTAL
          </h1>
          {subtitle && (
            <p className="text-xs text-theme-text-secondary mt-1">{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );
}
