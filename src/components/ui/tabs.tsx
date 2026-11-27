'use client';

import React, { useRef } from 'react';

export interface TabItem { id: string; label: string; count?: number }

/** Accessible tablist (arrow keys / Home / End). Render the panel yourself with role="tabpanel" aria-labelledby={`tab-${id}`}. */
export function Tabs({ items, value, onChange, label }: { items: TabItem[]; value: string; onChange: (id: string) => void; label: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent, idx: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) { e.preventDefault(); const id = items[next].id; onChange(id); refs.current[id]?.focus(); }
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-theme-border">
      {items.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el; }}
            id={`tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`min-h-11 px-4 -mb-px whitespace-nowrap text-sm font-semibold border-b-2 transition-colors ${
              active ? 'border-accent text-theme-text-primary' : 'border-transparent text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-border/20'
            }`}
          >
            {t.label}
            {typeof t.count === 'number' && <span className="ml-2 rounded-full bg-theme-border/30 px-2 py-0.5 text-xs">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
