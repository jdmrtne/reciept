import { cleanName } from '../../frames/custom/store';
import { NAME_REQUIRED } from '../../frames/custom/addEventLayout';
import { isEventLayoutShown, layoutsOfEvent, unassignedEventLayouts, type EventLayoutDef } from '../../frames/custom/eventLayouts';

/**
 * ADMIN > Events > Event layouts: the pure data helpers of the screen (no React, no DOM, no storage).
 * Owner text: plain sentences, no emojis, no dashes. Buttons and notices use the same capital letters as the rest of ADMIN.
 */

export { NAME_REQUIRED };
export const QR_CLEARED = 'The saved QR code spot was cleared because the picture changed. The QR code is placed automatically until a new spot is set.';

/** The problem with a typed name, or null when it can be saved. */
export const nameProblem = (raw: string): string | null => (cleanName(raw) ? null : NAME_REQUIRED);

export const photoCountText = (n: number): string => `${n} ${n === 1 ? 'PHOTO' : 'PHOTOS'}`;
export const stateText = (shown: boolean): string => (shown ? 'SHOWN TO GUESTS' : 'HIDDEN FROM GUESTS');

export interface LayoutTile { id: string; label: string; photos: number; photoText: string; shown: boolean; stateText: string; eventId: string }

export function tileOf(d: EventLayoutDef): LayoutTile {
  const shown = isEventLayoutShown(d), photos = d.art.slots.length;
  return { id: d.id, label: d.name.toUpperCase(), photos, photoText: photoCountText(photos), shown, stateText: stateText(shown), eventId: d.eventId };
}

/** The grid of one event, in creation order. */
export const tilesOfEvent = (defs: readonly EventLayoutDef[], eventId: string): LayoutTile[] => layoutsOfEvent(defs, eventId).map(tileOf);
/** Layouts whose event is gone or empty, in creation order. */
export const looseTiles = (defs: readonly EventLayoutDef[], eventIds: readonly string[]): LayoutTile[] => unassignedEventLayouts(defs, eventIds).map(tileOf);
export const shownCount = (tiles: readonly LayoutTile[]): number => tiles.filter((t) => t.shown).length;

/** Events a layout can move to: every event except the one it is in. */
export function moveTargets<E extends { id: string }>(events: readonly E[], currentEventId: string, nameOf: (e: E) => string): { id: string; label: string }[] {
  return events.filter((e) => e.id !== currentEventId).map((e) => ({ id: e.id, label: nameOf(e).toUpperCase() }));
}

export const deleteLayoutBody = (label: string): string =>
  `${label} and its picture will be removed from this device. A guest who is using it right now gets the default layout. This cannot be undone.`;

export const addedNotice = (label: string, windows: number): string => `LAYOUT ${label} ADDED: ${photoCountText(windows)} FOUND`;
export const toggleNotice = (label: string, on: boolean): string => (on ? `${label} IS SHOWN. THE NEXT GUEST CAN PICK IT` : `${label} IS HIDDEN. GUESTS NO LONGER SEE IT`);

/** Notes after a picture was replaced: the picture warnings, plus a sentence when a saved QR spot had to be dropped. */
export const replaceNotes = (hadQrSpot: boolean, warnings: readonly string[]): string[] => (hadQrSpot ? [...warnings, QR_CLEARED] : [...warnings]);

// ---- EL-6: copy old event frames into layouts (the frames stay as they are) ----
export const OLD_FRAMES_HELP = 'These frames were made before event layouts existed. They still work for guests as before. COPY TO LAYOUTS makes one layout from each picture, hidden at first, and leaves the frame untouched. Press SHOW ALL when the copies look right, then turn the old frame off or delete it in Event frames above.';
export const copySummary = (total: number, done: number): string => `${total} ${total === 1 ? 'PICTURE' : 'PICTURES'}, ${done} ALREADY COPIED`;
export function copiedNotice(created: number, skipped: number, failed: number): string {
  if (created === 0 && failed === 0) return skipped > 0 ? 'NOTHING NEW TO COPY' : 'THIS FRAME HAS NO PICTURES TO COPY';
  const made = `${created} ${created === 1 ? 'LAYOUT' : 'LAYOUTS'} CREATED AND HIDDEN`;
  return failed > 0 ? `${made}. ${failed} COULD NOT BE COPIED, PRESS COPY TO LAYOUTS AGAIN` : `${made}. THE OLD FRAME IS UNCHANGED`;
}
