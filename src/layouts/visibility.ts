import { LAYOUTS } from './registry';
import type { LayoutDef } from './types';
import { eventLayoutEnabled } from '../frames/custom/eventRuntime';
import { isEventLayoutId } from '../frames/custom/eventLayouts';

/**
 * Owner-chosen picker visibility (ADMIN > Layouts). PURE: no DOM, no storage. The setting stores what is HIDDEN, so a layout added later
 * shows up on its own instead of being silently missing. Display only: ids, frame locking, rendering and printing never read it.
 */
export interface LayoutVisibility { hidden: string[] }

/** Repairs a stored value: non-array -> [], non-strings and unknown ids dropped, duplicates removed (first wins), and if EVERY layout would be hidden -> [] (the booth always offers at least one). */
export function normalizeHidden(raw: unknown, layouts: readonly LayoutDef[] = LAYOUTS): string[] {
  if (!Array.isArray(raw)) return [];
  // Event layouts (evl-...) have their own SHOWN/HIDDEN flag (EventLayoutDef.enabled) and never live in this list: an evl id is never kept, and event layouts
  // in `layouts` neither count as "known" nor stop the all-hidden repair, so passing allLayouts() gives the same answer as passing the built-in layouts.
  const own = layouts.filter((l) => !isEventLayoutId(l.id));
  const known = new Set(own.map((l) => l.id));
  const out: string[] = [];
  for (const v of raw) if (typeof v === 'string' && known.has(v) && !out.includes(v)) out.push(v);
  return own.length > 0 && own.every((l) => out.includes(l.id)) ? [] : out;
}

/** The layouts a guest may pick: the list minus hidden ids, order kept. Filter BEFORE grouping so an all-hidden group vanishes. */
export const visibleLayouts = (layouts: readonly LayoutDef[], hidden: readonly string[]): LayoutDef[] => layouts.filter((l) => !hidden.includes(l.id));

/**
 * Drops event layouts the owner switched off (their own `enabled` flag, never the hidden list and never the active event). Built-in layouts pass through.
 * `keepId` stays even when switched off (the layout a guest is already editing never vanishes from under them). `isShown` defaults to the event runtime.
 */
export const visibleEventLayouts = (layouts: readonly LayoutDef[], isShown: (id: string) => boolean = eventLayoutEnabled, keepId: string | null = null): LayoutDef[] =>
  layouts.filter((l) => !isEventLayoutId(l.id) || l.id === keepId || isShown(l.id));

/** What the guest picker lists: shown event layouts + built-in layouts not hidden, order kept. Never empty: if nothing is left, the built-in layouts. Filter BEFORE grouping so an all-off group vanishes. */
export function guestLayouts(layouts: readonly LayoutDef[], hidden: readonly string[], isShown: (id: string) => boolean = eventLayoutEnabled): LayoutDef[] {
  const list = visibleLayouts(visibleEventLayouts(layouts, isShown), hidden);
  return list.length ? list : layouts.filter((l) => !isEventLayoutId(l.id));
}

/** New hidden list with `ids` shown (show = true) or hidden. Returns the SAME list when the change would hide the last visible layout. */
export function setHidden(hidden: readonly string[], ids: readonly string[], show: boolean, layouts: readonly LayoutDef[] = LAYOUTS): string[] {
  const next = show ? hidden.filter((h) => !ids.includes(h)) : [...hidden, ...ids.filter((i) => !hidden.includes(i))];
  const fixed = normalizeHidden(next, layouts);
  // normalizeHidden turns "everything hidden" into "nothing hidden"; here that means the request was refused, so keep what we had.
  return !show && fixed.length === 0 && next.length > 0 ? [...hidden] : fixed;
}
