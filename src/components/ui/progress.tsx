'use client';

import React from 'react';

export type ProgressColor = 'default' | 'primary' | 'accent' | 'success' | 'warning' | 'danger';
export type ProgressSize = 'sm' | 'md' | 'lg';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  minValue?: number;
  maxValue?: number;
  label?: string;
  valueLabel?: string;
  showValueLabel?: boolean;
  color?: ProgressColor;
  size?: ProgressSize;
  isIndeterminate?: boolean;
  isStriped?: boolean;
  className?: string;
}

const COLOR_TRACKS: Record<ProgressColor, string> = {
  accent: 'bg-gradient-to-r from-accent via-primary-light to-accent',
  primary: 'bg-gradient-to-r from-primary via-primary-light to-primary',
  default: 'bg-white/60',
  success: 'bg-gradient-to-r from-emerald-500 to-teal-400',
  warning: 'bg-gradient-to-r from-amber-500 to-yellow-400',
  danger: 'bg-gradient-to-r from-rose-500 to-red-400',
};

const SIZES: Record<ProgressSize, string> = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-3.5',
};

/**
 * HeroUI Progress Component
 * Displays the current status of an operation with smooth percentage filling and color themes.
 */
export function Progress({
  value = 0,
  minValue = 0,
  maxValue = 100,
  label,
  valueLabel,
  showValueLabel = false,
  color = 'accent',
  size = 'md',
  isIndeterminate = false,
  isStriped = false,
  className = '',
  ...props
}: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, ((value - minValue) / (maxValue - minValue)) * 100));
  const trackColor = COLOR_TRACKS[color] || COLOR_TRACKS.accent;
  const sizeClass = SIZES[size] || SIZES.md;

  return (
    <div className={`w-full space-y-1.5 ${className}`} {...props}>
      {(label || showValueLabel) && (
        <div className="flex justify-between items-center text-xs font-semibold text-theme-text-primary">
          {label && <span>{label}</span>}
          {showValueLabel && (
            <span className="font-mono text-theme-text-secondary">
              {valueLabel || `${Math.round(percentage)}%`}
            </span>
          )}
        </div>
      )}

      <div className={`w-full ${sizeClass} bg-theme-background/60 rounded-full overflow-hidden border border-white/10 relative`}>
        {isIndeterminate ? (
          <div className={`h-full w-1/3 ${trackColor} rounded-full animate-indeterminate-slide`} />
        ) : (
          <div
            className={`h-full ${trackColor} transition-all duration-300 rounded-full ${
              isStriped ? 'bg-stripes' : ''
            }`}
            style={{ width: `${percentage}%` }}
          />
        )}
      </div>
    </div>
  );
}
