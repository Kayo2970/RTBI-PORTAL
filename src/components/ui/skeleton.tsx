'use client';

import React from 'react';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Animation variant type:
   * - "shimmer": HeroUI continuous gradient wave (default)
   * - "pulse": Tailwind opacity pulse
   * - "none": Static skeleton placeholder
   */
  animationType?: 'shimmer' | 'pulse' | 'none';
  className?: string;
  children?: React.ReactNode;
}

/**
 * HeroUI Skeleton Component
 * Placeholder element to represent the shape and structure of content while loading.
 */
export function Skeleton({
  animationType = 'shimmer',
  className = '',
  children,
  ...props
}: SkeletonProps) {
  const animationClass =
    animationType === 'shimmer'
      ? 'skeleton--shimmer'
      : animationType === 'pulse'
      ? 'skeleton--pulse'
      : 'skeleton--none';

  return (
    <div
      className={`skeleton ${animationClass} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
