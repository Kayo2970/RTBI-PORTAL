'use client';

import React from 'react';
import { X } from 'lucide-react';

export type ChipVariant = 'solid' | 'flat' | 'bordered' | 'dot';
export type ChipColor = 'default' | 'primary' | 'accent' | 'success' | 'warning' | 'danger';
export type ChipSize = 'sm' | 'md' | 'lg';

export interface ChipProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: ChipVariant;
  color?: ChipColor;
  size?: ChipSize;
  avatar?: React.ReactNode;
  startContent?: React.ReactNode;
  endContent?: React.ReactNode;
  onClose?: () => void;
  className?: string;
  children?: React.ReactNode;
}

const COLOR_VARIANTS: Record<ChipColor, Record<ChipVariant, string>> = {
  accent: {
    solid: 'bg-accent text-white border-transparent',
    flat: 'bg-accent/15 text-accent border-accent/30 font-bold',
    bordered: 'border border-accent text-accent bg-transparent',
    dot: 'bg-accent/10 text-accent border-accent/20',
  },
  primary: {
    solid: 'bg-primary text-white border-transparent',
    flat: 'bg-primary/20 text-slate-900 dark:text-white border-primary/30',
    bordered: 'border border-primary text-slate-900 dark:text-white bg-transparent',
    dot: 'bg-primary/15 text-slate-900 dark:text-white border-primary/20',
  },
  default: {
    solid: 'bg-slate-800 text-white border-transparent',
    flat: 'bg-slate-200/90 dark:bg-white/10 text-slate-700 dark:text-slate-300 border-slate-300/80 dark:border-white/15 font-semibold',
    bordered: 'border border-slate-300 dark:border-white/20 text-slate-700 dark:text-slate-300 bg-transparent',
    dot: 'bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10',
  },
  success: {
    solid: 'bg-emerald-600 text-white border-transparent',
    flat: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30 font-bold',
    bordered: 'border border-emerald-500 text-emerald-700 dark:text-emerald-400 bg-transparent',
    dot: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  },
  warning: {
    solid: 'bg-amber-600 text-white border-transparent',
    flat: 'bg-amber-500/15 text-amber-900 dark:text-amber-300 border-amber-500/30 font-bold',
    bordered: 'border border-amber-500 text-amber-700 dark:text-amber-400 bg-transparent',
    dot: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  },
  danger: {
    solid: 'bg-rose-600 text-white border-transparent',
    flat: 'bg-rose-500/15 text-rose-800 dark:text-rose-300 border-rose-500/30 font-bold',
    bordered: 'border border-rose-500 text-rose-700 dark:text-rose-400 bg-transparent',
    dot: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20',
  },
};

const DOT_COLORS: Record<ChipColor, string> = {
  accent: 'bg-accent animate-pulse',
  primary: 'bg-primary',
  default: 'bg-white/60',
  success: 'bg-emerald-500 animate-pulse',
  warning: 'bg-amber-500 animate-pulse',
  danger: 'bg-rose-500 animate-pulse',
};

const SIZES: Record<ChipSize, string> = {
  sm: 'h-6 px-2.5 text-[10px] gap-1 rounded-full',
  md: 'h-7 px-3 text-xs gap-1.5 rounded-full',
  lg: 'h-8 px-3.5 text-sm gap-2 rounded-full',
};

/**
 * HeroUI Chip Component
 * Compact interactive badge element with overflow truncation for responsive displays.
 */
export function Chip({
  variant = 'flat',
  color = 'default',
  size = 'sm',
  avatar,
  startContent,
  endContent,
  onClose,
  className = '',
  children,
  ...props
}: ChipProps) {
  const colorStyle = COLOR_VARIANTS[color]?.[variant] || COLOR_VARIANTS.default.flat;
  const sizeStyle = SIZES[size] || SIZES.sm;
  const dotColor = DOT_COLORS[color] || DOT_COLORS.default;

  return (
    <div
      className={`inline-flex items-center justify-center font-semibold border select-none transition-all max-w-full overflow-hidden ${colorStyle} ${sizeStyle} ${className}`}
      {...props}
    >
      {avatar && <span className="-ml-1 mr-1 shrink-0">{avatar}</span>}
      {variant === 'dot' && <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />}
      {startContent && <span className="shrink-0 mr-1">{startContent}</span>}
      <span className="truncate">{children}</span>
      {endContent && <span className="shrink-0 ml-1">{endContent}</span>}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="ml-1 -mr-1 p-0.5 rounded-full hover:bg-black/20 dark:hover:bg-white/20 transition-colors cursor-pointer shrink-0"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
