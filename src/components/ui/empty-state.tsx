'use client';

import { LucideIcon, Plus } from 'lucide-react';
import { RippleButton } from '@/components/ui/ripple-button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="glass-panel rounded-2xl py-12 px-6 text-center space-y-4 my-4 flex flex-col items-center justify-center">
      <div className="p-4 bg-accent/10 border border-accent/30 rounded-2xl text-accent-strong dark:text-accent-soft">
        <Icon className="h-7 w-7" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-lg font-bold text-theme-text-primary">{title}</h2>
        <p className="text-sm text-theme-text-secondary leading-relaxed">{description}</p>
      </div>
      {actionLabel && onAction && (
        <RippleButton
          onClick={onAction}
          className="mt-2 inline-flex items-center gap-2 min-h-11 px-5 bg-accent hover:bg-primary-light text-white text-sm font-bold rounded-xl cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>{actionLabel}</span>
        </RippleButton>
      )}
    </div>
  );
}
