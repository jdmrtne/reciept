// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import * as rt from './runtime';
import { FRAMES, framesForLayout, getFrame, isFrameAllowed, frameForLayout, DEFAULT_FRAME, resolveFramed } from '../registry';
import type { CustomLayoutArt } from './types';

let idb: FakeIndexedDB, created: string[], revoked: string[], n: number;
const art = (tag = 'a'): CustomLayoutArt => ({ blob: new Blob([tag], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152, windows: [{ x: 10, y: 10, w: 100, h: 100 }], slots: [{ x: 0.01, y: 0.01, w: 0.1, h: 0.1 }] });
beforeEach(() => {
  idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); rt.resetCustomRuntime();
  created = []; revoked = []; n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { const u = `blob:fake/${++n}`; created.push(u); return u; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => { revoked.push(u); });
  Object.defineProperty(globalThis, 'navigator', { value: { storage: { persist: async () => true, persisted: async () => false } }, configurable: true });
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); rt.resetCustomRuntime(); delete (globalThis as any).indexedDB; });
const mk = async (name: string, layouts: ('single' | 'strip-2' | 'classic')[] = ['single']) => {
  const f = await rt.createCustomFrame(name); if (!f.ok) throw new Error('create');
  for (const l of layouts) await rt.setCustomLayoutArt(f.value.id, l, art(l));
  return f.value.id;
};

describe('runtime registry', () => {
  it('starts empty and leaves built-in lookups exactly as before', async () => {
    await rt.initCustomFrames();
    expect(rt.getCustomStatus()).toBe('ready');
    expect(rt.customFrameDefs()).toEqual([]);
    expect(framesForLayout('single').map((f) => f.id)).toEqual(FRAMES.filter((f) => !f.onlyLayouts).map((f) => f.id));
    expect(getFrame('nope')).toBe(FRAMES[0]);
  });
  it('loads stored frames at start, creates one object URL per layout, and asks for persistence', async () => {
    const id = await mk('Party', ['single', 'strip-2']);
    rt.resetCustomRuntime(); created.length = 0; n = 0;
    await rt.initCustomFrames();
    expect(rt.customFrameById(id)?.name).toBe('Party');
    expect(rt.customLayouts(id).sort()).toEqual(['single', 'strip-2']);
    expect(created).toHaveLength(2);
    await vi.waitFor(() => expect(rt.isPersistent()).toBe(true));
  });
  it('init runs once even when called twice', async () => {
    await Promise.all([rt.initCustomFrames(), rt.initCustomFrames()]);
    expect(idb.opens).toBe(1);
  });
  it('is merged into getFrame, framesForLayout and isFrameAllowed, only for layouts with art', async () => {
    const id = await mk('Party', ['single']);
    expect(getFrame(id).name).toBe('Party');
    expect(getFrame(id)).toBe(getFrame(id)); // stable identity
    expect(framesForLayout('single').map((f) => f.id)).toContain(id);
    expect(framesForLayout('strip-3').map((f) => f.id)).not.toContain(id);
    expect(isFrameAllowed(id, 'single')).toBe(true);
    expect(isFrameAllowed(id, 'strip-3')).toBe(false);
    expect(frameForLayout('strip-3', id)).toBe(DEFAULT_FRAME);
    expect(frameForLayout('single', id)).toBe(id);
  });
  it('is never offered on the frame-locked NCL layouts and never takes the NCL frame', async () => {
    const id = await mk('Party', ['single']);
    for (const l of ['pass-1', 'pass-2', 'pass-3', 'pass-4']) expect(framesForLayout(l).map((f) => f.id)).toEqual(['ncl-boarding-pass']);
    expect(isFrameAllowed('ncl-boarding-pass', 'single')).toBe(false);
    expect(isFrameAllowed(id, 'pass-1')).toBe(false);
  });
  it('built-in frames keep priority over a custom frame with the same id', () => {
    expect(getFrame('kawaii')).toBe(FRAMES.find((f) => f.id === 'kawaii'));
  });
  it('a custom frame is an image frame with no bands (geometry is the layout defaults until Phase 3)', async () => {
    const id = await mk('Party');
    expect(getFrame(id)).toMatchObject({ type: 'image', headerHeight: 0, footerHeight: 0 });
    expect(() => resolveFramed('single', id)).not.toThrow();
  });
  it('customAsset returns the url and metadata without the blob', async () => {
    const id = await mk('Party');
    const a = rt.customAsset(id, 'single');
    expect(a?.src).toMatch(/^blob:fake\//);
    expect(a?.meta).toMatchObject({ width: 1152, windows: [{ x: 10, y: 10, w: 100, h: 100 }] });
    expect('blob' in (a?.meta ?? {})).toBe(false);
    expect(rt.customAsset(id, 'strip-4')).toBeNull();
    expect(rt.customAsset('custom-nope', 'single')).toBeNull();
  });
  it('replacing art revokes the old URL and makes a new one; other layouts keep theirs', async () => {
    const id = await mk('Party', ['single', 'strip-2']);
    const before = { single: rt.customAsset(id, 'single')!.src, two: rt.customAsset(id, 'strip-2')!.src };
    await rt.setCustomLayoutArt(id, 'single', art('new'));
    expect(revoked).toEqual([before.single]);
    expect(rt.customAsset(id, 'single')!.src).not.toBe(before.single);
    expect(rt.customAsset(id, 'strip-2')!.src).toBe(before.two);
  });
  it('removing a layout revokes its URL and stops offering the frame there', async () => {
    const id = await mk('Party', ['single', 'strip-2']);
    const u = rt.customAsset(id, 'strip-2')!.src;
    await rt.removeCustomLayoutArt(id, 'strip-2');
    expect(revoked).toContain(u);
    expect(framesForLayout('strip-2').map((f) => f.id)).not.toContain(id);
    expect(framesForLayout('single').map((f) => f.id)).toContain(id);
  });
  it('rename keeps object URLs (images already decoded stay valid) and updates the name', async () => {
    const id = await mk('Party'), u = rt.customAsset(id, 'single')!.src;
    await rt.renameCustomFrame(id, 'Bigger Party');
    expect(rt.customAsset(id, 'single')!.src).toBe(u);
    expect(revoked).toEqual([]);
    expect(getFrame(id).name).toBe('Bigger Party');
  });
  it('delete revokes every URL; a session still holding the id falls back to the default frame', async () => {
    const id = await mk('Party', ['single', 'strip-2']);
    const urls = [rt.customAsset(id, 'single')!.src, rt.customAsset(id, 'strip-2')!.src];
    expect(await rt.deleteCustomFrame(id)).toMatchObject({ ok: true });
    expect(revoked.sort()).toEqual(urls.sort());
    expect(rt.customFrameById(id)).toBeUndefined();
    expect(getFrame(id)).toBe(FRAMES[0]);
    expect(isFrameAllowed(id, 'single')).toBe(false);
    expect(frameForLayout('single', id)).toBe(DEFAULT_FRAME);
  });
  it('memory never shows a change that failed to save', async () => {
    const id = await mk('Party', ['single']);
    idb.inject({ op: 'put', error: { name: 'QuotaExceededError' }, kind: 'abort' });
    const r = await rt.setCustomLayoutArt(id, 'strip-2', art());
    expect(r).toMatchObject({ ok: false, reason: 'quota' });
    expect(rt.customLayouts(id)).toEqual(['single']);
    idb.inject({ op: 'delete', error: { name: 'UnknownError' }, kind: 'request' });
    expect(await rt.deleteCustomFrame(id)).toMatchObject({ ok: false });
    expect(rt.customFrameById(id)).toBeDefined();
  });
  it('notifies subscribers on every change and stops after unsubscribe', async () => {
    const fn = vi.fn(), off = rt.subscribeCustom(fn);
    const v = rt.customVersion();
    const id = await mk('A');
    expect(fn).toHaveBeenCalled(); expect(rt.customVersion()).toBeGreaterThan(v);
    off(); fn.mockClear(); await rt.renameCustomFrame(id, 'B');
    expect(fn).not.toHaveBeenCalled();
  });
  it('IndexedDB unavailable: feature off, status says so, nothing throws, built-ins unchanged', async () => {
    delete (globalThis as any).indexedDB; store.resetStore();
    await rt.initCustomFrames();
    expect(rt.getCustomStatus()).toBe('unavailable');
    expect(rt.customFrameDefs()).toEqual([]);
    expect(await rt.createCustomFrame('A')).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(framesForLayout('single').length).toBe(FRAMES.filter((f) => !f.onlyLayouts).length);
  });
  it('a failed read at start leaves an empty, working registry', async () => {
    idb.inject({ op: 'getAll', error: { name: 'UnknownError' }, kind: 'request' });
    await rt.initCustomFrames();
    expect(rt.getCustomStatus()).toBe('ready'); expect(rt.customFrameDefs()).toEqual([]);
  });
});
