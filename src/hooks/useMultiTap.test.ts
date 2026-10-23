import { describe, expect, it, vi } from 'vitest';
import { ADMIN_TAP, createMultiTap, NO_TAPS, registerTap, type Tap, type TapState } from './useMultiTap';

const at = (t: number, x = 100, y = 100): Tap => ({ t, x, y });
/** Feed taps one by one; returns which of them fired. */
function run(taps: Tap[]): boolean[] {
  let st: TapState = NO_TAPS;
  return taps.map((tap) => { const r = registerTap(st, tap, ADMIN_TAP); st = r.state; return r.fired; });
}

describe('registerTap (3 quick taps on one spot)', () => {
  it('fires on the third quick tap, not before', () => {
    expect(run([at(0), at(300), at(600)])).toEqual([false, false, true]);
  });
  it('two taps never fire', () => {
    expect(run([at(0), at(300)])).toEqual([false, false]);
  });
  it('a slow third tap resets the count instead of firing', () => {
    expect(run([at(0), at(500), at(500 + ADMIN_TAP.withinMs + 1)])).toEqual([false, false, false]);
    // ...and that late tap counts as the first of a new run
    expect(run([at(0), at(500), at(3000), at(3300), at(3600)])).toEqual([false, false, false, false, true]);
  });
  it('the gap is measured between consecutive taps, so a steady rhythm longer than withinMs in total still works', () => {
    expect(run([at(0), at(1200), at(2400)])).toEqual([false, false, true]);
  });
  it('taps far apart do not count together', () => {
    expect(run([at(0, 100, 100), at(200, 100, 100), at(400, 100 + ADMIN_TAP.maxMovePx + 5, 100)])).toEqual([false, false, false]);
    expect(run([at(0, 100, 100), at(200, 400, 400), at(400, 100, 100)])).toEqual([false, false, false]);
  });
  it('small finger wobble still counts', () => {
    expect(run([at(0, 100, 100), at(200, 110, 95), at(400, 90, 108)])).toEqual([false, false, true]);
  });
  it('a 4th tap after firing starts a new count', () => {
    expect(run([at(0), at(100), at(200), at(300), at(400), at(500)])).toEqual([false, false, true, false, false, true]);
  });
  it('a clock that goes backwards starts over rather than firing', () => {
    expect(run([at(1000), at(1100), at(50)])).toEqual([false, false, false]);
  });
});

describe('createMultiTap', () => {
  it('calls onTrigger once per completed run', () => {
    const fn = vi.fn();
    const tap = createMultiTap(ADMIN_TAP, fn);
    tap(at(0)); tap(at(100));
    expect(fn).not.toHaveBeenCalled();
    tap(at(200));
    expect(fn).toHaveBeenCalledTimes(1);
    tap(at(300)); tap(at(400));
    expect(fn).toHaveBeenCalledTimes(1);
    tap(at(500));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
