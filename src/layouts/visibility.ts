import { LAYOUTS } from './registry';
import type { LayoutDef } from './types';

/**
 * Owner-chosen picker visibility (ADMIN > Layouts). PURE: no DOM, no storage. The setting stores what is HIDDEN, so a layout added later
 * shows up on its own instead of being silently missing. Display only: ids, frame locking, rendering and printing never read it.
 */
export interface LayoutVisibility { hidden: string[] }

/** Repairs a stored value: non-array -> [], non-strings and unknown ids dropped, duplicates removed (first wins), and if EVERY layout would be hidden -> [] (the booth always offers at least one). */
export function normalizeHidden(raw: unknown, layouts: readonly LayoutDef[] = LAYOUTS): string[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(layouts.map((l) => l.id));
  const out: string[] = [];
  for (const v of raw) if (typeof v === 'string' && known.has(v) && !out.includes(v)) out.push(v);
  return layouts.length > 0 && layouts.every((l) => out.includes(l.id)) ? [] : out;
}

/** The layouts a guest may pick: the list minus hidden ids, order kept. Filter BEFORE grouping so an all-hidden group vanishes. */
export const visibleLayouts = (layouts: readonly LayoutDef[], hidden: readonly string[]): LayoutDef[] => layouts.filter((l) => !hidden.includes(l.id));

/** New hidden list with `ids` shown (show = true) or hidden. Returns the SAME list when the change would hide the last visible layout. */
export function setHidden(hidden: readonly string[], ids: readonly string[], show: boolean, layouts: readonly LayoutDef[] = LAYOUTS): string[] {
  const next = show ? hidden.filter((h) => !ids.includes(h)) : [...hidden, ...ids.filter((i) => !hidden.includes(i))];
  const fixed = normalizeHidden(next, layouts);
  // normalizeHidden turns "everything hidden" into "nothing hidden"; here that means the request was refused, so keep what we had.
  return !show && fixed.length === 0 && next.length > 0 ? [...hidden] : fixed;
}
