'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { SortState } from '@/lib/use-sort';

/** A table header cell that sorts its column when clicked (ascending, descending, then back to default). */
export function SortableTh({
  label,
  columnKey,
  sort,
  onToggle,
  className = 'py-3 px-4',
}: {
  label: React.ReactNode;
  columnKey: string;
  sort: SortState;
  onToggle: (key: string) => void;
  className?: string;
}) {
  const active = sort.key === columnKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={className} aria-sort={!active ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending'}>
      <button
        type="button"
        onClick={() => onToggle(columnKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-[inherit] font-[inherit] cursor-pointer select-none hover:text-theme-text-primary ${active ? 'text-theme-text-primary' : ''}`}
      >
        {label}
        <Icon className={`h-3 w-3 shrink-0 ${active ? 'text-accent' : 'opacity-50'}`} />
      </button>
    </th>
  );
}
