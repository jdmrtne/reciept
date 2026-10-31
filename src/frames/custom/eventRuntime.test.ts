// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import * as ev from './eventRuntime';
import * as rt from './runtime';
import { FRAMES, framesForLayout, getFrame } from '../registry';
import { isEventLayoutShown, layoutsOfEvent, unassignedEventLayouts } from './eventLayouts';
import type { CustomLayoutArt } from './types';

let idb: FakeIndexedDB, created: string[], revoked: string[], n: number;
const art = (tag = 'a', windows = 1): CustomLayoutArt => ({
  blob: new Blob([tag], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152,
  windows: Array.from({ length: windows }, (_, i) => ({ x: 10, y: 10 + i * 200, w: 100, h: 100 })),
  slots: Array.from({ length: windows }, (_, i) => ({ x: 0.01, y: 0.01 + i * 0.1, w: 0.1, h: 0.1 }))
});
beforeEach(() => {
  idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); ev.resetEventRuntime(); rt.resetCustomRuntime();
  created = []; revoked = []; n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { const u = `blob:fake/${++n}`; created.push(u); return u; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => { revoked.push(u); });
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); ev.resetEventRuntime(); rt.resetCustomRuntime(); delete (globalThis as any).indexedDB; });
const mk = async (name = 'Gala', eventId = 'event-1', a = art()) => { const r = await ev.createEventLayoutRecord({ name, eventId, art: a }); if (!r.ok) throw new Error(r.message); return r.value.id; };

describe('event layout runtime', () => {
  it('starts empty: ready, no layouts, no object URLs, and standard frame lookups are exactly as before', async () => {
    await ev.initEventLayouts();
    expect(ev.getEventLayoutStatus()).toBe('ready');
    expect(ev.eventLayoutRecords()).toEqual([]);
    expect(created).toEqual([]);
    expect(ev.eventLayoutById('evl-x')).toBeUndefined();
    expect(ev.eventLayoutAsset('evl-x')).toBeNull();
    expect(framesForLayout('single').map((f) => f.id)).toEqual(FRAMES.filter((f) => !f.onlyLayouts).map((f) => f.id));
    expect(getFrame('nope')).toBe(FRAMES[0]);
    expect(rt.customFrameDefs()).toEqual([]);
  });
  it('loads stored layouts at start with exactly one object URL each', async () => {
    const a = await mk('One', 'event-1', art('1', 2)), b = await mk('Two', 'event-2');
    ev.resetEventRuntime(); created.length = 0; n = 0;
    await ev.initEventLayouts();
    expect(ev.eventLayoutRecords().map((d) => d.id)).toEqual([a, b]);
    expect(created).toHaveLength(2);
    expect(ev.eventLayoutAsset(a)?.src).toMatch(/^blob:fake\//);
    expect(ev.eventLayoutAsset(a)?.meta.slots).toHaveLength(2);
    expect(ev.eventLayoutById(b)?.name).toBe('Two');
  });
  it('the asset carries the metadata but never the blob', async () => {
    const id = await mk();
    const a = ev.eventLayoutAsset(id)!;
    expect('blob' in a.meta).toBe(false);
    expect(a.meta).toMatchObject({ mime: 'image/png', width: 1152, height: 2000 });
  });
  it('init is one load even when called twice', async () => {
    await mk(); ev.resetEventRuntime(); created.length = 0;
    await Promise.all([ev.initEventLayouts(), ev.initEventLayouts()]);
    expect(created).toHaveLength(1);
    expect(ev.eventLayoutRecords()).toHaveLength(1);
  });
  it('create bumps the version and tells subscribers; unsubscribe stops it', async () => {
    const calls = vi.fn(), off = ev.subscribeEventLayouts(calls), v0 = ev.eventLayoutVersion();
    await mk();
    expect(ev.eventLayoutVersion()).toBeGreaterThan(v0);
    expect(calls).toHaveBeenCalled();
    off(); calls.mockClear(); await mk('B');
    expect(calls).not.toHaveBeenCalled();
  });
  it('a throwing subscriber does not break the registry', async () => {
    ev.subscribeEventLayouts(() => { throw new Error('bad'); });
    await expect(mk()).resolves.toMatch(/^evl-/);
  });
  it('replacing the picture makes a new URL and revokes the old one', async () => {
    const id = await mk('A', 'event-1', art('old'));
    const first = ev.eventLayoutAsset(id)!.src;
    const r = await ev.setEventLayoutRecordArt(id, art('new', 2));
    expect(r.ok).toBe(true);
    const second = ev.eventLayoutAsset(id)!.src;
    expect(second).not.toBe(first);
    expect(revoked).toEqual([first]);
    expect(ev.eventLayoutById(id)?.art.slots).toHaveLength(2);
  });
  it('rename, shown switch, QR spot and moving to another event keep the same URL (nothing revoked or recreated)', async () => {
    const id = await mk(), url = ev.eventLayoutAsset(id)!.src; created.length = 0;
    await ev.renameEventLayoutRecord(id, 'Renamed');
    await ev.setEventLayoutRecordEnabled(id, false);
    await ev.setEventLayoutRecordQr(id, { x: 0.1, y: 0.8, w: 0.3, h: 0.15 });
    await ev.setEventLayoutRecordEvent(id, 'event-2');
    expect(ev.eventLayoutAsset(id)!.src).toBe(url);
    expect(created).toEqual([]); expect(revoked).toEqual([]);
    expect(ev.eventLayoutById(id)).toMatchObject({ name: 'Renamed', enabled: false, eventId: 'event-2' });
    expect(ev.eventLayoutById(id)?.art.qr).toEqual({ x: 0.1, y: 0.8, w: 0.3, h: 0.15 });
  });
  it('delete revokes the URL and removes the layout from memory and from the store', async () => {
    const id = await mk(), url = ev.eventLayoutAsset(id)!.src;
    expect(await ev.deleteEventLayoutRecord(id)).toEqual({ ok: true, value: true });
    expect(revoked).toEqual([url]);
    expect(ev.eventLayoutById(id)).toBeUndefined();
    expect(ev.eventLayoutAsset(id)).toBeNull();
    const list = await store.listEventLayouts(); expect(list.ok && list.value).toEqual([]);
  });
  it('shown switch: shown by default, off after the owner switches it, and unknown ids count as shown', async () => {
    const id = await mk();
    expect(ev.eventLayoutEnabled(id)).toBe(true);
    await ev.setEventLayoutRecordEnabled(id, false);
    expect(ev.eventLayoutEnabled(id)).toBe(false);
    expect(isEventLayoutShown(ev.eventLayoutById(id)!)).toBe(false);
    await ev.setEventLayoutRecordEnabled(id, true);
    expect(ev.eventLayoutEnabled(id)).toBe(true);
    expect(ev.eventLayoutEnabled('evl-unknown')).toBe(true);
  });
  it('memory changes only after the store accepted it: a failed save changes nothing', async () => {
    const id = await mk('Keep'), v = ev.eventLayoutVersion();
    idb.inject({ op: 'put', error: { name: 'QuotaExceededError' }, kind: 'abort' });
    const r = await ev.renameEventLayoutRecord(id, 'Lost');
    expect(r).toMatchObject({ ok: false, reason: 'quota', message: store.EVENT_LAYOUT_MESSAGES.quota });
    expect(ev.eventLayoutById(id)?.name).toBe('Keep');
    expect(ev.eventLayoutVersion()).toBe(v);
    idb.inject({ op: 'delete', error: { name: 'UnknownError' }, kind: 'request' });
    expect((await ev.deleteEventLayoutRecord(id)).ok).toBe(false);
    expect(ev.eventLayoutById(id)).toBeDefined();
    expect(revoked).toEqual([]);
  });
  it('a failed create leaves memory empty and creates no object URL', async () => {
    idb.inject({ op: 'add', error: { name: 'QuotaExceededError' }, kind: 'abort' });
    const r = await ev.createEventLayoutRecord({ name: 'A', eventId: 'e', art: art() });
    expect(r.ok).toBe(false);
    expect(ev.eventLayoutRecords()).toEqual([]);
    expect(created).toEqual([]);
  });
  it('records come back in creation order and feed the pure group helpers', async () => {
    await mk('A', 'event-1'); await mk('B', 'event-2'); await mk('C', 'event-1'); await mk('D', 'gone');
    const recs = ev.eventLayoutRecords();
    expect(layoutsOfEvent(recs, 'event-1').map((d) => d.name)).toEqual(['A', 'C']);
    expect(unassignedEventLayouts(recs, ['event-1', 'event-2']).map((d) => d.name)).toEqual(['D']);
  });
  it('IndexedDB unavailable: status unavailable, registry empty, nothing throws', async () => {
    delete (globalThis as any).indexedDB; store.resetStore();
    await ev.initEventLayouts();
    expect(ev.getEventLayoutStatus()).toBe('unavailable');
    expect(ev.eventLayoutRecords()).toEqual([]);
    expect(await ev.createEventLayoutRecord({ name: 'A', eventId: 'e', art: art() })).toMatchObject({ ok: false, reason: 'unavailable' });
  });
  it('a read error at start leaves the feature empty but ready', async () => {
    idb.inject({ op: 'getAll', error: { name: 'UnknownError' }, kind: 'request' });
    await ev.initEventLayouts();
    expect(ev.getEventLayoutStatus()).toBe('ready');
    expect(ev.eventLayoutRecords()).toEqual([]);
  });
  it('a browser that cannot make an object URL keeps the record but offers no asset', async () => {
    vi.mocked(URL.createObjectURL).mockImplementation(() => { throw new Error('no url'); });
    const id = await mk();
    expect(ev.eventLayoutById(id)).toBeDefined();
    expect(ev.eventLayoutAsset(id)).toBeNull();
  });
  it('ready resolves at once for unknown ids and for an empty registry', async () => {
    await expect(ev.eventLayoutReady('evl-x')).resolves.toBeUndefined();
    await expect(ev.eventLayoutReady()).resolves.toBeUndefined();
  });
  it('the old frame registry and the event layout registry never see each other', async () => {
    const f = await rt.createCustomFrame('Own frame'); if (!f.ok) throw 0;
    const id = await mk();
    expect(rt.customRecords().map((x) => x.id)).toEqual([f.value.id]);
    expect(ev.eventLayoutRecords().map((x) => x.id)).toEqual([id]);
    expect(rt.customFrameById(id)).toBeUndefined();
    expect(ev.eventLayoutById(f.value.id)).toBeUndefined();
  });
});
