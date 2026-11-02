import type { CustomFrameDef } from './types';

/**
 * Event ids that stored frames or layouts still point at, whether or not that event still exists. PURE.
 * A NEW event must never get one of these ids: a deleted event's leftovers (an old layout, an old frame) would silently attach themselves
 * to the new event and show up as its own.
 */
export function eventIdsInUse(frames: readonly Pick<CustomFrameDef, 'eventId'>[], layouts: readonly { eventId?: string }[]): string[] {
  const ids = new Set<string>();
  for (const x of [...frames, ...layouts]) if (typeof x.eventId === 'string' && x.eventId) ids.add(x.eventId);
  return [...ids];
}
