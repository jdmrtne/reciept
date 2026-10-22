import { describe, expect, it } from 'vitest';
import { FRAMES, getFrame, isImageFrame, resolveFramed, vectorFrameOf } from './registry';
import { framePrims, makeCtx, makeEventCtx } from './prims';
import { DEFAULT_EVENT_PROFILE, type EventProfile } from '../config/events';
import type { FrameCtx, Prim } from './types';

/**
 * EP-2 duplicate prevention rests on `FrameDef.prints`. These tests prove the metadata is TRUE without matching rendered strings:
 * change ONE stamp field at a time and see whether the frame's own text reacts. A frame that prints the date reacts to a new date; one
 * that does not, does not. So a flag can neither be missing nor claim something the artwork does not do.
 */
const profile = (o: Partial<EventProfile> = {}): EventProfile => ({ ...DEFAULT_EVENT_PROFILE, details: [], name: 'ALPHA FEST', thankYou: 'ONE', ...o });
const base: FrameCtx = makeEventCtx(profile(), new Date(2026, 9, 2, 13, 35));
const texts = (frameId: string, ctx: FrameCtx) => {
  const f = vectorFrameOf(getFrame(frameId));
  return framePrims(f, resolveFramed('single', frameId), ctx).filter((p): p is Extract<Prim, { k: 'text' }> => p.k === 'text').map((p) => p.text);
};
const differs = (frameId: string, other: FrameCtx) => JSON.stringify(texts(frameId, base)) !== JSON.stringify(texts(frameId, other));

describe('FrameDef.prints matches what every frame really prints', () => {
  for (const f of FRAMES) {
    it(`${f.id} (${isImageFrame(f) ? 'image' : 'vector'})`, () => {
      const p = vectorFrameOf(f).prints ?? {};
      expect(differs(f.id, { ...base, event: 'BETA FEST' }), 'event').toBe(!!p.event);
      expect(differs(f.id, { ...base, date: '2027.01.01' }), 'date').toBe(!!p.date);
      expect(differs(f.id, { ...base, time: '09:09' }), 'time').toBe(!!p.time);
      expect(differs(f.id, { ...base, info: profile({ thankYou: 'TWO' }) }), 'thankYou').toBe(!!p.thankYou);
    });
  }

  it('an image (PNG) frame declares nothing and draws no text of its own, with or without artwork', () => {
    for (const f of FRAMES.filter(isImageFrame)) {
      expect(f.prints, f.id).toBeUndefined();
      expect(texts(f.id, base), f.id).toEqual([]);
    }
  });

  it('only known keys are ever declared', () => {
    for (const f of FRAMES) for (const k of Object.keys(f.prints ?? {})) expect(['event', 'date', 'time', 'thankYou']).toContain(k);
  });
});

describe('{THANKS}: the profile controls the classic receipt thank-you', () => {
  const classic = (ctx: FrameCtx) => texts('classic-receipt', ctx);
  it('prints the profile thank-you', () => expect(classic(makeEventCtx(profile({ thankYou: 'MERCI BEAUCOUP' })))).toContain('MERCI BEAUCOUP'));
  it('keeps the original fixed text when no profile is attached (thumbnails, old callers)', () => expect(classic(makeCtx('PHOTOBOOTH'))).toContain('THANK YOU'));
  it('an owner who cleared it leaves no empty text line behind', () => {
    const t = classic(makeEventCtx(profile({ thankYou: '' })));
    expect(t).not.toContain('');
    expect(t).not.toContain('THANK YOU');
    expect(t).not.toContain('{THANKS}');
  });
  it('with the default profile the classic frame is unchanged from before EP-2', () => {
    const d = new Date(2026, 9, 2, 13, 35);
    const legacy = framePrims(getFrame('classic-receipt'), resolveFramed('single', 'classic-receipt'), makeCtx('PHOTOBOOTH', d));
    const now = framePrims(getFrame('classic-receipt'), resolveFramed('single', 'classic-receipt'), makeEventCtx({ ...DEFAULT_EVENT_PROFILE, details: [] }, d));
    expect(now).toEqual(legacy);
  });
});

describe('makeCtx / session stamp', () => {
  it('formats the device-local date and time of the given moment', () => {
    const c = makeCtx('X', new Date(2026, 9, 2, 3, 5));
    expect([c.date, c.time, c.year]).toEqual(['2026.10.02', '03:05', '2026']);
  });
  it('an invalid Date never prints NaN: it falls back to the current moment', () => {
    const c = makeCtx('X', new Date(NaN));
    expect(c.date).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
    expect(c.time).toMatch(/^\d{2}:\d{2}$/);
    expect(c.serial).toMatch(/^\d{6}$/);
  });
  it('makeEventCtx takes the name and the info from the same profile, and the stamp is deterministic', () => {
    const p = profile({ name: 'MARIA & JOSE' });
    const a = makeEventCtx(p, new Date(2026, 9, 2, 13, 35)), b = makeEventCtx(p, new Date(2026, 9, 2, 13, 35));
    expect(a).toEqual(b);
    expect(a.event).toBe('MARIA & JOSE');
    expect(a.info).toBe(p);
  });
  it('without a profile the ctx has no info key at all (plans stay exactly as before EP-2)', () => {
    expect('info' in makeCtx('X')).toBe(false);
  });
});
