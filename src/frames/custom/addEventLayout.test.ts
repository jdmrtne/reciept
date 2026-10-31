// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import * as ev from './eventRuntime';
import { addEventLayout, type AddEventLayoutDeps } from './addEventLayout';
import { prepareEventLayoutUpload } from './upload';
import { layoutsOfEvent } from './eventLayouts';
import { makeArt, STRIP, SINGLE, W, heightFor } from './fixtures';
import type { CustomLayoutArt } from './types';
import type { DecodedImage } from './validate';

let idb: FakeIndexedDB;
const art = (windows = 2): CustomLayoutArt => ({
  blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152,
  windows: Array.from({ length: windows }, (_, i) => ({ x: 10, y: 10 + i * 200, w: 100, h: 100 })),
  slots: Array.from({ length: windows }, (_, i) => ({ x: 0.01, y: 0.01 + i * 0.1, w: 0.1, h: 0.1 }))
});
const file = new Blob(['picture'], { type: 'image/png' });
const okPrep: AddEventLayoutDeps['prepare'] = async () => ({ ok: true, art: art(), warnings: ['Low resolution.'] });
const real = (prepare: AddEventLayoutDeps['prepare'] = okPrep): AddEventLayoutDeps => ({ prepare, create: ev.createEventLayoutRecord });
const nodePrep = (fx: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): AddEventLayoutDeps['prepare'] => (f) => prepareEventLayoutUpload(f, async (): Promise<DecodedImage> => ({ width: fx.width, height: fx.height, data: fx.data }));
const png = (fx: { png: Buffer }) => new Blob([new Uint8Array(fx.png)], { type: 'image/png' });
const stored = async () => { const r = await store.listEventLayouts(); return r.ok ? r.value : []; };

beforeEach(() => {
  idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); ev.resetEventRuntime();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake/1'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); ev.resetEventRuntime(); delete (globalThis as any).indexedDB; });

describe('addEventLayout (atomic ADD LAYOUT)', () => {
  it('a valid picture creates one layout inside the event, with its picture, in the store and in memory', async () => {
    await ev.initEventLayouts();
    const r = await addEventLayout({ eventId: 'event-1', name: '  Gala   Night ', file }, real());
    expect(r).toMatchObject({ ok: true, name: 'Gala Night', eventId: 'event-1', windows: 2, warnings: ['Low resolution.'] });
    if (!r.ok) throw 0;
    expect(r.layoutId.startsWith('evl-')).toBe(true);
    const rec = ev.eventLayoutById(r.layoutId)!;
    expect(rec).toMatchObject({ name: 'Gala Night', eventId: 'event-1' });
    expect(rec.art.slots).toHaveLength(2);
    expect(ev.eventLayoutAsset(r.layoutId)).not.toBeNull();
    expect(layoutsOfEvent(ev.eventLayoutRecords(), 'event-1')).toHaveLength(1);
    expect(layoutsOfEvent(ev.eventLayoutRecords(), 'event-2')).toHaveLength(0);
    const list = await stored(); expect(list.map((d) => d.id)).toEqual([r.layoutId]);
  });
  it('every upload is its own layout: two pictures in one event give two layouts, a third goes to another event', async () => {
    await ev.initEventLayouts();
    await addEventLayout({ eventId: 'event-1', name: 'One', file }, real());
    await addEventLayout({ eventId: 'event-1', name: 'Two', file }, real());
    await addEventLayout({ eventId: 'event-2', name: 'Three', file }, real());
    expect(layoutsOfEvent(ev.eventLayoutRecords(), 'event-1').map((d) => d.name)).toEqual(['One', 'Two']);
    expect(layoutsOfEvent(ev.eventLayoutRecords(), 'event-2').map((d) => d.name)).toEqual(['Three']);
    expect(new Set(ev.eventLayoutRecords().map((d) => d.id)).size).toBe(3);
  });
  it('a rejected picture creates nothing at all and returns the readable errors', async () => {
    await ev.initEventLayouts();
    const create = vi.fn(ev.createEventLayoutRecord);
    const r = await addEventLayout({ eventId: 'event-1', name: 'Gala', file }, { ...real(async () => ({ ok: false, errors: ['This picture is too small.'] })), create });
    expect(r).toEqual({ ok: false, errors: ['This picture is too small.'] });
    expect(create).not.toHaveBeenCalled();
    expect(ev.eventLayoutRecords()).toEqual([]);
    expect(await stored()).toEqual([]);
  });
  it('a file that is not a picture goes through the real check and creates nothing', async () => {
    await ev.initEventLayouts();
    const r = await addEventLayout({ eventId: 'event-1', name: 'Gala', file: new Blob(['not a png'], { type: 'image/png' }) }, real(prepareEventLayoutUpload));
    expect(r.ok).toBe(false);
    expect(ev.eventLayoutRecords()).toEqual([]);
    expect(await stored()).toEqual([]);
  });
  it('a real PNG with three windows becomes a layout with three photo windows (no standard layout needed)', async () => {
    await ev.initEventLayouts();
    const fx = makeArt(W, heightFor(STRIP(3)), STRIP(3));
    const r = await addEventLayout({ eventId: 'event-1', name: 'Real', file: png(fx) }, real(nodePrep(fx)));
    expect(r).toMatchObject({ ok: true, windows: 3 });
    if (!r.ok) throw 0;
    expect(ev.eventLayoutById(r.layoutId)!.art.slots).toHaveLength(3);
    expect(ev.eventLayoutById(r.layoutId)!.art.heightRatio).toBeCloseTo(heightFor(STRIP(3)) / W, 5);
  });
  it('one window and the maximum of eight are accepted', async () => {
    await ev.initEventLayouts();
    const one = makeArt(W, heightFor(SINGLE), SINGLE), eight = makeArt(W, heightFor(STRIP(8)), STRIP(8));
    expect(await addEventLayout({ eventId: 'e', name: 'One', file: png(one) }, real(nodePrep(one)))).toMatchObject({ ok: true, windows: 1 });
    expect(await addEventLayout({ eventId: 'e', name: 'Eight', file: png(eight) }, real(nodePrep(eight)))).toMatchObject({ ok: true, windows: 8 });
  });
  it('no windows and too many windows are refused with plain sentences and nothing is stored', async () => {
    await ev.initEventLayouts();
    const none = makeArt(W, 1500, []), nine = makeArt(W, heightFor(STRIP(9)), STRIP(9));
    const a = await addEventLayout({ eventId: 'e', name: 'None', file: png(none) }, real(nodePrep(none)));
    const b = await addEventLayout({ eventId: 'e', name: 'Nine', file: png(nine) }, real(nodePrep(nine)));
    expect(a).toMatchObject({ ok: false }); expect(b).toMatchObject({ ok: false });
    if (!a.ok) expect(a.errors.join(' ')).toContain('No photo windows were found.');
    if (!b.ok) expect(b.errors.join(' ')).toContain('at most 8');
    expect(await stored()).toEqual([]);
    expect(ev.eventLayoutRecords()).toEqual([]);
  });
  it('if the save fails there is no ghost: no layout in the store, none in memory, and the error is the store message', async () => {
    await ev.initEventLayouts();
    idb.inject({ op: 'add', error: { name: 'QuotaExceededError' }, kind: 'abort' });
    const r = await addEventLayout({ eventId: 'event-1', name: 'Gala', file }, real());
    expect(r).toEqual({ ok: false, errors: [store.EVENT_LAYOUT_MESSAGES.quota] });
    expect(ev.eventLayoutRecords()).toEqual([]);
    expect(await stored()).toEqual([]);
    expect(idb.records('eventLayouts')).toHaveLength(0);
  });
  it('every stored layout has a picture and at least one window, whatever happens', async () => {
    await ev.initEventLayouts();
    await addEventLayout({ eventId: 'e', name: 'A', file }, real());
    idb.inject({ op: 'add', error: { name: 'UnknownError' }, kind: 'request' });
    await addEventLayout({ eventId: 'e', name: 'B', file }, real());
    await addEventLayout({ eventId: 'e', name: 'C', file }, real(async () => ({ ok: false, errors: ['No.'] })));
    const list = await stored();
    expect(list.length).toBeGreaterThan(0);
    for (const d of list) { expect(d.art.blob.size).toBeGreaterThan(0); expect(d.art.slots.length).toBeGreaterThan(0); }
  });
  it('IndexedDB unavailable: a plain error and nothing created', async () => {
    delete (globalThis as any).indexedDB; store.resetStore();
    expect(await addEventLayout({ eventId: 'e', name: 'A', file }, real())).toEqual({ ok: false, errors: [store.EVENT_LAYOUT_MESSAGES.unavailable] });
  });
  it('needs a name, an event and a picture, and checks the picture only after those', async () => {
    const prepare = vi.fn(okPrep);
    expect(await addEventLayout({ eventId: 'event-1', name: '   ', file }, real(prepare))).toMatchObject({ ok: false });
    expect(await addEventLayout({ eventId: '', name: 'A', file }, real(prepare))).toMatchObject({ ok: false });
    expect(await addEventLayout({ eventId: 'event-1', name: 'A', file: null }, real(prepare))).toMatchObject({ ok: false });
    expect(prepare).not.toHaveBeenCalled();
  });
  it('never throws, even if a step throws', async () => {
    expect(await addEventLayout({ eventId: 'e', name: 'A', file }, { ...real(), prepare: async () => { throw new Error('boom'); } })).toEqual({ ok: false, errors: ['The layout could not be saved. Please try again.'] });
    expect(await addEventLayout({ eventId: 'e', name: 'A', file }, { ...real(), create: async () => { throw new Error('boom'); } })).toMatchObject({ ok: false });
  });
  it('the name is cut to the name limit', async () => {
    await ev.initEventLayouts();
    const r = await addEventLayout({ eventId: 'e', name: 'x'.repeat(100), file }, real());
    expect(r.ok && r.name).toHaveLength(store.NAME_MAX);
  });
  it('owner-facing sentences have no dash and no emoji', async () => {
    const out = [
      await addEventLayout({ eventId: 'e', name: '', file }, real()), await addEventLayout({ eventId: '', name: 'A', file }, real()), await addEventLayout({ eventId: 'e', name: 'A', file: null }, real()),
      await addEventLayout({ eventId: 'e', name: 'A', file }, { ...real(), prepare: async () => { throw new Error('x'); } })
    ];
    for (const r of out) if (!r.ok) for (const m of r.errors) { expect(m).not.toMatch(/[\u2012-\u2015]/); expect(m).not.toMatch(/\p{Extended_Pictographic}/u); }
  });
});
