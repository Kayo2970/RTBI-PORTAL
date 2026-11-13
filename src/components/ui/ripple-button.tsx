'use client';

import React, { useState, useEffect } from 'react';

export interface RippleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  rippleColor?: string;
  duration?: string;
  className?: string;
  children?: React.ReactNode;
}

interface Ripple {
  x: number;
  y: number;
  size: number;
  key: number;
}

/**
 * MagicUI Ripple Button
 * A button component that creates an expanding radial ripple effect at the exact
 * mouse click coordinates.
 */
export const RippleButton = React.forwardRef<HTMLButtonElement, RippleButtonProps>(
  (
    {
      className = '',
      children,
      onClick,
      rippleColor = 'rgba(255, 255, 255, 0.35)',
      duration = '600ms',
      disabled = false,
      ...props
    },
    ref
  ) => {
    const [buttonRipples, setButtonRipples] = useState<Ripple[]>([]);

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;

      const button = e.currentTarget;
      const rect = button.getBoundingClientRect();
      const left = e.clientX - rect.left;
      const top = e.clientY - rect.top;
      const size = Math.max(rect.width, rect.height) * 2;

      setButtonRipples((prevRipples) => [
        ...prevRipples,
        {
          x: left - size / 2,
          y: top - size / 2,
          size,
          key: Date.now() + Math.random(),
        },
      ]);

      onClick?.(e);
    };

    useEffect(() => {
      if (buttonRipples.length > 0) {
        const lastRipple = buttonRipples[buttonRipples.length - 1];
        const timeout = setTimeout(() => {
          setButtonRipples((prevRipples) =>
            prevRipples.filter((ripple) => ripple.key !== lastRipple.key)
          );
        }, parseInt(duration, 10) || 600);
        return () => clearTimeout(timeout);
      }
    }, [buttonRipples, duration]);

    return (
      <button
        ref={ref}
        disabled={disabled}
        onClick={handleClick}
        className={`relative flex items-center justify-center overflow-hidden cursor-pointer rounded-2xl px-5 py-2.5 font-semibold transition-all select-none active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none ${className}`}
        {...props}
      >
        <span className="relative z-10 flex items-center gap-2">{children}</span>
        <span className="pointer-events-none absolute inset-0">
          {buttonRipples.map((ripple) => (
            <span
              key={ripple.key}
              className="animate-rippling absolute rounded-full opacity-30"
              style={{
                top: `${ripple.y}px`,
                left: `${ripple.x}px`,
                width: `${ripple.size}px`,
                height: `${ripple.size}px`,
                backgroundColor: rippleColor,
                transform: 'scale(0)',
                animationDuration: duration,
              }}
            />
          ))}
        </span>
      </button>
    );
  }
);

RippleButton.displayName = 'RippleButton';
