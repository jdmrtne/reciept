// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import type { CustomLayoutArt } from './types';

let idb: FakeIndexedDB;
const art = (n = 1, windows = 1): CustomLayoutArt => ({
  blob: new Blob([new Uint8Array(n)], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152,
  windows: Array.from({ length: windows }, (_, i) => ({ x: 10, y: 10 + i * 200, w: 100, h: 100 })),
  slots: Array.from({ length: windows }, (_, i) => ({ x: 0.01, y: 0.01 + i * 0.1, w: 0.1, h: 0.1 }))
});
const layouts = () => (idb as any).db.stores.get('eventLayouts').data as Map<string, unknown>;
beforeEach(() => { idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); });
afterEach(() => { store.resetStore(); delete (globalThis as any).indexedDB; });
const mk = async (name = 'Gala', eventId = 'event-1', now = 1000, a = art()) => { const r = await store.createEventLayout({ name, eventId, art: a }, now); if (!r.ok) throw new Error(r.message); return r.value; };

describe('event layout store: create, list, get', () => {
  it('creates a layout with its picture in one record, lists in creation order, and gets it back', async () => {
    const a = await mk('  Summer   Party ', 'event-1', 1000, art(5, 2)), b = await mk('Second', 'event-2', 2000);
    expect(a).toMatchObject({ name: 'Summer Party', eventId: 'event-1', createdAt: 1000, updatedAt: 1000 });
    expect(a.id.startsWith('evl-')).toBe(true);
    expect(a.art.rev).toBeTruthy();
    const list = await store.listEventLayouts();
    expect(list.ok && list.value.map((d) => d.name)).toEqual(['Summer Party', 'Second']);
    const got = await store.getEventLayoutRecord(a.id);
    expect(got.ok && got.value.art.blob.size).toBe(5);
    expect(got.ok && got.value.art.slots).toHaveLength(2);
    expect(b.id).not.toBe(a.id);
  });
  it('trims long names and refuses an empty name, no event, or a picture without windows (nothing is stored)', async () => {
    const r = await store.createEventLayout({ name: 'x'.repeat(100), eventId: 'e', art: art() });
    expect(r.ok && r.value.name).toHaveLength(store.NAME_MAX);
    const before = layouts().size;
    expect(await store.createEventLayout({ name: '   ', eventId: 'e', art: art() })).toMatchObject({ ok: false, reason: 'invalid', message: 'Give the layout a name.' });
    expect(await store.createEventLayout({ name: 'A', eventId: '', art: art() })).toMatchObject({ ok: false, reason: 'invalid', message: 'Pick an event first.' });
    expect(await store.createEventLayout({ name: 'A', eventId: 'e', art: art(1, 0) })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(layouts().size).toBe(before);
  });
  it('reports a missing layout and deletes (twice is harmless)', async () => {
    expect(await store.getEventLayoutRecord('evl-nope')).toMatchObject({ ok: false, reason: 'missing', message: store.EVENT_LAYOUT_MESSAGES.missing });
    const d = await mk();
    expect(await store.deleteEventLayout(d.id)).toEqual({ ok: true, value: true });
    expect(await store.getEventLayoutRecord(d.id)).toMatchObject({ ok: false, reason: 'missing' });
    expect(await store.deleteEventLayout(d.id)).toMatchObject({ ok: true });
  });
  it('skips corrupt records instead of failing the list', async () => {
    const d = await mk('Good');
    layouts().set('evl-bad', { id: 'evl-bad' });
    layouts().set('other', { id: 'other', name: 'x', eventId: 'e', art: art() });
    layouts().set('evl-noslots', { ...d, id: 'evl-noslots', art: { ...d.art, slots: [] } });
    const list = await store.listEventLayouts();
    expect(list.ok && list.value.map((x) => x.name)).toEqual(['Good']);
    expect(await store.getEventLayoutRecord('evl-bad')).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('event layout store: changes', () => {
  it('update keeps id and createdAt, bumps updatedAt; rename refuses an empty name', async () => {
    const d = await mk('A', 'e', 100);
    const r = await store.updateEventLayout(d.id, (x) => ({ ...x, name: 'B', id: 'evl-hacked', createdAt: 5 }), 900);
    expect(r.ok && r.value).toMatchObject({ id: d.id, createdAt: 100, updatedAt: 900, name: 'B' });
    expect(await store.renameEventLayout(d.id, '')).toMatchObject({ ok: false, reason: 'invalid' });
    const n = await store.renameEventLayout(d.id, '  New   name ');
    expect(n.ok && n.value.name).toBe('New name');
    expect(await store.updateEventLayout('evl-nope', (x) => x)).toMatchObject({ ok: false, reason: 'missing' });
  });
  it('a change that would leave a layout without windows is refused and nothing is written', async () => {
    const d = await mk('A');
    const r = await store.updateEventLayout(d.id, (x) => ({ ...x, art: { ...x.art, slots: [] } }));
    expect(r).toMatchObject({ ok: false, reason: 'invalid' });
    const got = await store.getEventLayoutRecord(d.id);
    expect(got.ok && got.value.art.slots).toHaveLength(1);
  });
  it('a throwing change function is a failure value, not an exception', async () => {
    const d = await mk('A');
    expect(await store.updateEventLayout(d.id, () => { throw new Error('boom'); })).toMatchObject({ ok: false, reason: 'storage' });
  });
  it('two quick edits do not overwrite each other', async () => {
    const d = await mk('A');
    await Promise.all([store.renameEventLayout(d.id, 'Renamed'), store.setEventLayoutEnabled(d.id, false), store.setEventLayoutEvent(d.id, 'event-9')]);
    const got = await store.getEventLayoutRecord(d.id);
    expect(got.ok && got.value).toMatchObject({ name: 'Renamed', enabled: false, eventId: 'event-9' });
  });
  it('replacing the picture swaps blob, windows and rev and drops the old QR spot', async () => {
    const d = await mk('A', 'e', 1, art(5, 1));
    const withQr = await store.setEventLayoutQr(d.id, { x: 0.1, y: 0.8, w: 0.3, h: 0.15 });
    expect(withQr.ok && withQr.value.art.qr).toEqual({ x: 0.1, y: 0.8, w: 0.3, h: 0.15 });
    const rep = await store.setEventLayoutArt(d.id, art(9, 3));
    expect(rep.ok && rep.value.art.blob.size).toBe(9);
    expect(rep.ok && rep.value.art.slots).toHaveLength(3);
    expect(rep.ok && 'qr' in rep.value.art).toBe(false);
    expect(rep.ok && rep.value.art.rev).not.toBe(d.art.rev);
    expect(rep.ok && rep.value).toMatchObject({ name: 'A', eventId: 'e', createdAt: 1 });
  });
  it('QR spot: set, clear, and the picture and its rev stay exactly as stored', async () => {
    const d = await mk('A');
    const set = await store.setEventLayoutQr(d.id, { x: 0.1, y: 0.8, w: 0.3, h: 0.15 });
    expect(set.ok && set.value.art.rev).toBe(d.art.rev);
    expect(set.ok && set.value.art.blob.size).toBe(1);
    const clear = await store.setEventLayoutQr(d.id, null);
    expect(clear.ok && 'qr' in clear.value.art).toBe(false);
    expect(await store.setEventLayoutQr('evl-nope', null)).toMatchObject({ ok: false, reason: 'missing' });
  });
  it('shown/hidden switch and moving between events keep the picture; an empty event id unassigns', async () => {
    const d = await mk('A', 'event-1', 1, art(4));
    const off = await store.setEventLayoutEnabled(d.id, false);
    expect(off.ok && off.value.enabled).toBe(false);
    const on = await store.setEventLayoutEnabled(d.id, true);
    expect(on.ok && on.value.enabled).toBe(true);
    const moved = await store.setEventLayoutEvent(d.id, 'event-2');
    expect(moved.ok && moved.value.eventId).toBe('event-2');
    expect(moved.ok && moved.value.art.blob.size).toBe(4);
    const none = await store.setEventLayoutEvent(d.id, '');
    expect(none.ok && none.value.eventId).toBe('');
    expect(await store.setEventLayoutEvent('evl-nope', 'e')).toMatchObject({ ok: false, reason: 'missing' });
  });
});

describe('event layout store: additive upgrade (database version 1 to 2)', () => {
  const oldFrame = (id: string, name: string) => ({ id, name, createdAt: 1, updatedAt: 1, layouts: { single: art(7) }, special: true, eventId: 'event-1' });
  it('opening an old database keeps every existing frame untouched and adds the new store', async () => {
    const frames = [oldFrame('custom-a', 'First'), oldFrame('custom-b', 'Second'), { ...oldFrame('custom-c', 'Third'), enabled: false }];
    idb.seed(1, { frames });
    expect(idb.version).toBe(1);
    expect(idb.storeNames()).toEqual(['frames']);
    const list = await store.listFrames();
    expect(list.ok && list.value.map((f) => f.name)).toEqual(['First', 'Second', 'Third']);
    expect(list.ok && list.value[0].layouts.single!.blob.size).toBe(7);
    expect(idb.version).toBe(2);
    expect(idb.storeNames().sort()).toEqual(['eventLayouts', 'frames']);
    expect(idb.records('frames')).toHaveLength(3);
    expect(idb.records('eventLayouts')).toEqual([]);
    const e = await store.listEventLayouts();
    expect(e).toEqual({ ok: true, value: [] });
  });
  it('after the upgrade both stores work side by side and never mix', async () => {
    idb.seed(1, { frames: [oldFrame('custom-a', 'First')] });
    const d = await mk('Layout');
    const f = await store.createFrame('Frame 2');
    expect(f.ok).toBe(true);
    const frames = await store.listFrames(), els = await store.listEventLayouts();
    expect(frames.ok && frames.value.map((x) => x.name)).toEqual(['First', 'Frame 2']);
    expect(els.ok && els.value.map((x) => x.id)).toEqual([d.id]);
    expect(idb.records('frames')).toHaveLength(2);
    expect(idb.records('eventLayouts')).toHaveLength(1);
    expect(await store.deleteEventLayout(d.id)).toMatchObject({ ok: true });
    const again = await store.listFrames();
    expect(again.ok && again.value).toHaveLength(2);
  });
  it('a brand new device gets both stores at version 2', async () => {
    await store.listFrames();
    expect(idb.version).toBe(2);
    expect(idb.storeNames().sort()).toEqual(['eventLayouts', 'frames']);
  });
  it('an older build asking for version 1 on a version 2 database gets a version error (and keeps no rows it cannot read)', async () => {
    await mk('A');
    const err = await new Promise<string>((res) => { const r = idb.open('booth.customFrames', 1) as any; r.onerror = () => res(r.error?.name ?? 'error'); r.onsuccess = () => res('opened'); });
    expect(err).toBe('VersionError');
  });
});

describe('event layout store: failures give readable messages', () => {
  it('IndexedDB missing: unavailable for every function, never throws', async () => {
    delete (globalThis as any).indexedDB;
    const want = { ok: false, reason: 'unavailable', message: store.EVENT_LAYOUT_MESSAGES.unavailable };
    for (const r of [await store.listEventLayouts(), await store.getEventLayoutRecord('evl-x'), await store.createEventLayout({ name: 'A', eventId: 'e', art: art() }), await store.updateEventLayout('evl-x', (x) => x), await store.renameEventLayout('evl-x', 'B'), await store.setEventLayoutArt('evl-x', art()), await store.setEventLayoutQr('evl-x', null), await store.setEventLayoutEnabled('evl-x', false), await store.setEventLayoutEvent('evl-x', 'e'), await store.deleteEventLayout('evl-x')]) expect(r).toMatchObject(want);
  });
  it('quota as an aborted transaction: reason quota, the old picture is still there', async () => {
    const d = await mk('A', 'e', 1, art(5));
    idb.inject({ op: 'put', error: { name: 'QuotaExceededError' }, kind: 'abort' });
    const r = await store.setEventLayoutArt(d.id, art(50));
    expect(r).toMatchObject({ ok: false, reason: 'quota', message: store.EVENT_LAYOUT_MESSAGES.quota });
    const got = await store.getEventLayoutRecord(d.id);
    expect(got.ok && got.value.art.blob.size).toBe(5);
  });
  it('quota as a request error on create: nothing is stored', async () => {
    idb.inject({ op: 'add', error: { name: 'QuotaExceededError' }, kind: 'request' });
    expect(await store.createEventLayout({ name: 'A', eventId: 'e', art: art() })).toMatchObject({ ok: false, reason: 'quota', message: store.EVENT_LAYOUT_MESSAGES.quota });
    expect(idb.records('eventLayouts')).toHaveLength(0);
  });
  it('other errors give the generic save message', async () => {
    idb.inject({ op: 'getAll', error: { name: 'UnknownError' }, kind: 'request' });
    expect(await store.listEventLayouts()).toMatchObject({ ok: false, reason: 'storage', message: store.EVENT_LAYOUT_MESSAGES.storage });
  });
  it('frame failures keep their own wording (the frame messages are unchanged)', async () => {
    delete (globalThis as any).indexedDB;
    expect(await store.listFrames()).toMatchObject({ ok: false, reason: 'unavailable', message: store.MESSAGES.unavailable });
    expect(store.MESSAGES.unavailable).toContain('Custom frames');
  });
  it('no message has a dash or emoji', () => {
    for (const m of Object.values(store.EVENT_LAYOUT_MESSAGES)) { expect(m).not.toMatch(/[\u2012-\u2015]/); expect(m).not.toMatch(/\p{Extended_Pictographic}/u); }
  });
});
