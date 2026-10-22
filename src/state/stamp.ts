import type { FrameCtx } from '../frames/types';
import { makeEventCtx } from '../frames/prims';
import { getActiveEvent, loadSettings } from '../config/settings';
import { sessionStore } from './session';

/**
 * ONE stamp per customer (EP-2). It carries the date, time and serial of the moment the customer tapped start, plus the FINAL active event
 * profile captured at that same moment, so Edit, Preview, Print, the colour photo and the GIF all show the same values even if the clock
 * ticks over a minute or the owner's settings change in between. Time zone = the booth device's local clock (nothing is forced).
 */
export const newSessionStamp = (): FrameCtx => makeEventCtx(getActiveEvent(loadSettings()));

/**
 * The session's stamp. Standby always sets it, so a missing one only happens on an unusual entry (recovery, a direct screen jump). In that
 * case ONE stamp is made now and STORED in the session, so every later screen reuses it instead of minting its own.
 */
export function ensureSessionStamp(): FrameCtx {
  const cur = sessionStore.get().stamp;
  if (cur) return cur;
  const stamp = newSessionStamp();
  sessionStore.update({ stamp });
  return stamp;
}
