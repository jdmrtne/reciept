// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME, FRAMES, PASS_FRAME_ID, STANDARD_FRAMES, frameForLayout, framesForLayout } from './registry';
import { LAYOUTS, PASS_LAYOUTS, STANDARD_LAYOUTS } from '../layouts/registry';
import { frameForLayoutVisible, guestFramesForLayout, hideableFrames, normalizeHidden, setHidden, visibleFrames } from './visibility';

const IDS = STANDARD_FRAMES.map((f) => f.id);

describe('hideableFrames', () => {
  it('is every standard frame in registry order; the NCL pass frame is not hideable', () => {
    expect(hideableFrames().map((f) => f.id)).toEqual(IDS);
    expect(IDS).not.toContain(PASS_FRAME_ID);
  });
});

describe('normalizeHidden', () => {
  it('repairs anything that is not a list of known ids', () => {
    for (const bad of [undefined, null, 'classic-receipt', 5, {}, { 0: 'event' }]) expect(normalizeHidden(bad)).toEqual([]);
  });
  it('drops non-strings, unknown ids, the NCL frame, and duplicates', () => {
    expect(normalizeHidden(['event', 3, null, 'nope', PASS_FRAME_ID, 'event', 'birthday'])).toEqual(['event', 'birthday']);
  });
  it('resets to [] when every standard frame would be hidden (the NCL id does not count); one left is fine', () => {
    expect(normalizeHidden(IDS)).toEqual([]);
    expect(normalizeHidden([...IDS, PASS_FRAME_ID])).toEqual([]);
    expect(normalizeHidden(IDS.slice(1))).toEqual(IDS.slice(1));
  });
});

describe('visibleFrames + setHidden', () => {
  it('keeps order and never filters the locked frame', () => {
    expect(visibleFrames(FRAMES, ['event']).map((f) => f.id)).toEqual(FRAMES.map((f) => f.id).filter((i) => i !== 'event'));
    expect(visibleFrames(FRAMES, [PASS_FRAME_ID]).some((f) => f.id === PASS_FRAME_ID)).toBe(true);
  });
  it('hides, shows, and flips a group', () => {
    expect(setHidden([], ['event'], false)).toEqual(['event']);
    expect(setHidden(['event', 'birthday'], ['event'], true)).toEqual(['birthday']);
    expect(setHidden([], IDS.slice(0, 5), false)).toEqual(IDS.slice(0, 5));
  });
  it('refuses to hide the last visible standard frame (list unchanged)', () => {
    const allButOne = IDS.slice(1);
    expect(setHidden(allButOne, [IDS[0]], false)).toEqual(allButOne);
    expect(setHidden([], IDS, false)).toEqual([]); // hiding everything from scratch is refused too
  });
});

describe('guestFramesForLayout', () => {
  it('nothing hidden = exactly framesForLayout, for every layout', () => {
    for (const l of LAYOUTS) expect(guestFramesForLayout(l.id, [], null).map((f) => f.id), l.id).toEqual(framesForLayout(l.id).map((f) => f.id));
  });
  it('removes hidden frames, keeps order, and keeps the frame the guest currently has even if hidden', () => {
    const hidden = ['event', 'birthday', 'kawaii'];
    const ids = guestFramesForLayout('strip-3', hidden, null).map((f) => f.id);
    expect(ids).toEqual(framesForLayout('strip-3').map((f) => f.id).filter((i) => !hidden.includes(i)));
    const kept = guestFramesForLayout('strip-3', hidden, 'birthday').map((f) => f.id);
    expect(kept).toContain('birthday');
    expect(kept).toEqual(framesForLayout('strip-3').map((f) => f.id).filter((i) => !hidden.includes(i) || i === 'birthday'));
  });
  it('a frame-locked pass layout still offers only the NCL frame', () => {
    for (const l of PASS_LAYOUTS) expect(guestFramesForLayout(l.id, IDS.slice(1), null).map((f) => f.id)).toEqual([PASS_FRAME_ID]);
  });
});

describe('frameForLayoutVisible (fallback frame)', () => {
  it('nothing hidden = identical to frameForLayout for every layout and many current frames', () => {
    for (const l of LAYOUTS) for (const cur of [null, DEFAULT_FRAME, 'event', PASS_FRAME_ID, 'kawaii', 'bogus']) {
      expect(frameForLayoutVisible(l.id, cur, []), `${l.id}/${cur}`).toBe(frameForLayout(l.id, cur));
    }
  });
  it('DEFAULT_FRAME hidden: a guest without a frame gets the first visible allowed frame', () => {
    const first = IDS.find((i) => i !== DEFAULT_FRAME)!;
    for (const l of STANDARD_LAYOUTS) expect(frameForLayoutVisible(l.id, null, [DEFAULT_FRAME]), l.id).toBe(first);
    expect(frameForLayoutVisible('strip-2', null, [DEFAULT_FRAME, first])).toBe(IDS.find((i) => i !== DEFAULT_FRAME && i !== first));
  });
  it('a frame the session already holds is kept, even when hidden', () => {
    expect(frameForLayoutVisible('strip-2', DEFAULT_FRAME, [DEFAULT_FRAME])).toBe(DEFAULT_FRAME);
    expect(frameForLayoutVisible('strip-2', 'event', ['event'])).toBe('event');
  });
  it('pass layouts always get the NCL frame', () => {
    for (const l of PASS_LAYOUTS) expect(frameForLayoutVisible(l.id, null, [DEFAULT_FRAME])).toBe(PASS_FRAME_ID);
  });
});
