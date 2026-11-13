'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';

interface SearchableSelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  /** Label shown for the "no filter" option, e.g. "All Students". Pass undefined to omit it. */
  allLabel?: string;
  allValue?: string;
  placeholder?: string;
  className?: string;
  /** Tighter padding/text for dense filter bars (e.g. the Ratings queue). */
  compact?: boolean;
}

/**
 * Filter dropdown with a built-in search box, so a long roster/event list can be
 * narrowed by typing instead of scrolling a plain <select>. Mirrors the "Select
 * Assignee" combobox pattern already used on the Tasks page.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  allLabel,
  allValue = 'ALL',
  placeholder = 'Search...',
  className = '',
  compact = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = allLabel && value === allValue
    ? { value: allValue, label: allLabel }
    : options.find(o => o.value === value);

  const q = query.trim().toLowerCase();
  const filteredOptions = q
    ? options.filter(o => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q))
    : options;

  const handleSelect = (v: string) => {
    onChange(v);
    setQuery('');
    setIsOpen(false);
  };

  return (
    <div className={`relative ${isOpen ? 'z-50' : 'z-10'} ${className}`} ref={ref}>
      <div
        className={`flex items-center bg-theme-background/30 border border-theme-card-border rounded-lg focus-within:border-accent cursor-text ${compact ? 'gap-1.5 px-2 py-1.5' : 'gap-2 px-3 py-2'}`}
        onClick={() => setIsOpen(true)}
      >
        <Search className={`text-theme-text-secondary shrink-0 ${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />
        <input
          type="text"
          value={isOpen ? query : (selected?.label || '')}
          onFocus={() => {
            setQuery('');
            setIsOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          placeholder={placeholder}
          className={`w-full bg-transparent border-0 focus:outline-none focus:ring-0 text-theme-text-primary placeholder-theme-text-secondary ${compact ? 'text-[11px]' : ''}`}
        />
        <ChevronDown className={`text-theme-text-secondary shrink-0 ${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />
      </div>

      {isOpen && (
        <div className={`absolute left-0 right-0 mt-1.5 max-h-60 overflow-y-auto bg-white/95 dark:bg-[#0B1B2E]/98 backdrop-blur-2xl rounded-xl border border-slate-200/90 dark:border-white/20 shadow-2xl z-50 divide-y divide-slate-100 dark:divide-white/10 animate-in fade-in zoom-in-95 duration-150 ${compact ? 'text-[11px]' : ''}`}>
          {allLabel && (
            <button
              type="button"
              onClick={() => handleSelect(allValue)}
              className={`w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-white/10 transition-all cursor-pointer font-medium ${value === allValue ? 'bg-accent/15 text-accent font-bold' : 'text-theme-text-primary'}`}
            >
              {allLabel}
            </button>
          )}
          {filteredOptions.length === 0 ? (
            <div className="text-center py-4 text-theme-text-secondary text-xs">No matches found.</div>
          ) : (
            filteredOptions.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => handleSelect(o.value)}
                className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-white/10 transition-all cursor-pointer ${o.value === value ? 'bg-accent/15 text-accent font-bold' : 'text-theme-text-primary'}`}
              >
                <span className="font-medium text-inherit">{o.label}</span>
                {o.sublabel && <span className="text-theme-text-secondary shrink-0 text-[11px]">{o.sublabel}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
