'use client';

import React from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';

export interface TaskErrorToastProps {
  isOpen: boolean;
  message?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  onClose?: () => void;
}

export function TaskErrorToast({
  isOpen,
  message = 'Error in updation of the task, please try again.',
  onRetry,
  onDismiss,
  onClose,
}: TaskErrorToastProps) {
  const handleDismiss = onDismiss || onClose || (() => {});
  if (!isOpen) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300 max-w-sm w-[calc(100vw-2.5rem)]">
      <div className="glass-panel p-4 rounded-2xl bg-slate-900/95 dark:bg-[#0c1a2e]/95 backdrop-blur-xl border border-rose-500/40 shadow-2xl shadow-rose-950/40 flex items-start gap-3.5 text-white">
        <div className="h-9 w-9 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0 mt-0.5">
          <AlertTriangle className="h-4 w-4 text-rose-400" />
        </div>

        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-white tracking-wide">
              Task Update Failed
            </h4>
            <button
              type="button"
              onClick={handleDismiss}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer p-0.5"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <p className="text-[11px] text-slate-300 mt-1 leading-snug">
            {message}
          </p>

          <div className="flex items-center gap-2 mt-3">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-extrabold rounded-lg text-xs transition-all shadow-md shadow-rose-600/30 flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <RefreshCw className="h-3 w-3" />
                Try Again
              </button>
            )}
            <button
              type="button"
              onClick={handleDismiss}
              className="px-2.5 py-1.5 text-slate-400 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TaskErrorToast;
