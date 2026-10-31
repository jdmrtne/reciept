// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from '../../frames/custom/fakeIdb';
import * as store from '../../frames/custom/store';
import * as rt from '../../frames/custom/runtime';
import type { CustomLayoutArt } from '../../frames/custom/types';
import { DEFAULT_SETTINGS } from '../../config/settings';
import { ArtPreview, FALLBACK_MODULES, customFramesCard, layoutLabel, qrModulesFor } from './CustomFramesSection';
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
  it('Frames has the own-frames upload card after the built-in card; Events has no frame upload card any more (event layouts replace it)', () => {
    const frames = SECTIONS.find((s) => s.id === 'frames')!, events = SECTIONS.find((s) => s.id === 'events')!;
    expect(frames.cards.map((c) => c.id)).toEqual(['frames-visibility', 'frames-custom']);
    expect(events.cards.map((c) => c.id)).toEqual(['events-list', 'events-layouts', 'events-edit', 'events-preview']);
    expect(events.cards.map((c) => c.id)).not.toContain('events-special-frames'); // the old flat list card is gone
    expect(customFramesCard.title).toBe('Your own frames');
    const find = (q: string) => searchSettings(SECTIONS, q).map((h) => h.card.id);
    expect(find('upload png')).toContain('frames-custom');
    expect(find('upload png')).not.toContain('events-frames');
    expect(searchSettings(SECTIONS, 'frame design').map((h) => h.card.id)).toContain('frames-visibility');
  });

  it('an old event frame is not listed under Your own frames', async () => {
    await rt.initCustomFrames();
    const evId = DEFAULT_SETTINGS.events[0].id;
    const a = await rt.createCustomFrame('Own One'), b = await rt.createCustomFrame('Gala Special', true, evId);
    if (!a.ok || !b.ok) throw new Error('create');
    await rt.setCustomLayoutArt(a.value.id, 'single', art(1)); await rt.setCustomLayoutArt(b.value.id, 'single', art(1));
    expect(rt.customIsSpecial(a.value.id)).toBe(false);
    expect(rt.customIsSpecial(b.value.id)).toBe(true);
    const own = html();
    expect(own).toContain('OWN ONE'); expect(own).not.toContain('GALA SPECIAL');
  });

  it('has an ON/OFF switch per frame; OFF is shown on the frame button, and the pictures stay', async () => {
    await rt.initCustomFrames();
    const c = await rt.createCustomFrame('Gala Night');
    if (!c.ok) throw new Error('create');
    await rt.setCustomLayoutArt(c.value.id, 'single', art(1));
    let h = html();
    expect(h).toMatch(/role="switch"[^>]*aria-label="SHOW THIS FRAME TO GUESTS"|aria-checked="true"[^>]*aria-label="SHOW THIS FRAME TO GUESTS"/);
    expect(h).not.toContain('(OFF)');
    await rt.setCustomEnabled(c.value.id, false);
    h = html();
    expect(h).toContain('GALA NIGHT (OFF)');
    expect(h).toMatch(/aria-checked="false"[^>]*aria-label="SHOW THIS FRAME TO GUESTS"/);
    expect(h).toContain('data-layout="single" data-state="ready"');
  });

  it('shows a loading note before the registry has loaded', () => {
    expect(html()).toContain('Loading your frames');
  });

  it('with nothing stored: explains how to start and offers NEW FRAME', async () => {
    await rt.initCustomFrames();
    const h = html();
    expect(h).toContain('NEW FRAME');
    expect(h).toContain('You have not made a frame yet');
    expect(h).toContain('see-through');
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

describe('QR spot in the panel (Phase 5)', () => {
  const SPOT = { x: 0.1, y: 0.7, w: 0.8, h: 0.25 };
  const meta = { width: 1152, height: 2000, windows: art(1).windows, slots: art(1).slots };

  it('a row says when a QR spot is set, and nothing about it when not', async () => {
    await rt.initCustomFrames();
    const c = await rt.createCustomFrame('Spot');
    if (!c.ok) throw new Error('create');
    await rt.setCustomLayoutArt(c.value.id, 'single', art(1));
    expect(html()).not.toContain('QR SPOT SET');
    await rt.setCustomLayoutQr(c.value.id, 'single', SPOT);
    expect(html()).toContain('1152 PX WIDE, QR SPOT SET');
  });

  it('warns on the row, with the consequence, when a saved spot is now too small for the site address', async () => {
    await rt.initCustomFrames();
    const c = await rt.createCustomFrame('Tiny');
    if (!c.ok) throw new Error('create');
    await rt.setCustomLayoutArt(c.value.id, 'single', art(1));
    await rt.setCustomLayoutQr(c.value.id, 'single', { x: 0.1, y: 0.7, w: 0.1, h: 0.05 });
    const h = html();
    expect(h).toContain('data-qr-warning="true"');
    expect(h).toContain('printing is blocked on this layout');
    await rt.setCustomLayoutQr(c.value.id, 'single', SPOT);
    expect(html()).not.toContain('data-qr-warning');
  });

  it('ArtPreview draws the saved spot and the spot being drawn, and offers a drawing surface only when asked', () => {
    const plain = renderToStaticMarkup(<ArtPreview src="blob:x" meta={meta} />);
    expect(plain).not.toContain('data-spot=');
    expect(plain).not.toContain('data-draw-surface');
    const withSpots = renderToStaticMarkup(<ArtPreview src="blob:x" meta={meta} qr={SPOT} draft={{ x: 0.2, y: 0.8, w: 0.5, h: 0.15 }} />);
    expect(withSpots).toContain('data-spot="saved"');
    expect(withSpots).toContain('data-spot="draft"');
    expect(withSpots).toContain('QR SPOT');
    expect(withSpots).toContain('NEW SPOT');
    expect(withSpots).not.toContain('data-draw-surface');
    const drawing = renderToStaticMarkup(<ArtPreview src="blob:x" meta={meta} drawing onSpot={() => {}} />);
    expect(drawing).toContain('data-draw-surface="true"');
    expect(drawing).toContain('touch-action:none');
    expect(drawing.indexOf('data-draw-surface')).toBeGreaterThan(drawing.indexOf('data-window="1"')); // surface on top, so it receives the pointer
  });

  it('sizes the spot for the QR the booth really prints, with slack, and never throws', () => {
    const n = qrModulesFor({ share: { enabled: true, publicBaseUrl: 'https://booth.example.com' } }, 'https://booth.example.com');
    expect(n).toBeGreaterThanOrEqual(21 + 4);
    expect(n).toBeLessThan(80);
    expect(qrModulesFor({ share: { enabled: false, publicBaseUrl: '' } }, '')).toBeGreaterThan(0);
    expect(qrModulesFor({ share: undefined as any }, '')).toBe(FALLBACK_MODULES);
  });
});
