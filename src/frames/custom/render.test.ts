// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import * as rt from './runtime';
import { CUSTOM_LAYOUT_IDS, validateArtwork } from './validate';
import { makeArt, SINGLE, STRIP, GRID, W, heightFor, type Fixture } from './fixtures';
import type { CustomLayoutId } from './types';
import { getFrame, framesForLayout, resolveFramed } from '../registry';
import { getFrameAsset } from '../assets';
import { FramePreview } from '../FrameLayer';
import { guestFramesForLayout, normalizeHidden } from '../visibility';
import { buildSnapshot, withFrame, addSticker } from '../../editor/model';
import { buildPlan, verifyPlanQr } from '../../render/plan';
import { renderPlan, renderOverlay, renderPrint, type RenderEnv } from '../../render/render';
import { makeCtx } from '../prims';
import { qrMatrix } from '../../share/qr';

const sets: Record<CustomLayoutId, typeof SINGLE> = { single: SINGLE, 'strip-2': STRIP(2), 'strip-3': STRIP(3), 'strip-4': STRIP(4), 'grid-2x2': GRID, classic: STRIP(4) };
const ctx = makeCtx('PHOTOBOOTH', new Date(2026, 9, 27, 14, 5));
const png = (c: { toBuffer(m: 'image/png'): Buffer }) => c.toBuffer('image/png');
const green = (() => { const c = createCanvas(1600, 900); const g = c.getContext('2d'); g.fillStyle = '#0f0'; g.fillRect(0, 0, 1600, 900); return 'data:image/png;base64,' + png(c).toString('base64'); })();
const srcs = [{ src: green, iw: 1600, ih: 900 }];

const bySize = new Map<number, Buffer>();
const env: RenderEnv = {
  canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
  image: (s) => loadImage(s.startsWith('blob:t/') ? bySize.get(Number(s.slice(7)))! : s) as unknown as Promise<CanvasImageSource>
};
let idb: FakeIndexedDB, frameId: string;
const fixtures = {} as Record<CustomLayoutId, Fixture>;

beforeEach(async () => {
  idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); rt.resetCustomRuntime(); bySize.clear();
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => `blob:t/${(b as Blob).size}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  const f = await rt.createCustomFrame('Test Frame'); if (!f.ok) throw new Error('create');
  frameId = f.value.id;
  for (const [i, id] of CUSTOM_LAYOUT_IDS.entries()) {
    const h = sets[id], fx = makeArt(W, heightFor(h) + i * 40, h); fixtures[id] = fx;
    const v = validateArtwork(id, fx); if (!v.ok) throw new Error(v.errors.join());
    const buf = fx.png; if (bySize.has(buf.length)) throw new Error('fixture sizes must differ');
    bySize.set(buf.length, buf);
    await rt.setCustomLayoutArt(frameId, id, { ...v.value, blob: new Blob([new Uint8Array(buf)], { type: 'image/png' }) });
  }
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); rt.resetCustomRuntime(); delete (globalThis as any).indexedDB; });

const px = (c: any, x: number, y: number) => [...c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data] as number[];
const isGreen = (p: number[]) => p[1] > 150 && p[0] < 110 && p[2] < 110;
const isArt = (p: number[]) => Math.abs(p[0] - 0xdd) < 30 && p[1] < 80 && p[2] < 80; // the fixture's opaque red

describe.each(CUSTOM_LAYOUT_IDS)('custom frame on %s', (layoutId) => {
  const holes = sets[layoutId];
  it('resolves its own geometry from the art: slots, height, no bands', () => {
    const L = resolveFramed(layoutId, frameId), fx = fixtures[layoutId];
    expect(L.slots).toHaveLength(holes.length);
    expect(L.height).toBe(Math.round((fx.height / fx.width) * 384));
    expect(L.header).toBeNull(); expect(L.footer).toBeNull();
    holes.forEach((h, i) => { expect(Math.abs(L.slots[i].x - (h.x - 3) / 3)).toBeLessThanOrEqual(1); expect(Math.abs(L.slots[i].w - (h.w + 6) / 3)).toBeLessThanOrEqual(1); });
  });
  it('is offered here, found as image artwork, and stretched', () => {
    expect(framesForLayout(layoutId).map((f) => f.id)).toContain(frameId);
    expect(getFrameAsset(getFrame(frameId), layoutId)).toMatchObject({ fit: 'stretch', layoutSpecific: true });
  });
  it.each([384, 576, 1152])('photo shows only inside the detected windows at width %i', async (wpx) => {
    const snap = withFrame(buildSnapshot(layoutId, srcs), frameId);
    const plan = buildPlan(snap, ctx, wpx), out: any = await renderPlan(plan, env);
    const fx = fixtures[layoutId], sx = out.width / fx.width, sy = out.height / fx.height;
    let windowArea = 0;
    for (const h of holes) {
      const x0 = h.x * sx, y0 = h.y * sy, w = h.w * sx, hh = h.h * sy;
      windowArea += w * hh;
      expect(isGreen(px(out, x0 + w / 2, y0 + hh / 2))).toBe(true);
      const inset = Math.max(2, 2 * sx * 3 / 3), out2 = 3 * Math.max(1, sx * 3);
      for (const t of [0.2, 0.5, 0.8]) {
        for (const [x, y] of [[x0 + w * t, y0 + inset], [x0 + w * t, y0 + hh - inset], [x0 + inset, y0 + hh * t], [x0 + w - inset, y0 + hh * t]]) expect(isGreen(px(out, x, y))).toBe(true); // no paper gap at the window edge
        for (const [x, y] of [[x0 + w * t, y0 - out2], [x0 + w * t, y0 + hh + out2], [x0 - out2, y0 + hh * t], [x0 + w + out2, y0 + hh * t]]) expect(isArt(px(out, x, y))).toBe(true); // photo never leaks onto the artwork
      }
    }
    const d = out.getContext('2d').getImageData(0, 0, out.width, out.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 150 && d[i] < 110 && d[i + 2] < 110) n++;
    expect(n / windowArea).toBeGreaterThan(0.985); expect(n / windowArea).toBeLessThan(1.015);
  }, 30000);
  it('print renderer works (1-bit roll width)', async () => {
    const r = await renderPrint(withFrame(buildSnapshot(layoutId, srcs), frameId), ctx, 80, env);
    expect(r.width).toBe(576);
  }, 30000);
  it('GIF overlay is transparent in the windows and opaque art elsewhere', async () => {
    const plan = buildPlan(withFrame(buildSnapshot(layoutId, srcs), frameId), ctx, 384), ov: any = await renderOverlay(plan, env);
    const fx = fixtures[layoutId], s = ov.width / fx.width, h = holes[0];
    expect(px(ov, (h.x + h.w / 2) * s, (h.y + h.h / 2) * s)[3]).toBe(0);
    expect(px(ov, (h.x + h.w / 2) * s, (h.y - 40) * s)[3]).toBe(255);
  }, 30000);
  it('stickers draw on top of the artwork', () => {
    const { snap } = addSticker(withFrame(buildSnapshot(layoutId, srcs), frameId), 'heart', 384, 700);
    const ops = buildPlan(snap, ctx, 384).cmds.map((c) => c.op);
    expect(ops.indexOf('sticker')).toBeGreaterThan(ops.indexOf('image-frame'));
    expect(ops.indexOf('image-frame')).toBeGreaterThan(ops.lastIndexOf('photo'));
  });
  it('picker thumbnail shows the art over one placeholder per window', () => {
    const html = renderToStaticMarkup(createElement(FramePreview, { frameId, layoutId }));
    expect(html).toContain(`blob:t/${fixtures[layoutId].png.length}`);
    expect(html.match(/<circle/g)).toHaveLength(holes.length);
  });
  it('QR: strip below the design when the frame declares no area', () => {
    const plan = buildPlan(withFrame(buildSnapshot(layoutId, srcs), frameId), ctx, 576, { matrix: qrMatrix('https://example.com/p/abc123'), paperDots: 576 });
    const q = plan.cmds.find((c) => c.op === 'qr') as any;
    expect(q.mode).toBe('strip'); expect(verifyPlanQr(plan)).toEqual({ ok: true });
    expect(plan.unitsH).toBeGreaterThan(resolveFramed(layoutId, frameId).height);
  });
});

describe('custom frame, other paths', () => {
  it('a declared QR safe area is used (placement inside the art, no extra strip)', async () => {
    const fx = fixtures.single, v = validateArtwork('single', fx); if (!v.ok) throw 0;
    const qr = { x: 0.3, y: (fx.height - 280) / fx.height, w: 0.4, h: 240 / fx.height }; // fractions of the canvas: x/w of its width, y/h of its height
    await rt.setCustomLayoutArt(frameId, 'single', { ...v.value, qr, blob: new Blob([new Uint8Array(fx.png)], { type: 'image/png' }) });
    expect(getFrame(frameId).qr?.byLayout?.single?.safeArea).toEqual(qr);
    const plan = buildPlan(withFrame(buildSnapshot('single', srcs), frameId), ctx, 576, { matrix: qrMatrix('https://example.com/p/abc'), paperDots: 576 });
    const q = plan.cmds.find((c) => c.op === 'qr') as any;
    expect(q.mode).toBe('safe-area'); expect(verifyPlanQr(plan)).toEqual({ ok: true });
  });
  it('a layout the frame has no art for is not offered, and a session that still has it falls back cleanly', async () => {
    await rt.removeCustomLayoutArt(frameId, 'grid-2x2');
    expect(framesForLayout('grid-2x2').map((f) => f.id)).not.toContain(frameId);
    expect(getFrameAsset(getFrame(frameId), 'grid-2x2')).toBeNull();
    const plan = buildPlan(withFrame(buildSnapshot('grid-2x2', srcs), frameId), ctx, 384);
    expect(plan.cmds.some((c) => c.op === 'image-frame')).toBe(false);
    await expect(renderPlan(plan, env)).resolves.toBeTruthy();
  });
  it('a deleted frame renders as the default frame, nothing throws', async () => {
    const snap = withFrame(buildSnapshot('single', srcs), frameId);
    await rt.deleteCustomFrame(frameId);
    const plan = buildPlan(snap, ctx, 384);
    expect(plan.cmds.some((c) => c.op === 'image-frame')).toBe(false);
    await expect(renderPlan(plan, env)).resolves.toBeTruthy();
  });
  it('built-in frames render exactly as before (geometry unchanged by the custom registry)', () => {
    const a = resolveFramed('strip-3', 'kawaii'), b = resolveFramed('strip-3', 'classic-receipt');
    expect(a.slots).toHaveLength(3); expect(b.slots).toHaveLength(3); expect(a.height).not.toBe(resolveFramed('strip-3', frameId).height);
  });
  it('visibility: custom frames show for the layouts they cover, are not hideable, and stored hidden ids for them are dropped harmlessly', () => {
    expect(guestFramesForLayout('single', [], null).map((f) => f.id)).toContain(frameId);
    expect(normalizeHidden([frameId, 'kawaii'])).toEqual(['kawaii']);
  });
  it('customReady resolves for built-in, unknown and custom frames', async () => {
    await expect(Promise.all([rt.customReady('kawaii'), rt.customReady('custom-nope'), rt.customReady(frameId, 'single'), rt.customReady()])).resolves.toBeTruthy();
  });
});
