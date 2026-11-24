'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Rocket, User, CornerDownLeft } from 'lucide-react';
import { ALL_NAV_ITEMS, isNavItemVisible } from './nav-config';
import { getMembers } from '@/lib/local-data';
import { fetchStartups } from '@/lib/incubation/client';

interface Entry { key: string; label: string; sub: string; href: string; kind: 'Page' | 'Startup' | 'Member'; haystack: string }

/**
 * Ctrl/Cmd+K jump-to. Pages come from the nav (so permissions match the sidebar); startups and members come
 * from the same permission-checked sources the pages use (a refused fetch just yields no startups).
 */
export function CommandPalette({ open, onClose, user }: { open: boolean; onClose: () => void; user: any }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [startups, setStartups] = useState<{ id: string; name: string; sector?: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    if (user.tier <= 3) fetchStartups().then((s) => setStartups(s)).catch(() => setStartups([]));
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(t); document.body.style.overflow = prev; };
  }, [open, user.tier]);

  const entries = useMemo<Entry[]>(() => {
    const pages: Entry[] = ALL_NAV_ITEMS.filter((i) => isNavItemVisible(i, user)).map((i) => ({
      key: 'p:' + i.href, label: i.name, sub: 'Page', href: i.href, kind: 'Page', haystack: `${i.name} ${i.keywords ?? ''}`.toLowerCase(),
    }));
    const su: Entry[] = startups.map((s) => ({
      key: 's:' + s.id, label: s.name, sub: `${s.id}${s.sector ? ' · ' + s.sector : ''}`, href: `/dashboard/incubation?startup=${encodeURIComponent(s.id)}`, kind: 'Startup', haystack: `${s.name} ${s.id} ${s.sector ?? ''}`.toLowerCase(),
    }));
    const mem: Entry[] = user.tier === 1
      ? getMembers().map((m) => ({ key: 'm:' + m.id, label: m.name, sub: `${m.role} · ${m.email}`, href: '/dashboard/users', kind: 'Member', haystack: `${m.name} ${m.email} ${m.role}`.toLowerCase() }))
      : [];
    return [...pages, ...su, ...mem];
  }, [open, user, startups]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? entries.filter((e) => q.split(/\s+/).every((w) => e.haystack.includes(w))) : entries.filter((e) => e.kind === 'Page');
    return list.slice(0, 9); // Miller's Law: never more than ~9 rows
  }, [entries, query]);

  useEffect(() => setActive(0), [query]);

  const go = (e: Entry | undefined) => { if (!e) return; onClose(); router.push(e.href); };

  if (!open) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
    else if (e.key === 'Tab') e.preventDefault(); // keep focus in the combobox
  };
  const Icon = (k: Entry['kind']) => (k === 'Startup' ? Rocket : k === 'Member' ? User : Search);

  return (
    <div className="fixed inset-0 z-[150] bg-black/60 flex items-start justify-center p-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Search the portal" className="w-full max-w-xl bg-theme-card border border-theme-card-border rounded-2xl shadow-2xl overflow-hidden" onKeyDown={onKey}>
        <div className="flex items-center gap-3 px-4 border-b border-theme-border">
          <Search className="h-5 w-5 text-theme-text-secondary shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-label="Search pages, startups and people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, startups, people…"
            className="flex-1 h-14 bg-transparent text-base text-theme-text-primary placeholder:text-theme-text-secondary outline-none focus-visible:outline-none"
          />
          <kbd className="hidden sm:inline text-xs text-theme-text-secondary border border-theme-border rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-theme-text-secondary">No results for “{query}”.</li>}
          {results.map((r, i) => {
            const I = Icon(r.kind);
            return (
              <li
                key={r.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(r)}
                className={`flex items-center gap-3 min-h-12 px-3 rounded-xl cursor-pointer ${i === active ? 'bg-primary text-white dark:bg-white/15' : 'text-theme-text-primary'}`}
              >
                <I className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate">{r.label}</span>
                  <span className={`block text-xs truncate ${i === active ? 'text-white/85' : 'text-theme-text-secondary'}`}>{r.sub}</span>
                </span>
                <span className={`text-xs ${i === active ? 'text-white/85' : 'text-theme-text-secondary'}`}>{r.kind}</span>
                {i === active && <CornerDownLeft className="h-4 w-4" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
