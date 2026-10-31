import { DEFAULT_FRAME, FRAMES, frameForLayout, framesForLayout, isFrameAllowed } from './registry';
import type { FrameDef } from './types';
import { customEnabled, customRecords, isCustomFrameId } from './custom/runtime';

/**
 * Owner-chosen frame visibility (ADMIN > Frames). PURE: no DOM, no storage. Mirrors layouts/visibility.ts: the setting stores what is HIDDEN,
 * so a frame added later shows up on its own. Display only: frame ids, artwork, frame locking, rendering and printing never read it.
 * A frame-locked frame (FrameDef.onlyLayouts, none built in now) is NOT hideable here. Owner-uploaded event special frames have their own ON/OFF switch (ADMIN > Events).
 */
export interface FrameVisibility { hidden: string[] }

/** The frames the owner can switch off: every frame that is not frame-locked, in registry order. */
export const hideableFrames = (frames: readonly FrameDef[] = FRAMES): FrameDef[] => frames.filter((f) => !f.onlyLayouts);

/** Repairs a stored value: non-array -> [], non-strings / unknown / frame-locked ids dropped, duplicates removed, and if EVERY hideable frame would be hidden -> []. */
export function normalizeHidden(raw: unknown, frames: readonly FrameDef[] = FRAMES): string[] {
  if (!Array.isArray(raw)) return [];
  const pool = hideableFrames(frames), known = new Set(pool.map((f) => f.id));
  const out: string[] = [];
  for (const v of raw) if (typeof v === 'string' && known.has(v) && !out.includes(v)) out.push(v);
  return pool.length > 0 && pool.every((f) => out.includes(f.id)) ? [] : out;
}

/** The frames minus hidden ids, order kept. Frame-locked frames are never filtered. */
export const visibleFrames = (frames: readonly FrameDef[], hidden: readonly string[]): FrameDef[] => frames.filter((f) => f.onlyLayouts || !hidden.includes(f.id));

/** New hidden list with `ids` shown (show = true) or hidden. Returns the SAME list (copied) when the change would hide the last visible frame. */
export function setHidden(hidden: readonly string[], ids: readonly string[], show: boolean, frames: readonly FrameDef[] = FRAMES): string[] {
  const next = show ? hidden.filter((h) => !ids.includes(h)) : [...hidden, ...ids.filter((i) => !hidden.includes(i))];
  const fixed = normalizeHidden(next, frames);
  return !show && fixed.length === 0 && next.length > 0 ? [...hidden] : fixed; // "everything hidden" was refused: keep what we had
}

/**
 * The frame tray a guest sees for a layout: framesForLayout minus hidden frames, order kept, BUT the frame the guest currently holds always stays
 * (it never vanishes from under them mid-session). An event special (custom) frame the owner switched OFF is left out the same way. A frame-locked layout has only its own frame.
 */
export const guestFramesForLayout = (layoutId: string, hidden: readonly string[], currentFrameId: string | null, activeEventId?: string): FrameDef[] =>
  framesForLayout(layoutId).filter((f) => f.onlyLayouts || f.id === currentFrameId || (!hidden.includes(f.id) && (!isCustomFrameId(f.id) || (customEnabled(f.id) && specialFrameOfferedFor(f.id, activeEventId)))));

/** An old event special frame is offered only while ITS event is the active one (like event layouts). Own frames, and calls that pass no active event, are unaffected. */
function specialFrameOfferedFor(frameId: string, activeEventId?: string): boolean {
  if (activeEventId === undefined) return true;
  const d = customRecords().find((r) => r.id === frameId);
  return !d || d.special !== true || d.eventId === activeEventId;
}

/**
 * frameForLayout that respects hidden frames. Nothing hidden = EXACTLY frameForLayout. A usable current frame is kept even when hidden (a session
 * that already chose it is never changed); otherwise a locked layout gets its own frame, and everyone else gets DEFAULT_FRAME, or the first
 * visible allowed frame when the default is hidden.
 */
export function frameForLayoutVisible(layoutId: string, current: string | null, hidden: readonly string[], activeEventId?: string): string {
  const base = frameForLayout(layoutId, current);
  if (hidden.length === 0 || base !== DEFAULT_FRAME || !hidden.includes(DEFAULT_FRAME)) return base;
  if (current && isFrameAllowed(current, layoutId) && current === DEFAULT_FRAME) return base; // the guest already holds it
  return guestFramesForLayout(layoutId, hidden, null, activeEventId)[0]?.id ?? base;
}
