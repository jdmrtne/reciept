// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import type { CustomLayoutArt } from './types';

let idb: FakeIndexedDB;
const art = (n = 1): CustomLayoutArt => ({ blob: new Blob([new Uint8Array(n)], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152, windows: [{ x: 10, y: 10, w: 100, h: 100 }], slots: [{ x: 0.01, y: 0.01, w: 0.1, h: 0.1 }] });
beforeEach(() => { idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); });
afterEach(() => { store.resetStore(); delete (globalThis as any).indexedDB; });

describe('custom frame store', () => {
  it('creates, lists and gets a frame', async () => {
    const a = await store.createFrame('  Summer   Party ', 1000), b = await store.createFrame('Second', 2000);
    expect(a.ok && a.value).toMatchObject({ name: 'Summer Party', createdAt: 1000, layouts: {} });
    expect(a.ok && a.value.id.startsWith('custom-')).toBe(true);
    const list = await store.listFrames();
    expect(list.ok && list.value.map((f) => f.name)).toEqual(['Summer Party', 'Second']);
    if (b.ok) expect(await store.getFrameRecord(b.value.id)).toMatchObject({ ok: true });
  });
  it('rejects an empty name and trims long names', async () => {
    expect(await store.createFrame('   ')).toMatchObject({ ok: false, reason: 'invalid' });
    const r = await store.createFrame('x'.repeat(100));
    expect(r.ok && r.value.name).toHaveLength(store.NAME_MAX);
  });
  it('stores blobs and metadata per layout, replaces, and removes', async () => {
    const f = await store.createFrame('A'); if (!f.ok) throw 0;
    await store.setLayoutArt(f.value.id, 'single', art(5));
    const two = await store.setLayoutArt(f.value.id, 'strip-2', art(7));
    expect(two.ok && Object.keys(two.value.layouts)).toEqual(['single', 'strip-2']);
    const got = await store.getFrameRecord(f.value.id);
    expect(got.ok && got.value.layouts.single!.blob.size).toBe(5);
    expect(got.ok && got.value.layouts.single!.slots).toHaveLength(1);
    const rep = await store.setLayoutArt(f.value.id, 'single', art(9));
    expect(rep.ok && rep.value.layouts.single!.blob.size).toBe(9);
    const rm = await store.removeLayoutArt(f.value.id, 'single');
    expect(rm.ok && Object.keys(rm.value.layouts)).toEqual(['strip-2']);
  });
  it('update keeps id and createdAt, bumps updatedAt, and renames', async () => {
    const f = await store.createFrame('A', 100); if (!f.ok) throw 0;
    const r = await store.updateFrame(f.value.id, (x) => ({ ...x, name: 'B', id: 'custom-hacked', createdAt: 5 }), 900);
    expect(r.ok && r.value).toMatchObject({ id: f.value.id, createdAt: 100, updatedAt: 900, name: 'B' });
    expect(await store.renameFrame(f.value.id, '')).toMatchObject({ ok: false, reason: 'invalid' });
  });
  it('two quick edits do not overwrite each other', async () => {
    const f = await store.createFrame('A'); if (!f.ok) throw 0;
    await Promise.all([store.setLayoutArt(f.value.id, 'single', art()), store.setLayoutArt(f.value.id, 'classic', art())]);
    const got = await store.getFrameRecord(f.value.id);
    expect(got.ok && Object.keys(got.value.layouts).sort()).toEqual(['classic', 'single']);
  });
  it('reports missing frames and deletes', async () => {
    expect(await store.getFrameRecord('custom-nope')).toMatchObject({ ok: false, reason: 'missing' });
    expect(await store.updateFrame('custom-nope', (x) => x)).toMatchObject({ ok: false, reason: 'missing' });
    const f = await store.createFrame('A'); if (!f.ok) throw 0;
    expect(await store.deleteFrame(f.value.id)).toEqual({ ok: true, value: true });
    expect(await store.getFrameRecord(f.value.id)).toMatchObject({ ok: false, reason: 'missing' });
    expect(await store.deleteFrame(f.value.id)).toMatchObject({ ok: true }); // deleting twice is harmless
  });
  it('skips corrupt records instead of failing the list', async () => {
    const f = await store.createFrame('Good'); if (!f.ok) throw 0;
    (idb as any).db.data.set('custom-bad', { id: 'custom-bad' });
    (idb as any).db.data.set('other', { id: 'other', name: 'x', layouts: {} });
    const list = await store.listFrames();
    expect(list.ok && list.value.map((x) => x.name)).toEqual(['Good']);
    expect(await store.getFrameRecord('custom-bad')).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('failures give readable messages', () => {
  it('IndexedDB missing: unavailable, never throws', async () => {
    delete (globalThis as any).indexedDB;
    for (const r of [await store.listFrames(), await store.createFrame('A'), await store.deleteFrame('x')]) expect(r).toMatchObject({ ok: false, reason: 'unavailable', message: store.MESSAGES.unavailable });
  });
  it('open error and blocked open: unavailable, and a later call retries', async () => {
    idb.inject({ op: 'open', error: { name: 'SecurityError' } });
    expect(await store.listFrames()).toMatchObject({ ok: false, reason: 'unavailable' });
    expect((await store.listFrames()).ok).toBe(true);
    store.resetStore(); idb.blocked = true;
    expect(await store.listFrames()).toMatchObject({ ok: false, reason: 'unavailable' });
  });
  it('quota as an aborted transaction: reason quota, nothing half written', async () => {
    const f = await store.createFrame('A'); if (!f.ok) throw 0;
    idb.inject({ op: 'put', error: { name: 'QuotaExceededError' }, kind: 'abort' });
    const r = await store.setLayoutArt(f.value.id, 'single', art(50));
    expect(r).toMatchObject({ ok: false, reason: 'quota', message: store.MESSAGES.quota });
    const got = await store.getFrameRecord(f.value.id);
    expect(got.ok && got.value.layouts).toEqual({});
  });
  it('quota as a request error', async () => {
    idb.inject({ op: 'add', error: { name: 'QuotaExceededError' }, kind: 'request' });
    expect(await store.createFrame('A')).toMatchObject({ ok: false, reason: 'quota' });
    expect(idb.records()).toHaveLength(0);
  });
  it('other errors give the generic save message', async () => {
    idb.inject({ op: 'getAll', error: { name: 'UnknownError' }, kind: 'request' });
    expect(await store.listFrames()).toMatchObject({ ok: false, reason: 'storage', message: store.MESSAGES.storage });
  });
  it('a version change from another tab drops the connection and the next call reopens', async () => {
    await store.listFrames(); idb.versionChange();
    expect((await store.createFrame('A')).ok).toBe(true);
    expect(idb.opens).toBe(2);
  });
  it('no message has a dash or emoji', () => {
    for (const m of Object.values(store.MESSAGES)) { expect(m).not.toMatch(/[\u2012-\u2015]/); expect(m).not.toMatch(/\p{Extended_Pictographic}/u); }
  });
});

describe('persistence request', () => {
  const nav = (v: unknown) => Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true });
  it('asks once and reports the answer; already persisted skips the request', async () => {
    let calls = 0; nav({ storage: { persist: async () => (calls++, true), persisted: async () => false } });
    expect(await store.requestPersistence()).toBe(true); expect(calls).toBe(1);
    nav({ storage: { persist: async () => (calls++, true), persisted: async () => true } });
    expect(await store.requestPersistence()).toBe(true); expect(calls).toBe(1);
  });
  it('denied is false; no API or a throwing API is null', async () => {
    nav({ storage: { persist: async () => false } }); expect(await store.requestPersistence()).toBe(false);
    nav({}); expect(await store.requestPersistence()).toBeNull();
    nav({ storage: { persist: async () => { throw new Error('x'); } } }); expect(await store.requestPersistence()).toBeNull();
  });
});
