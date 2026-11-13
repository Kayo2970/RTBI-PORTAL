import { useState } from 'react';

export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: string | null;
  dir: SortDir;
}
/** Maps a column key to the value that column sorts by. */
export type SortGetters<T> = Record<string, (row: T) => unknown>;

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}/;

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  const sa = String(a);
  const sb = String(b);
  if (ISO_LIKE.test(sa) && ISO_LIKE.test(sb)) {
    const ta = Date.parse(sa);
    const tb = Date.parse(sb);
    if (!isNaN(ta) && !isNaN(tb)) return ta - tb;
  }
  // numeric: "Pass 2" sorts before "Pass 10"
  return sa.localeCompare(sb, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Stable sort of `rows` by one column. Empty values always go last, whichever direction is chosen.
 * With no key (or an unknown one) the original order is returned unchanged.
 */
export function sortRows<T>(rows: T[], getters: SortGetters<T>, sort: SortState): T[] {
  const get = sort.key ? getters[sort.key] : undefined;
  if (!get) return rows;
  const factor = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: get(row) }))
    .sort((x, y) => {
      const ex = isEmpty(x.value);
      const ey = isEmpty(y.value);
      if (ex || ey) return ex === ey ? x.index - y.index : ex ? 1 : -1;
      return compareValues(x.value, y.value) * factor || x.index - y.index;
    })
    .map((x) => x.row);
}

/** Next state when a column header is clicked: ascending, then descending, then back to the default order. */
export function nextSort(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return { key: null, dir: 'asc' };
}

/** Sort state for a table. `apply(rows, getters)` returns the rows in the chosen order. */
export function useSort() {
  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  return {
    sort,
    toggle: (key: string) => setSort((s) => nextSort(s, key)),
    apply: <T,>(rows: T[], getters: SortGetters<T>) => sortRows(rows, getters, sort),
  };
}
