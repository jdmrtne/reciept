import type { LayoutDef } from './types';
import { eventLayoutById, eventLayoutRecords } from '../frames/custom/eventRuntime';
import { EVENT_NO_GROUP_ID, isEventLayoutId, toLayoutDef } from '../frames/custom/eventLayouts';

const base = { padding: 24, gap: 16, border: 0, headerHeight: 0, footerHeight: 0, background: '#fff' as const };
const strip = (n: number, id: string, name: string): LayoutDef =>
  ({ ...base, id, name, arrangement: { kind: 'grid', columns: 1, rows: n, slotAspect: 4 / 3 } });

/** Add a layout = add an entry here. The editor/renderer only consume ResolvedLayout. */
export const LAYOUTS: LayoutDef[] = [
  { ...base, id: 'single', name: 'Single', arrangement: { kind: 'grid', columns: 1, rows: 1, slotAspect: 4 / 5 } },
  strip(2, 'strip-2', 'Two Strip'),
  strip(3, 'strip-3', 'Three Strip'),
  strip(4, 'strip-4', 'Four Strip'),
  { ...base, id: 'grid-2x2', name: '2 × 2', arrangement: { kind: 'grid', columns: 2, rows: 2, slotAspect: 1 } },
  { ...base, id: 'classic', name: 'Classic', border: 3, headerHeight: 56, footerHeight: 72,
    arrangement: { kind: 'grid', columns: 1, rows: 4, slotAspect: 4 / 3 } }
];

/** The layouts every ordinary frame works with. (Kept as its own name: the custom-frame validator and the generic suites use it.) */
export const STANDARD_LAYOUTS: LayoutDef[] = LAYOUTS;

/** An event layout id (evl-...) is looked up in the event runtime first; everything else (and an event layout that no longer exists) is exactly as before: the built-in layout, else LAYOUTS[0]. */
export const getLayout = (id: string | null): LayoutDef => {
  if (isEventLayoutId(id)) { const d = eventLayoutById(id); if (d) return toLayoutDef(d, ''); }
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
};

/**
 * Built-in layouts first, then every stored event layout as a LayoutDef whose `group` is its event (layouts/groups.ts turns that into one EVENT SPECIAL card).
 * `groupName` gives the text under the badge (the caller reads settings; this module must not). With `eventIds` (the ids of the events that still exist),
 * layouts of a deleted or missing event are merged into ONE nameless group instead of one indistinguishable card per deleted event. With no event layouts stored the result equals LAYOUTS.
 */
export function allLayouts(groupName?: (eventId: string) => string, eventIds?: readonly string[]): LayoutDef[] {
  const known = eventIds ? new Set(eventIds) : null;
  const events = eventLayoutRecords().map((d) => {
    const l = toLayoutDef(d, groupName?.(d.eventId) ?? '');
    return known && (!d.eventId || !known.has(d.eventId)) ? { ...l, group: { id: EVENT_NO_GROUP_ID, name: '' } } : l;
  });
  return [...LAYOUTS, ...events];
}
