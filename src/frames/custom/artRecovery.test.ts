// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import * as ev from './eventRuntime';
import * as rt from './runtime';
import { recoverArtUrl } from './artUrls';
import type { CustomLayoutArt } from './types';

/**
 * A picture whose object URL will not decode (the blob behind it went bad) is recovered ONCE from the saved copy: no re-upload,
 * the new URL replaces the old, the old is freed, and a failed recovery changes nothing.
 */
let idb: FakeIndexedDB, created: string[], revoked: string[], n: number, bad: Set<string>, badNext: boolean;
const art = (tag = 'a'): CustomLayoutArt => ({ blob: new Blob([tag], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152, windows: [{ x: 10, y: 10, w: 100, h: 100 }], slots: [{ x: 0.01, y: 0.01, w: 0.1, h: 0.1 }] });

class FakeImage { src = ''; decode() { return bad.has(this.src) ? Promise.reject(new Error('EncodingError')) : Promise.resolve(); } }

beforeEach(() => {
  idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); ev.resetEventRuntime(); rt.resetCustomRuntime();
  created = []; revoked = []; n = 0; bad = new Set(); badNext = false;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { const u = `blob:fake/${++n}`; created.push(u); if (badNext) bad.add(u); return u; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => { revoked.push(u); });
  Object.defineProperty(globalThis, 'navigator', { value: { storage: { persist: async () => true, persisted: async () => false } }, configurable: true });
  (globalThis as any).Image = FakeImage;
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); ev.resetEventRuntime(); rt.resetCustomRuntime(); delete (globalThis as any).indexedDB; delete (globalThis as any).Image; });

describe('own frames: one recovery from the saved copy', () => {
  it('replaces a URL that will not decode with a fresh one, frees the old one, and tells the screens', async () => {
    const f = await store.createFrame('Party'); if (!f.ok) throw new Error('create');
    await store.setLayoutArt(f.value.id, 'single', art());
    created.length = 0; n = 0; bad.add('blob:fake/1'); // the first URL made at start is the bad one
    await rt.initCustomFrames();
    const before = rt.customVersion();
    await rt.customReady(f.value.id, 'single');
    expect(rt.customAsset(f.value.id, 'single')?.src).toBe('blob:fake/2');
    expect(revoked).toContain('blob:fake/1');
    expect(rt.customVersion()).toBeGreaterThan(before);
  });

  it('keeps the old URL, and frees nothing, when the saved copy does not decode either', async () => {
    const f = await store.createFrame('Party'); if (!f.ok) throw new Error('create');
    await store.setLayoutArt(f.value.id, 'single', art());
    created.length = 0; n = 0; badNext = true; // every URL made is bad, the recovery's too
    await rt.initCustomFrames();
    await rt.customReady(f.value.id, 'single');
    expect(rt.customAsset(f.value.id, 'single')?.src).toBe('blob:fake/1');
    expect(revoked).toContain('blob:fake/2'); // only the failed attempt's own URL is freed
    expect(revoked).not.toContain('blob:fake/1');
    expect(created).toHaveLength(2); // one attempt, not a loop
  });

  it('does nothing for a picture that decodes', async () => {
    const f = await store.createFrame('Party'); if (!f.ok) throw new Error('create');
    await store.setLayoutArt(f.value.id, 'single', art());
    created.length = 0; n = 0;
    await rt.initCustomFrames(); await rt.customReady(f.value.id, 'single');
    expect(created).toHaveLength(1);
    expect(revoked).toEqual([]);
  });

  it('does not swap in an old picture when the owner replaced it meanwhile', async () => {
    const f = await store.createFrame('Party'); if (!f.ok) throw new Error('create');
    await store.setLayoutArt(f.value.id, 'single', art('old'));
    created.length = 0; n = 0; bad.add('blob:fake/1');
    await rt.initCustomFrames();
    await rt.setCustomLayoutArt(f.value.id, 'single', art('new')); // new rev, new URL (blob:fake/3 or later)
    await rt.customReady(f.value.id, 'single');
    const src = rt.customAsset(f.value.id, 'single')!.src;
    expect(src).not.toBe('blob:fake/1');
    expect(bad.has(src)).toBe(false);
  });
});

describe('event layouts: one recovery from the saved copy', () => {
  it('replaces a URL that will not decode and frees the old one', async () => {
    const r = await ev.createEventLayoutRecord({ name: 'Gala', eventId: 'event-1', art: art() }); if (!r.ok) throw new Error(r.message);
    ev.resetEventRuntime(); created.length = 0; n = 0; bad.add('blob:fake/1');
    await ev.initEventLayouts();
    await ev.eventLayoutReady(r.value.id);
    expect(ev.eventLayoutAsset(r.value.id)?.src).toBe('blob:fake/2');
    expect(revoked).toContain('blob:fake/1');
  });
});

describe('recoverArtUrl', () => {
  it('never throws, and reports false, when the saved copy cannot be read', async () => {
    expect(await recoverArtUrl(async () => { throw new Error('idb'); }, () => true, () => { throw new Error('must not swap'); })).toBe(false);
    expect(await recoverArtUrl(async () => null, () => true, () => { throw new Error('must not swap'); })).toBe(false);
  });
});
