import { useMemo } from 'react';
import type { PointerEvent } from 'react';

export interface MultiTapConfig {
  /** Taps needed. */
  taps: number;
  /** Max gap between two taps (ms). A slower tap starts a new count. */
  withinMs: number;
  /** Max distance from the FIRST tap (px). A tap further away starts a new count. */
  maxMovePx: number;
}
export interface Tap { t: number; x: number; y: number }
export interface TapState { count: number; lastT: number; x0: number; y0: number }
export const NO_TAPS: TapState = { count: 0, lastT: 0, x0: 0, y0: 0 };

/** Owner shortcut on the standby screen: 3 quick taps on the same spot. */
export const ADMIN_TAP: MultiTapConfig = { taps: 3, withinMs: 1500, maxMovePx: 40 };

/** Pure counting step (no timers, no DOM) so it can be tested with fake timestamps. After it fires, the next tap starts a new count. */
export function registerTap(state: TapState, tap: Tap, cfg: MultiTapConfig): { state: TapState; fired: boolean } {
  const fresh = state.count === 0 || tap.t - state.lastT > cfg.withinMs || tap.t < state.lastT || Math.hypot(tap.x - state.x0, tap.y - state.y0) > cfg.maxMovePx;
  const next: TapState = fresh ? { count: 1, lastT: tap.t, x0: tap.x, y0: tap.y } : { ...state, count: state.count + 1, lastT: tap.t };
  return next.count >= cfg.taps ? { state: NO_TAPS, fired: true } : { state: next, fired: false };
}

/** Stateful wrapper around registerTap: call the returned function once per tap. */
export function createMultiTap(cfg: MultiTapConfig, onTrigger: () => void): (tap: Tap) => void {
  let state = NO_TAPS;
  return (tap) => {
    const r = registerTap(state, tap, cfg);
    state = r.state;
    if (r.fired) onTrigger();
  };
}

/** Pointer handlers for an invisible hit zone. Taps on the zone never reach the element underneath. */
export function useMultiTap(cfg: MultiTapConfig, onTrigger: () => void) {
  const { taps, withinMs, maxMovePx } = cfg;
  return useMemo(() => {
    const tap = createMultiTap({ taps, withinMs, maxMovePx }, onTrigger);
    return {
      onPointerDown: (e: PointerEvent) => { e.stopPropagation(); tap({ t: e.timeStamp, x: e.clientX, y: e.clientY }); },
      onClick: (e: { stopPropagation: () => void }) => e.stopPropagation()
    };
  }, [taps, withinMs, maxMovePx, onTrigger]);
}
