// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME, FRAMES, STANDARD_FRAMES, frameForLayout, framesForLayout } from './registry';
import { LAYOUTS, STANDARD_LAYOUTS } from '../layouts/registry';
import { frameForLayoutVisible, guestFramesForLayout, hideableFrames, normalizeHidden, setHidden, visibleFrames } from './visibility';

const IDS = STANDARD_FRAMES.map((f) => f.id);

describe('hideableFrames', () => {
  it('is every standard frame in registry order', () => {
    expect(hideableFrames().map((f) => f.id)).toEqual(IDS);
  });
});

describe('normalizeHidden', () => {
  it('repairs anything that is not a list of known ids', () => {
    for (const bad of [undefined, null, 'classic-receipt', 5, {}, { 0: 'event' }]) expect(normalizeHidden(bad)).toEqual([]);
  });
  it('drops non-strings, unknown ids (including the id of a removed frame), and duplicates', () => {
    expect(normalizeHidden(['event', 3, null, 'nope', 'ncl-boarding-pass', 'event', 'birthday'])).toEqual(['event', 'birthday']);
  });
  it('resets to [] when every standard frame would be hidden (a stale id does not count); one left is fine', () => {
    expect(normalizeHidden(IDS)).toEqual([]);
    expect(normalizeHidden([...IDS, 'ncl-boarding-pass'])).toEqual([]);
    expect(normalizeHidden(IDS.slice(1))).toEqual(IDS.slice(1));
  });
});

describe('visibleFrames + setHidden', () => {
  it('keeps order', () => {
    expect(visibleFrames(FRAMES, ['event']).map((f) => f.id)).toEqual(FRAMES.map((f) => f.id).filter((i) => i !== 'event'));
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
});

describe('frameForLayoutVisible (fallback frame)', () => {
  it('nothing hidden = identical to frameForLayout for every layout and many current frames', () => {
    for (const l of LAYOUTS) for (const cur of [null, DEFAULT_FRAME, 'event', 'kawaii', 'bogus']) {
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
});

describe('event special (custom) frames and the ON/OFF switch', () => {
  it('an OFF custom frame leaves the guest tray, except for the guest who holds it; ON ones stay', async () => {
    const { FakeIndexedDB } = await import('./custom/fakeIdb');
    const store = await import('./custom/store'), rt = await import('./custom/runtime');
    (globalThis as any).indexedDB = new FakeIndexedDB(); store.resetStore(); rt.resetCustomRuntime();
    const art = { blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png' as const, width: 1152, height: 2000, heightRatio: 2000 / 1152, windows: [{ x: 100, y: 100, w: 900, h: 400 }], slots: [{ x: 0.08, y: 0.08, w: 0.84, h: 0.35 }] };
    const origCreate = URL.createObjectURL; let n = 0;
    URL.createObjectURL = () => `blob:fake/${++n}`;
    try {
      await rt.initCustomFrames();
      const a = await rt.createCustomFrame('Gala'), b = await rt.createCustomFrame('Party');
      if (!a.ok || !b.ok) throw new Error('create');
      await rt.setCustomLayoutArt(a.value.id, 'single', art); await rt.setCustomLayoutArt(b.value.id, 'single', art);
      const ids = (cur: string | null) => guestFramesForLayout('single', [], cur).map((f) => f.id);
      expect(ids(null)).toEqual(expect.arrayContaining([a.value.id, b.value.id]));
      await rt.setCustomEnabled(a.value.id, false);
      expect(ids(null)).not.toContain(a.value.id);
      expect(ids(null)).toContain(b.value.id);
      expect(ids(a.value.id)).toContain(a.value.id); // the frame a guest already holds never vanishes
      expect(framesForLayout('single').map((f) => f.id)).toContain(a.value.id); // still a valid frame, just not offered
    } finally { URL.createObjectURL = origCreate; rt.resetCustomRuntime(); store.resetStore(); delete (globalThis as any).indexedDB; }
  });
});
