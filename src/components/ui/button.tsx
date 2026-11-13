'use client';

import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'solid' | 'flat' | 'bordered' | 'light' | 'shadow';
export type ButtonColor = 'default' | 'primary' | 'accent' | 'success' | 'warning' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  color?: ButtonColor;
  size?: ButtonSize;
  isLoading?: boolean;
  disableRipple?: boolean;
  rippleColor?: string;
  startContent?: React.ReactNode;
  endContent?: React.ReactNode;
  fullWidth?: boolean;
  className?: string;
  children?: React.ReactNode;
}

interface Ripple {
  x: number;
  y: number;
  size: number;
  key: number;
}

const COLOR_VARIANTS: Record<ButtonColor, Record<ButtonVariant, string>> = {
  accent: {
    solid: 'bg-accent text-white hover:bg-primary-light shadow-md shadow-accent/20 border border-accent/40',
    flat: 'bg-accent/15 text-accent hover:bg-accent/25 border border-accent/25',
    bordered: 'border-2 border-accent text-accent hover:bg-accent/10',
    light: 'text-accent hover:bg-accent/10',
    shadow: 'bg-accent text-white shadow-lg shadow-accent/40 hover:bg-primary-light hover:shadow-accent/60',
  },
  primary: {
    solid: 'bg-primary text-white hover:bg-primary-light shadow-md shadow-primary/20 border border-primary/40',
    flat: 'bg-primary/20 text-theme-text-primary hover:bg-primary/30 border border-primary/30',
    bordered: 'border-2 border-primary text-theme-text-primary hover:bg-primary/10',
    light: 'text-theme-text-primary hover:bg-primary/10',
    shadow: 'bg-primary text-white shadow-lg shadow-primary/40 hover:bg-primary-light',
  },
  default: {
    solid: 'bg-white/15 text-theme-text-primary hover:bg-white/25 border border-white/20 shadow-sm',
    flat: 'bg-white/10 text-theme-text-primary hover:bg-white/15 border border-white/10',
    bordered: 'border border-theme-border text-theme-text-primary hover:bg-white/10',
    light: 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-white/10',
    shadow: 'bg-white/15 text-theme-text-primary shadow-md hover:bg-white/25',
  },
  success: {
    solid: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-600/20 border border-emerald-500/40',
    flat: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/25',
    bordered: 'border-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10',
    light: 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10',
    shadow: 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/40 hover:bg-emerald-700',
  },
  warning: {
    solid: 'bg-amber-600 text-white hover:bg-amber-700 shadow-md shadow-amber-600/20 border border-amber-500/40',
    flat: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 border border-amber-500/25',
    bordered: 'border-2 border-amber-500 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10',
    light: 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10',
    shadow: 'bg-amber-600 text-white shadow-lg shadow-amber-600/40 hover:bg-amber-700',
  },
  danger: {
    solid: 'bg-rose-600 text-white hover:bg-rose-700 shadow-md shadow-rose-600/20 border border-rose-500/40',
    flat: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 hover:bg-rose-500/25 border border-rose-500/25',
    bordered: 'border-2 border-rose-500 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10',
    light: 'text-rose-600 dark:text-rose-400 hover:bg-rose-500/10',
    shadow: 'bg-rose-600 text-white shadow-lg shadow-rose-600/40 hover:bg-rose-700',
  },
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-xl',
  md: 'h-10 px-4 text-xs font-semibold gap-2 rounded-2xl',
  lg: 'h-12 px-6 text-sm font-bold gap-2.5 rounded-2xl',
  icon: 'h-9 w-9 p-0 text-sm flex items-center justify-center rounded-xl',
};

/**
 * Button Component with MagicUI Ripple click animation
 */
export function Button({
  variant = 'solid',
  color = 'default',
  size = 'md',
  isLoading = false,
  disableRipple = false,
  rippleColor,
  startContent,
  endContent,
  fullWidth = false,
  disabled = false,
  onClick,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const colorStyle = COLOR_VARIANTS[color]?.[variant] || COLOR_VARIANTS.default.solid;
  const sizeStyle = SIZES[size] || SIZES.md;
  const [ripples, setRipples] = useState<Ripple[]>([]);

  const defaultRippleColor =
    variant === 'solid' || variant === 'shadow'
      ? 'rgba(255, 255, 255, 0.4)'
      : 'rgba(46, 117, 182, 0.25)';

  const activeRippleColor = rippleColor || defaultRippleColor;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || isLoading) return;

    if (!disableRipple) {
      const button = e.currentTarget;
      const rect = button.getBoundingClientRect();
      const left = e.clientX - rect.left;
      const top = e.clientY - rect.top;
      const rippleSize = Math.max(rect.width, rect.height) * 2;

      setRipples((prev) => [
        ...prev,
        {
          x: left - rippleSize / 2,
          y: top - rippleSize / 2,
          size: rippleSize,
          key: Date.now() + Math.random(),
        },
      ]);
    }

    onClick?.(e);
  };

  useEffect(() => {
    if (ripples.length > 0) {
      const last = ripples[ripples.length - 1];
      const timer = setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.key !== last.key));
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [ripples]);

  return (
    <button
      disabled={disabled || isLoading}
      onClick={handleClick}
      className={`relative inline-flex items-center justify-center font-medium select-none overflow-hidden transition-all duration-150 active:scale-[0.97] cursor-pointer disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed ${colorStyle} ${sizeStyle} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
      ) : (
        startContent && <span className="relative z-10 shrink-0">{startContent}</span>
      )}
      <span className="relative z-10 flex items-center gap-2">{children}</span>
      {!isLoading && endContent && <span className="relative z-10 shrink-0">{endContent}</span>}

      {/* Ripple Elements */}
      {!disableRipple && (
        <span className="pointer-events-none absolute inset-0">
          {ripples.map((ripple) => (
            <span
              key={ripple.key}
              className="animate-rippling absolute rounded-full"
              style={{
                top: `${ripple.y}px`,
                left: `${ripple.x}px`,
                width: `${ripple.size}px`,
                height: `${ripple.size}px`,
                backgroundColor: activeRippleColor,
                transform: 'scale(0)',
              }}
            />
          ))}
        </span>
      )}
    </button>
  );
}
