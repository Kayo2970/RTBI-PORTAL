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
    <div className="glass-panel rounded-3xl py-14 px-6 text-center space-y-4 border border-slate-200/90 dark:border-white/20 shadow-xl bg-white/95 dark:bg-[#0D1F38]/95 backdrop-blur-2xl my-4 flex flex-col items-center justify-center">
      <div className="p-4 bg-accent/15 border border-accent/30 rounded-2xl text-accent shadow-sm">
        <Icon className="h-7 w-7" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h4 className="text-base font-black text-slate-900 dark:text-white tracking-tight">{title}</h4>
        <p className="text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed">{description}</p>
      </div>
      {actionLabel && onAction && (
        <RippleButton
          onClick={onAction}
          className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent/90 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-accent/25 cursor-pointer uppercase tracking-wider"
        >
          <Plus className="h-4 w-4" />
          <span>{actionLabel}</span>
        </RippleButton>
      )}
    </div>
  );
}
