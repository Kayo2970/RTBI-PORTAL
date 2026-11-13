'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
export type AvatarColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';

interface AvatarContextValue {
  size: AvatarSize;
  color: AvatarColor;
  imageLoaded: boolean;
  setImageLoaded: (loaded: boolean) => void;
  imageError: boolean;
  setImageError: (err: boolean) => void;
}

const AvatarContext = createContext<AvatarContextValue | null>(null);

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: AvatarSize;
  color?: AvatarColor;
  src?: string;
  name?: string;
  alt?: string;
  className?: string;
  children?: React.ReactNode;
}

export function Avatar({
  size = 'md',
  color = 'accent',
  src,
  name,
  alt,
  className = '',
  children,
  ...props
}: AvatarProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const initials = name
    ? name
        .split(' ')
        .filter(Boolean)
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'U';

  const sizeClass =
    size === 'sm'
      ? 'avatar--sm'
      : size === 'lg'
      ? 'avatar--lg'
      : size === 'xl'
      ? 'avatar--xl'
      : 'avatar--md';

  return (
    <AvatarContext.Provider
      value={{ size, color, imageLoaded, setImageLoaded, imageError, setImageError }}
    >
      <div className={`avatar ${sizeClass} ${className}`} {...props}>
        {children ? (
          children
        ) : (
          <>
            {src && !imageError && (
              <AvatarImage src={src} alt={alt || name || 'Avatar'} />
            )}
            {(!src || imageError || !imageLoaded) && (
              <AvatarFallback>{initials}</AvatarFallback>
            )}
          </>
        )}
      </div>
    </AvatarContext.Provider>
  );
}

export interface AvatarImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt?: string;
  className?: string;
}

export function AvatarImage({ src, alt = 'Avatar', className = '', ...props }: AvatarImageProps) {
  const ctx = useContext(AvatarContext);

  return (
    <img
      src={src}
      alt={alt}
      onLoad={() => ctx?.setImageLoaded(true)}
      onError={() => ctx?.setImageError(true)}
      className={`avatar__image ${className}`}
      {...props}
    />
  );
}

export interface AvatarFallbackProps extends React.HTMLAttributes<HTMLDivElement> {
  delayMs?: number;
  color?: AvatarColor;
  className?: string;
  children?: React.ReactNode;
}

export function AvatarFallback({
  delayMs,
  color: overrideColor,
  className = '',
  children,
  ...props
}: AvatarFallbackProps) {
  const ctx = useContext(AvatarContext);
  const color = overrideColor || ctx?.color || 'default';
  const [canShow, setCanShow] = useState(!delayMs);

  useEffect(() => {
    if (!delayMs) return;
    const timer = setTimeout(() => setCanShow(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  if (!canShow) return null;

  const colorClass = `avatar__fallback--${color}`;

  return (
    <div className={`avatar__fallback ${colorClass} ${className}`} {...props}>
      {children}
    </div>
  );
}

export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  max?: number;
  className?: string;
  children?: React.ReactNode;
}

export function AvatarGroup({ max, className = '', children, ...props }: AvatarGroupProps) {
  const childArray = React.Children.toArray(children);
  const showCount = max && max > 0 ? childArray.slice(0, max) : childArray;
  const remaining = max && childArray.length > max ? childArray.length - max : 0;

  return (
    <div className={`flex items-center -space-x-2.5 overflow-hidden ${className}`} {...props}>
      {showCount.map((child, idx) => (
        <div key={idx} className="relative ring-2 ring-background rounded-full transition-transform hover:z-10 hover:scale-105">
          {child}
        </div>
      ))}
      {remaining > 0 && (
        <div className="avatar avatar--sm avatar__fallback avatar__fallback--default ring-2 ring-background font-mono text-[10px] font-bold">
          +{remaining}
        </div>
      )}
    </div>
  );
}

Avatar.Image = AvatarImage;
Avatar.Fallback = AvatarFallback;
Avatar.Group = AvatarGroup;
