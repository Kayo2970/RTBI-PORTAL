'use client';

import React from 'react';
import { ParticleCard } from './magic-bento';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'shadow' | 'bordered' | 'flat';
  isHoverable?: boolean;
  isPressable?: boolean;
  isMagic?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function Card({
  variant = 'shadow',
  isHoverable = false,
  isPressable = false,
  isMagic = false,
  className = '',
  children,
  ...props
}: CardProps) {
  const variantStyles =
    variant === 'bordered'
      ? 'border-2 border-theme-border/60 dark:border-white/20 bg-white/90 dark:bg-[#0E2038]/90 backdrop-blur-xl shadow-sm'
      : variant === 'flat'
      ? 'bg-white/85 dark:bg-[#0E2038]/85 border border-theme-border/40 dark:border-white/20 backdrop-blur-xl shadow-lg'
      : 'glass-panel shadow-2xl border border-white/40 dark:border-white/20 bg-white/85 dark:bg-[#0E2038]/85 backdrop-blur-2xl';

  const hoverStyle =
    isHoverable && !isMagic
      ? 'hover:-translate-y-1 hover:shadow-2xl hover:border-accent/30 transition-all duration-200'
      : '';

  const pressStyle = isPressable
    ? 'cursor-pointer active:scale-[0.98] transition-transform duration-100'
    : '';

  if (isMagic) {
    return (
      <ParticleCard
        className={`rounded-3xl overflow-hidden ${variantStyles} ${pressStyle} ${className}`}
        {...props}
      >
        {children}
      </ParticleCard>
    );
  }

  return (
    <div
      className={`rounded-3xl overflow-hidden ${variantStyles} ${hoverStyle} ${pressStyle} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

export function CardHeader({ className = '', children, ...props }: CardHeaderProps) {
  return (
    <div className={`p-5 md:p-6 pb-3 flex items-center justify-between gap-3 ${className}`} {...props}>
      {children}
    </div>
  );
}

export interface CardBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

export function CardBody({ className = '', children, ...props }: CardBodyProps) {
  return (
    <div className={`p-5 md:p-6 pt-2 flex-1 ${className}`} {...props}>
      {children}
    </div>
  );
}

export interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

export function CardFooter({ className = '', children, ...props }: CardFooterProps) {
  return (
    <div className={`p-4 md:p-6 pt-3 border-t border-theme-border/20 flex items-center justify-between gap-3 bg-white/[0.02] ${className}`} {...props}>
      {children}
    </div>
  );
}

Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;
