import type { CustomFrameDef } from './types';

/**
 * Event frame groups (ADMIN > Events > Event frames). PURE: no DOM, no storage, no React.
 * A group is not stored anywhere on its own: it is simply "the special frames whose `eventId` is this event".
 * Guests never read this; whether a frame is offered depends only on its own SHOWN switch (frames/visibility.ts).
 */

const byCreation = (a: CustomFrameDef, b: CustomFrameDef) => a.createdAt - b.createdAt;
const idOf = (f: CustomFrameDef): string | null => (typeof f.eventId === 'string' && f.eventId ? f.eventId : null);

/** The event frames of ONE event, in creation order. Normal ("Your own") frames are never included, whatever their fields say. */
export function framesOfEvent(defs: readonly CustomFrameDef[], eventId: string): CustomFrameDef[] {
  if (!eventId) return [];
  return defs.filter((f) => f.special === true && idOf(f) === eventId).sort(byCreation);
}

/** Special frames that belong to no existing event: no `eventId` (made before groups existed) or an `eventId` that is no longer in `eventIds`. Creation order. */
export function unassignedSpecialFrames(defs: readonly CustomFrameDef[], eventIds: readonly string[]): CustomFrameDef[] {
  const known = new Set(eventIds);
  return defs.filter((f) => { const e = idOf(f); return f.special === true && (e === null || !known.has(e)); }).sort(byCreation);
}

/** The layout a group tile shows as its thumbnail: strip-3 when the frame has that art, otherwise its first layout in the owner's usual order, otherwise null (no pictures yet). */
export function thumbLayout(layoutIds: readonly string[], order: readonly string[]): string | null {
  if (layoutIds.includes('strip-3')) return 'strip-3';
  return order.find((l) => layoutIds.includes(l)) ?? null;
}
