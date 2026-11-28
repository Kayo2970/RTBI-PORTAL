'use client';

import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Sticky action row (primary action goes last/right, closest to the thumb). */
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** `center` modal or `right` side drawer (better for long forms). */
  placement?: 'center' | 'right';
  /** Disable overlay-click / Esc dismissal (e.g. while saving). */
  dismissible?: boolean;
}

const SIZES = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };

/** Accessible dialog: role=dialog, aria-modal, labelled, Esc to close, focus trap + focus return, scroll lock. */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', placement = 'center', dismissible = true }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) { e.preventDefault(); return; }
      const a = nodes[0];
      const z = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, dismissible]);

  if (!open) return null;
  const isDrawer = placement === 'right';
  return (
    <div
      className={`fixed inset-0 z-[100] bg-black/60 flex ${isDrawer ? 'justify-end' : 'items-end sm:items-center justify-center p-0 sm:p-4'}`}
      onMouseDown={(e) => { if (dismissible && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`bg-theme-card text-theme-text-primary border border-theme-card-border shadow-2xl flex flex-col outline-none w-full animate-in duration-200 ${
          isDrawer
            ? `h-full ${size === 'sm' ? 'max-w-md' : size === 'md' ? 'max-w-xl' : 'max-w-3xl'} slide-in-from-right`
            : `${SIZES[size]} max-h-[92vh] rounded-t-2xl sm:rounded-2xl fade-in zoom-in-95`
        }`}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-theme-border">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold leading-snug">{title}</h2>
            {description && <p id={descId} className="text-sm text-theme-text-secondary mt-0.5">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="h-11 w-11 -mr-2 -mt-1 shrink-0 flex items-center justify-center rounded-xl text-theme-text-secondary hover:bg-theme-border/30">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-theme-border flex flex-wrap items-center justify-end gap-2 bg-theme-card">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer(props: Omit<DialogProps, 'placement'>) {
  return <Dialog {...props} placement="right" />;
}
