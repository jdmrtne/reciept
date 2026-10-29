// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import * as rt from './runtime';
import { getFrame } from '../registry';
import type { CustomLayoutArt } from './types';

let idb: FakeIndexedDB, created: string[], revoked: string[], n: number;
const art = (tag = 'a'): CustomLayoutArt => ({ blob: new Blob([tag], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152, windows: [{ x: 10, y: 10, w: 100, h: 100 }], slots: [{ x: 0.01, y: 0.01, w: 0.1, h: 0.1 }] });
const SPOT = { x: 0.1, y: 0.7, w: 0.8, h: 0.25 };
beforeEach(() => {
  idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); rt.resetCustomRuntime(); created = []; revoked = []; n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { const u = `blob:fake/${++n}`; created.push(u); return u; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => { revoked.push(u); });
  Object.defineProperty(globalThis, 'navigator', { value: { storage: { persist: async () => true, persisted: async () => false } }, configurable: true });
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); rt.resetCustomRuntime(); delete (globalThis as any).indexedDB; });
const mk = async (layouts: ('single' | 'strip-2')[] = ['single', 'strip-2']) => {
  await rt.initCustomFrames();
  const f = await rt.createCustomFrame('Spot Test'); if (!f.ok) throw new Error('create');
  for (const l of layouts) await rt.setCustomLayoutArt(f.value.id, l, art(l));
  return f.value.id;
};

describe('QR spot storage (Phase 5)', () => {
  it('sets a spot: it reaches the frame as qr.byLayout and the stored record, and no picture is touched', async () => {
    const id = await mk(); const urls = created.length;
    const r = await rt.setCustomLayoutQr(id, 'single', SPOT);
    expect(r.ok).toBe(true);
    expect(getFrame(id).qr?.byLayout?.single?.safeArea).toEqual(SPOT);
    expect(getFrame(id).qr?.byLayout?.['strip-2']).toBeUndefined();
    expect(rt.customRecord(id)?.layouts.single?.qr).toEqual(SPOT);
    expect(created.length).toBe(urls); expect(revoked).toEqual([]); // same rev: object URLs kept, nothing re-decoded
  });
  it('survives a reload', async () => {
    const id = await mk();
    await rt.setCustomLayoutQr(id, 'strip-2', SPOT);
    rt.resetCustomRuntime(); await rt.initCustomFrames();
    expect(getFrame(id).qr?.byLayout?.['strip-2']?.safeArea).toEqual(SPOT);
    expect(rt.customRecord(id)?.layouts['strip-2']?.blob.size).toBeGreaterThan(0);
  });
  it('clears a spot: the frame goes back to the strip below, the picture stays', async () => {
    const id = await mk();
    await rt.setCustomLayoutQr(id, 'single', SPOT);
    const r = await rt.setCustomLayoutQr(id, 'single', null);
    expect(r.ok).toBe(true);
    expect(rt.customRecord(id)?.layouts.single?.qr).toBeUndefined();
    expect(getFrame(id).qr).toBeUndefined();
    expect(rt.customHasLayout(id, 'single')).toBe(true);
  });
  it('refuses a layout with no picture, and an unknown frame', async () => {
    const id = await mk(['single']);
    const a = await rt.setCustomLayoutQr(id, 'strip-2', SPOT);
    expect(a).toMatchObject({ ok: false, reason: 'missing' });
    const b = await rt.setCustomLayoutQr('custom-nope', 'single', SPOT);
    expect(b).toMatchObject({ ok: false, reason: 'missing' });
  });
  it('replacing a picture drops its old spot (the new geometry may not fit it)', async () => {
    const id = await mk();
    await rt.setCustomLayoutQr(id, 'single', SPOT);
    await rt.setCustomLayoutArt(id, 'single', art('new'));
    expect(rt.customRecord(id)?.layouts.single?.qr).toBeUndefined();
    expect(getFrame(id).qr).toBeUndefined();
  });
  it('a storage failure leaves memory as it was', async () => {
    const id = await mk();
    idb.inject({ op: 'put', error: { name: 'QuotaExceededError' }, kind: 'abort' });
    const r = await rt.setCustomLayoutQr(id, 'single', SPOT);
    expect(r.ok).toBe(false);
    expect(rt.customRecord(id)?.layouts.single?.qr).toBeUndefined();
  });
});
