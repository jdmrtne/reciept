// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from '../../frames/custom/fakeIdb';
import * as store from '../../frames/custom/store';
import * as rt from '../../frames/custom/runtime';
import type { CustomLayoutArt } from '../../frames/custom/types';
import { DEFAULT_SETTINGS } from '../../config/settings';
import { ArtPreview, customFramesCard, layoutLabel } from './CustomFramesSection';
import { SECTIONS } from './sections';
import { searchSettings } from './search';
import type { AdminCtx } from './types';

const noop = () => {};
const ctx: AdminCtx = { s: DEFAULT_SETTINGS, set: () => true, tune: noop, busy: false, testUrl: null, notify: noop, clearNotice: noop, actions: { pair: noop, testPrint: noop, testShare: noop, changePin: noop } };
const html = () => renderToStaticMarkup(<>{customFramesCard.render(ctx)}</>);
const art = (n = 1): CustomLayoutArt => ({
  blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152,
  windows: Array.from({ length: n }, (_, i) => ({ x: 100, y: 100 + i * 500, w: 900, h: 400 })),
  slots: Array.from({ length: n }, (_, i) => ({ x: 0.08, y: (97 + i * 500) / 1152, w: 0.84, h: 406 / 1152 }))
});

let idb: FakeIndexedDB, n: number;
beforeEach(() => {
  idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); rt.resetCustomRuntime(); n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${++n}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  Object.defineProperty(globalThis, 'navigator', { value: { storage: { persist: async () => true, persisted: async () => false } }, configurable: true });
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); rt.resetCustomRuntime(); delete (globalThis as any).indexedDB; });

describe('ADMIN > Frames > Your own frames', () => {
  it('is the second card of the Frames section, after the built-in visibility card, and is searchable', () => {
    const frames = SECTIONS.find((s) => s.id === 'frames')!;
    expect(frames.cards.map((c) => c.id)).toEqual(['frames-visibility', 'frames-custom']);
    expect(searchSettings(SECTIONS, 'upload png').map((h) => h.card.id)).toContain('frames-custom');
    expect(searchSettings(SECTIONS, 'frame design').map((h) => h.card.id)).toContain('frames-visibility');
  });

  it('shows a loading note before the registry has loaded', () => {
    expect(html()).toContain('Loading your frames');
  });

  it('with nothing stored: explains how to start and offers NEW FRAME', async () => {
    await rt.initCustomFrames();
    const h = html();
    expect(h).toContain('NEW FRAME');
    expect(h).toContain('You have not made a frame yet');
    expect(h).toContain('transparent');
    expect(h).not.toContain('data-custom-frame');
  });

  it('says so, and offers no controls, when this browser cannot store frames', async () => {
    delete (globalThis as any).indexedDB; store.resetStore(); rt.resetCustomRuntime();
    await rt.initCustomFrames();
    const h = html();
    expect(h).toContain(store.MESSAGES.unavailable);
    expect(h).not.toContain('NEW FRAME');
  });

  it('lists all six layouts for a frame, marks the uploaded one ready and the others missing, with upload inputs', async () => {
    await rt.initCustomFrames();
    const c = await rt.createCustomFrame('Summer Party');
    if (!c.ok) throw new Error('create');
    await rt.setCustomLayoutArt(c.value.id, 'strip-3', art(3));
    const h = html();
    expect(h).toContain('SUMMER PARTY');
    expect(h).toContain(`data-custom-frame="${c.value.id}"`);
    for (const id of ['single', 'strip-2', 'strip-3', 'strip-4', 'grid-2x2', 'classic']) expect(h).toContain(`data-layout="${id}"`);
    expect(h).toContain('data-layout="strip-3" data-state="ready"');
    expect(h).toContain('data-layout="single" data-state="missing"');
    expect((h.match(/data-state="missing"/g) ?? []).length).toBe(5);
    expect(h).toContain('3 PHOTO WINDOWS, 1152 PX WIDE');
    expect(h).toContain('MISSING: NEEDS 1 PHOTO WINDOW');
    expect(h).toContain('aria-label="REPLACE THREE STRIP PICTURE"');
    expect(h).toContain('aria-label="UPLOAD SINGLE PICTURE"');
    expect(h).toContain('accept="image/png,image/webp"');
    expect(h).toContain('aria-label="REMOVE THREE STRIP PICTURE"');
    expect(h).toContain('Guests can pick this frame on: THREE STRIP.');
    expect(h).toContain('RENAME');
    expect(h).toContain('DELETE FRAME');
  });

  it('a frame with no pictures says guests cannot pick it yet', async () => {
    await rt.initCustomFrames();
    const c = await rt.createCustomFrame('Empty');
    if (!c.ok) throw new Error('create');
    const h = html();
    expect(h).toContain('Guests cannot pick this frame yet');
    expect(h).toContain('NO PICTURES YET');
    expect((h.match(/data-state="missing"/g) ?? []).length).toBe(6);
  });

  it('layout labels come from the layout names', () => {
    expect(layoutLabel('grid-2x2')).toBe('2 \u00D7 2');
    expect(layoutLabel('strip-2')).toBe('TWO STRIP');
  });
});

describe('ArtPreview', () => {
  const meta = { width: 1152, height: 2000, windows: art(3).windows, slots: art(3).slots };
  it('draws the picture, one placeholder photo per slot, and numbered outlines in order', () => {
    const h = renderToStaticMarkup(<ArtPreview src="blob:fake/1" meta={meta} />);
    expect(h).toContain('viewBox="0 0 1152 2000"');
    expect(h).toContain('href="blob:fake/1"');
    expect((h.match(/<linearGradient/g) ?? []).length).toBe(3);
    expect((h.match(/data-window=/g) ?? []).length).toBe(3);
    expect(h.indexOf('<linearGradient')).toBeLessThan(h.indexOf('<image'));
    expect(h.indexOf('<image')).toBeLessThan(h.indexOf('data-window="1"')); // photos under the art, outlines on top
    for (const k of [1, 2, 3]) expect(h).toContain(`>${k}</text>`);
    expect(h).toContain('3 numbered photo windows');
  });
  it('uses singular wording for one window', () => {
    expect(renderToStaticMarkup(<ArtPreview src="blob:x" meta={{ ...meta, windows: meta.windows.slice(0, 1), slots: meta.slots.slice(0, 1) }} />)).toContain('1 numbered photo window"');
  });
});
