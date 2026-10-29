// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import * as rt from './runtime';
import { addEventFrame, type AddEventFrameDeps } from './addEventFrame';
import { framesOfEvent } from './groups';
import { prepareUpload } from './upload';
import { makeArt, SINGLE, W, heightFor } from './fixtures';
import type { CustomLayoutArt } from './types';
import type { DecodedImage } from './validate';

let idb: FakeIndexedDB;
const art = (): CustomLayoutArt => ({ blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152, windows: [{ x: 10, y: 10, w: 100, h: 100 }, { x: 10, y: 200, w: 100, h: 100 }], slots: [{ x: 0.01, y: 0.01, w: 0.1, h: 0.1 }, { x: 0.01, y: 0.1, w: 0.1, h: 0.1 }] });
const file = new Blob(['picture'], { type: 'image/png' });
const okPrep: AddEventFrameDeps['prepare'] = async () => ({ ok: true, art: art(), warnings: ['Low resolution.'] });
const real = (prepare: AddEventFrameDeps['prepare'] = okPrep): AddEventFrameDeps => ({ prepare, create: rt.createCustomFrame, setArt: rt.setCustomLayoutArt, remove: rt.deleteCustomFrame });

beforeEach(() => {
  idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); rt.resetCustomRuntime();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake/1'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  Object.defineProperty(globalThis, 'navigator', { value: { storage: { persist: async () => true, persisted: async () => false } }, configurable: true });
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); rt.resetCustomRuntime(); delete (globalThis as any).indexedDB; });

describe('addEventFrame (atomic ADD FRAME)', () => {
  it('a valid picture creates a special frame inside the event with that picture on that layout', async () => {
    await rt.initCustomFrames();
    const r = await addEventFrame({ eventId: 'event-1', name: '  Gala   Night ', layoutId: 'strip-2', file }, real());
    expect(r).toMatchObject({ ok: true, name: 'Gala Night', layoutId: 'strip-2', windows: 2, warnings: ['Low resolution.'] });
    if (!r.ok) throw 0;
    const rec = rt.customRecord(r.frameId)!;
    expect(rec).toMatchObject({ special: true, eventId: 'event-1', name: 'Gala Night' });
    expect(Object.keys(rec.layouts)).toEqual(['strip-2']);
    expect(framesOfEvent(rt.customRecords(), 'event-1')).toHaveLength(1);
    expect(framesOfEvent(rt.customRecords(), 'event-2')).toHaveLength(0);
  });
  it('a rejected picture creates nothing at all (no frame, nothing stored) and returns the readable errors', async () => {
    await rt.initCustomFrames();
    const create = vi.fn(rt.createCustomFrame);
    const r = await addEventFrame({ eventId: 'event-1', name: 'Gala', layoutId: 'single', file }, { ...real(async () => ({ ok: false, errors: ['This picture is too small.'] })), create });
    expect(r).toEqual({ ok: false, errors: ['This picture is too small.'] });
    expect(create).not.toHaveBeenCalled();
    expect(rt.customRecords()).toEqual([]);
    const list = await store.listFrames(); expect(list.ok && list.value).toEqual([]);
  });
  it('a real invalid file (not a picture) goes through prepareUpload and creates nothing', async () => {
    await rt.initCustomFrames();
    const r = await addEventFrame({ eventId: 'event-1', name: 'Gala', layoutId: 'single', file: new Blob(['not a png'], { type: 'image/png' }) }, real(prepareUpload));
    expect(r.ok).toBe(false);
    expect(rt.customRecords()).toEqual([]);
  });
  it('a real valid PNG goes through prepareUpload (decoded with a Node decoder) and is added', async () => {
    await rt.initCustomFrames();
    const fx = makeArt(W, heightFor(SINGLE), SINGLE);
    const decode = async (): Promise<DecodedImage> => ({ width: fx.width, height: fx.height, data: fx.data });
    const r = await addEventFrame({ eventId: 'event-1', name: 'Real', layoutId: 'single', file: new Blob([new Uint8Array(fx.png)], { type: 'image/png' }) }, real((l, f) => prepareUpload(l, f, decode)));
    expect(r).toMatchObject({ ok: true, windows: 1 });
  });
  it('if saving the picture fails, the empty frame is deleted again: no ghost frame stays', async () => {
    await rt.initCustomFrames();
    const r = await addEventFrame({ eventId: 'event-1', name: 'Gala', layoutId: 'single', file }, { ...real(), setArt: async () => ({ ok: false, reason: 'quota', message: store.MESSAGES.quota }) });
    expect(r).toEqual({ ok: false, errors: [store.MESSAGES.quota] });
    expect(rt.customRecords()).toEqual([]);
    const list = await store.listFrames(); expect(list.ok && list.value).toEqual([]);
  });
  it('if saving fails and the cleanup fails too, it says so instead of hiding the leftover frame', async () => {
    await rt.initCustomFrames();
    const r = await addEventFrame({ eventId: 'event-1', name: 'Gala', layoutId: 'single', file }, { ...real(), setArt: async () => ({ ok: false, reason: 'storage', message: store.MESSAGES.storage }), remove: async () => ({ ok: false, reason: 'storage', message: store.MESSAGES.storage }) });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.errors[0]).toBe(store.MESSAGES.storage); expect(r.errors[1]).toContain('DELETE FRAME'); }
  });
  it('a failed create reports its message and never tries to save a picture', async () => {
    const setArt = vi.fn(rt.setCustomLayoutArt);
    const r = await addEventFrame({ eventId: 'event-1', name: 'Gala', layoutId: 'single', file }, { ...real(), create: async () => ({ ok: false, reason: 'unavailable', message: store.MESSAGES.unavailable }), setArt });
    expect(r).toEqual({ ok: false, errors: [store.MESSAGES.unavailable] });
    expect(setArt).not.toHaveBeenCalled();
  });
  it('needs a name, an event and a picture, and checks the picture only after the name', async () => {
    const prepare = vi.fn(okPrep);
    expect(await addEventFrame({ eventId: 'event-1', name: '   ', layoutId: 'single', file }, real(prepare))).toMatchObject({ ok: false });
    expect(await addEventFrame({ eventId: '', name: 'A', layoutId: 'single', file }, real(prepare))).toMatchObject({ ok: false });
    expect(await addEventFrame({ eventId: 'event-1', name: 'A', layoutId: 'single', file: null }, real(prepare))).toMatchObject({ ok: false });
    expect(prepare).not.toHaveBeenCalled();
  });
  it('never throws, even if a step throws', async () => {
    const r = await addEventFrame({ eventId: 'event-1', name: 'A', layoutId: 'single', file }, { ...real(), prepare: async () => { throw new Error('boom'); } });
    expect(r).toMatchObject({ ok: false });
  });
  it('the name is cut to the frame name limit', async () => {
    await rt.initCustomFrames();
    const r = await addEventFrame({ eventId: 'event-1', name: 'x'.repeat(100), layoutId: 'single', file }, real());
    expect(r.ok && r.name).toHaveLength(store.NAME_MAX);
  });
});
