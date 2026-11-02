// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import * as rt from './runtime';
import { addOwnFrame, type AddOwnFrameDeps } from './addOwnFrame';
import type { CustomLayoutArt } from './types';

let idb: FakeIndexedDB;
const art = (): CustomLayoutArt => ({ blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152, windows: [{ x: 10, y: 10, w: 100, h: 100 }, { x: 10, y: 300, w: 100, h: 100 }], slots: [{ x: 0.01, y: 0.005, w: 0.09, h: 0.05 }, { x: 0.01, y: 0.15, w: 0.09, h: 0.05 }] });
const file = new Blob(['picture'], { type: 'image/png' });
const okPrep: AddOwnFrameDeps['prepare'] = async () => ({ ok: true, art: art(), warnings: ['Low resolution.'] });
const real = (prepare: AddOwnFrameDeps['prepare'] = okPrep): AddOwnFrameDeps => ({ prepare, create: rt.createCustomFrame, setArt: rt.setCustomLayoutArt, remove: rt.deleteCustomFrame });

beforeEach(() => {
  idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); rt.resetCustomRuntime();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake/1'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  Object.defineProperty(globalThis, 'navigator', { value: { storage: { persist: async () => true, persisted: async () => false } }, configurable: true });
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); rt.resetCustomRuntime(); delete (globalThis as any).indexedDB; });

describe('addOwnFrame (atomic ADD FRAME in ADMIN > Frames > Custom Frames)', () => {
  it('a valid picture creates a NORMAL (not event-special) frame with that picture on that layout, shown to guests', async () => {
    await rt.initCustomFrames();
    const r = await addOwnFrame({ name: '  Summer   Party ', layoutId: 'strip-2', file }, real());
    expect(r).toMatchObject({ ok: true, name: 'Summer Party', layoutId: 'strip-2', windows: 2, warnings: ['Low resolution.'] });
    if (!r.ok) throw 0;
    const rec = rt.customRecord(r.frameId)!;
    expect(rec.name).toBe('Summer Party'); expect(rec.special).toBeFalsy(); expect(rec.eventId).toBeUndefined();
    expect(rt.customIsSpecial(r.frameId)).toBe(false);
    expect(Object.keys(rec.layouts)).toEqual(['strip-2']);
    expect(rt.customEnabled(r.frameId)).toBe(true);
  });
  it('a rejected picture creates nothing at all and returns the readable errors', async () => {
    await rt.initCustomFrames();
    const create = vi.fn(rt.createCustomFrame);
    const r = await addOwnFrame({ name: 'Gala', layoutId: 'single', file }, { ...real(async () => ({ ok: false, errors: ['This picture is too small.'] })), create });
    expect(r).toEqual({ ok: false, errors: ['This picture is too small.'] });
    expect(create).not.toHaveBeenCalled(); expect(rt.customRecords()).toEqual([]);
    const list = await store.listFrames(); expect(list.ok && list.value).toEqual([]);
  });
  it('no name or no picture is refused with a sentence, before anything is checked', async () => {
    await rt.initCustomFrames();
    const prepare = vi.fn(okPrep);
    expect(await addOwnFrame({ name: '   ', layoutId: 'single', file }, real(prepare))).toMatchObject({ ok: false, errors: [expect.stringContaining('Type a name')] });
    expect(await addOwnFrame({ name: 'Gala', layoutId: 'single', file: null }, real(prepare))).toMatchObject({ ok: false, errors: [expect.stringContaining('Choose a picture')] });
    expect(prepare).not.toHaveBeenCalled(); expect(rt.customRecords()).toEqual([]);
  });
  it('if saving the picture fails, the new empty frame is deleted again (no NO PICTURES ghost tile)', async () => {
    await rt.initCustomFrames();
    const r = await addOwnFrame({ name: 'Gala', layoutId: 'single', file }, { ...real(), setArt: async () => ({ ok: false, message: 'Storage is full.' }) as any });
    expect(r).toEqual({ ok: false, errors: ['Storage is full.'] });
    expect(rt.customRecords()).toEqual([]); expect(rt.customFrameDefs()).toEqual([]);
  });
  it('if even the clean-up fails, it says how to finish by hand', async () => {
    await rt.initCustomFrames();
    const r = await addOwnFrame({ name: 'Gala', layoutId: 'single', file }, { ...real(), setArt: async () => ({ ok: false, message: 'Storage is full.' }) as any, remove: async () => ({ ok: false, message: 'x' }) as any });
    expect(r).toMatchObject({ ok: false }); if (r.ok) throw 0;
    expect(r.errors[0]).toBe('Storage is full.'); expect(r.errors[1]).toContain('DELETE FRAME');
  });
  it('an unexpected error becomes a plain sentence and never throws', async () => {
    await rt.initCustomFrames();
    expect(await addOwnFrame({ name: 'Gala', layoutId: 'single', file }, real(async () => { throw new Error('boom'); }))).toEqual({ ok: false, errors: ['The frame could not be saved. Please try again.'] });
  });
  it('two frames with the same name are both kept (each is its own tile in the grid)', async () => {
    await rt.initCustomFrames();
    const a = await addOwnFrame({ name: 'Gala', layoutId: 'single', file }, real()), b = await addOwnFrame({ name: 'gala', layoutId: 'single', file }, real());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw 0;
    expect(a.frameId).not.toBe(b.frameId); expect(rt.customRecords()).toHaveLength(2);
  });
});
