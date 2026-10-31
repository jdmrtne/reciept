import { finalText } from '../../config/events';
import type { LayoutDef } from '../../layouts/types';
import type { CustomLayoutArt } from './types';

/**
 * Event layouts: every picture uploaded in an event is its own LAYOUT (its own photo windows), not a frame. PURE: no DOM, no storage,
 * no React. Imports only types and config/events (which imports nothing), so layouts/registry.ts can read the runtime built on top
 * of this file without an import cycle. Design: docs/EVENT-LAYOUTS.md.
 *
 * Group = event: all layouts of one event share `group.id === eventId` (layouts/groups.ts turns that into one EVENT SPECIAL card).
 */

/** Every event layout id starts with this, so it can never equal a built-in layout id ("single", "strip-3" ...) or a "custom-" frame id. */
export const EVENT_LAYOUT_PREFIX = 'evl-';
export const isEventLayoutId = (id: string | null | undefined): boolean => typeof id === 'string' && id.startsWith(EVENT_LAYOUT_PREFIX) && id.length > EVENT_LAYOUT_PREFIX.length;

/** Group id used when a record carries no event id at all (should not happen; keeps the picker's group map well formed). */
export const EVENT_NO_GROUP_ID = 'evl-no-event';

/** One stored event layout: the picture, its windows and the owner's switch. Group membership is only `eventId`. */
export interface EventLayoutDef {
  /** Always starts with EVENT_LAYOUT_PREFIX. */
  id: string;
  /** What the owner called this layout (shown on its card inside the group). */
  name: string;
  /** Id of the `EventProfile` (settings.events) this layout belongs to. The event may have been deleted since: see unassignedEventLayouts. */
  eventId: string;
  createdAt: number;
  updatedAt: number;
  /** Owner's SHOWN/HIDDEN switch for guests. Absent = shown. Never depends on which event is active. */
  enabled?: boolean;
  /** EL-6: set when the layout was copied from an old event special frame, as `frameId:layoutId` of that picture. Lets a second copy skip pictures already copied. */
  convertedFrom?: string;
  /** The picture itself plus its detected windows (slots, heightRatio, optional QR spot). Same shape the custom frames store. */
  art: CustomLayoutArt;
}

/** SHOWN unless the owner switched it off (absent flag = shown). */
export const isEventLayoutShown = (d: Pick<EventLayoutDef, 'enabled'>): boolean => d.enabled !== false;

/**
 * The LayoutDef the rest of the app sees. The art dictates the geometry through the existing MANUAL arrangement (fractions of the art
 * width, heightRatio = art height / width), exactly like a custom frame's art does in resolveFramed: no padding, gap, border, header or footer.
 * `groupName` is the text under the EVENT SPECIAL badge (the event name, or '' when the event is gone).
 */
export function toLayoutDef(def: EventLayoutDef, groupName: string): LayoutDef {
  return {
    id: def.id, name: def.name,
    group: { id: def.eventId || EVENT_NO_GROUP_ID, name: groupName },
    arrangement: { kind: 'manual', heightRatio: def.art.heightRatio, slots: def.art.slots.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })) },
    padding: 0, gap: 0, border: 0, headerHeight: 0, footerHeight: 0, background: '#fff'
  };
}

const byCreation = (a: EventLayoutDef, b: EventLayoutDef) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The layouts of ONE event, in creation order (the order of their cards inside the group). */
export function layoutsOfEvent(defs: readonly EventLayoutDef[], eventId: string): EventLayoutDef[] {
  if (!eventId) return [];
  return defs.filter((d) => d.eventId === eventId).sort(byCreation);
}

/** Layouts that belong to no existing event: an empty `eventId` or one that is no longer in `eventIds` (the event was deleted). They keep working and are listed in ADMIN as unassigned. Creation order. */
export function unassignedEventLayouts(defs: readonly EventLayoutDef[], eventIds: readonly string[]): EventLayoutDef[] {
  const known = new Set(eventIds);
  return defs.filter((d) => !d.eventId || !known.has(d.eventId)).sort(byCreation);
}

/** The text under EVENT SPECIAL: the event's name cleaned with finalText, or '' when the event does not exist (deleted) or has no name. */
export function eventGroupName(eventId: string, events: readonly { id: string; name: string }[]): string {
  const e = events.find((x) => x.id === eventId);
  return e ? finalText(e.name) : '';
}
