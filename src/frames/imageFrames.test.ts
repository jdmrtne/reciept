// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

// Frame artwork lookup is replaced by a controllable one so the pipeline can be exercised without shipping PNGs.
const art = vi.hoisted(() => ({ map: {} as Record<string, { src: string; fit: 'stretch' | 'cover'; layoutSpecific: boolean }> }));
vi.mock('./assets', async (orig) => {
  const real = await orig<typeof import('./assets')>();
  return { ...real, getFrameAsset: (f: { id: string }, layoutId: string) => art.map[`${f.id}/${layoutId}`] ?? art.map[`${f.id}/default`] ?? null };
});

import { buildAssetIndex, resolveFrameAsset } from './assets';
import { FRAMES, IMAGE_FRAMES, getFrame, getFrameBands, isImageFrame, resolveFramed, vectorFrameOf } from './registry';
import { LAYOUTS } from '../layouts/registry';
import { resolveLayout } from '../layouts/engine';
import { getLayout } from '../layouts/registry';
import { buildSnapshot, withFrame, addSticker, keepStickers } from '../editor/model';
import { buildPlan } from '../render/plan';
import { renderPlan, renderOverlay, renderPrint, type RenderEnv } from '../render/render';
import { makeCtx } from './prims';
import { isPhoto } from '../editor/types';

const ctx = makeCtx('PHOTOBOOTH', new Date(2026, 8, 28, 14, 5));
const png = (w: number, h: number, paint: (g: any) => void) => { const c = createCanvas(w, h); paint(c.getContext('2d')); return 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64'); };
const GREEN = png(1600, 900, (g) => { g.fillStyle = '#0f0'; g.fillRect(0, 0, 1600, 900); });
const srcs = [{ src: GREEN, iw: 1600, ih: 900 }];
const env: RenderEnv = {
  canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
  image: (s) => loadImage(s.startsWith('data:image/svg+xml;utf8,') ? Buffer.from(decodeURIComponent(s.slice('data:image/svg+xml;utf8,'.length))) : s) as unknown as Promise<CanvasImageSource>
};
const px = (c: HTMLCanvasElement, x: number, y: number) => [...(c as any).getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data];
const near = (a: number[], b: number[], t = 12) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);

/** Synthetic frame art for frame×layout: opaque magenta everywhere except transparent windows exactly at the layout's slots (art scale s×). */
const makeArt = (frameId: string, layoutId: string, s = 4) => {
  const L = resolveFramed(layoutId, frameId);
  return png(L.width * s, L.height * s, (g) => {
    g.fillStyle = '#f0f'; g.fillRect(0, 0, L.width * s, L.height * s);
    for (const r of L.slots) g.clearRect(r.x * s, r.y * s, r.w * s, r.h * s);
  });
};
const install = (frameId: string, layoutId: string | 'default', src: string, fit: 'stretch' | 'cover' = 'stretch') => { art.map[`${frameId}/${layoutId}`] = { src, fit, layoutSpecific: layoutId !== 'default' }; };
beforeEach(() => { art.map = {}; });

describe('asset resolution (frameId + layoutId)', () => {
  const kawaii = getFrame('kawaii');
  it('indexes src/assets/frames/<dir>/<name>.png|webp', () => {
    expect(buildAssetIndex({ '../assets/frames/kawaii/strip-2.png': '/a.png', '../assets/frames/retro/default.webp': '/b.webp', '../assets/frames/x.png': '/no' }))
      .toEqual({ 'kawaii/strip-2': '/a.png', 'retro/default': '/b.webp' });
  });
  it('layout-specific → default.png → null (vector fallback)', () => {
    const idx = { 'kawaii/strip-2': '/s2.png', 'kawaii/default': '/d.png' };
    expect(resolveFrameAsset(idx, kawaii, 'strip-2')).toEqual({ src: '/s2.png', fit: 'stretch', layoutSpecific: true });
    expect(resolveFrameAsset(idx, kawaii, 'single')).toEqual({ src: '/d.png', fit: 'cover', layoutSpecific: false }); // generic art is never stretched
    expect(resolveFrameAsset({ 'kawaii/strip-2': '/s2.png' }, kawaii, 'single')).toBeNull();
    expect(resolveFrameAsset({}, kawaii, 'single')).toBeNull();
  });
  it('vector frames never resolve artwork, and one frame dir never leaks into another', () => {
    expect(resolveFrameAsset({ 'classic-receipt/single': '/x.png' }, getFrame('classic-receipt'), 'single')).toBeNull();
    expect(resolveFrameAsset({ 'retro/single': '/r.png' }, kawaii, 'single')).toBeNull();
  });
  it('changing layout or frame changes the resolved asset', () => {
    const idx = buildAssetIndex(Object.fromEntries(['kawaii', 'retro'].flatMap((d) => LAYOUTS.map((l) => [`../assets/frames/${d}/${l.id}.png`, `/${d}-${l.id}.png`]))));
    const at = (f: string, l: string) => resolveFrameAsset(idx, getFrame(f), l)?.src;
    expect(at('kawaii', 'single')).toBe('/kawaii-single.png');
    expect(at('kawaii', 'strip-4')).toBe('/kawaii-strip-4.png');
    expect(at('kawaii', 'grid-2x2')).toBe('/kawaii-grid-2x2.png');
    expect(at('retro-film', 'grid-2x2')).toBe('/retro-grid-2x2.png');
  });
});

describe('registry', () => {
  it('keeps every vector frame and adds the image frames', () => {
    for (const id of ['classic-receipt', 'minimal-receipt', 'retro-receipt', 'ticket-stub', 'wanted-bounty', 'straw-hat-wanted', 'birthday', 'graduation', 'friends', 'couple', 'event'])
      expect(isImageFrame(getFrame(id)), id).toBe(false);
    expect(FRAMES[0].id).toBe('classic-receipt');
    expect(IMAGE_FRAMES.map((f) => f.id)).toEqual(['kawaii', 'retro-film', 'better-together', 'kawaii-pets', 'just-us', 'retro-memories', 'halloween', 'pink-you-me', 'stay-real', 'summer-vibes', 'neon-gaming', 'manga-panel', 'pop-stickers', 'manga-comic']);
    expect(IMAGE_FRAMES.every((f) => isImageFrame(f) && FRAMES.includes(f))).toBe(true);
    expect(new Set(FRAMES.map((f) => f.id)).size).toBe(FRAMES.length);
  });
  it('the layout engine stays the source of truth for photo slots, for every layout × image frame', () => {
    for (const f of IMAGE_FRAMES) for (const l of LAYOUTS) {
      const b = getFrameBands(f, l.id), L = resolveFramed(l.id, f.id);
      expect(L.slots).toEqual(resolveLayout(getLayout(l.id), 384, b).slots);
      expect(L.slots.length).toBe(resolveLayout(l, 384).slots.length);
    }
  });
  it('per-layout band overrides change the canvas, other layouts keep the frame default', () => {
    const f = { ...getFrame('kawaii'), image: { dir: 'kawaii', bands: { 'strip-2': { headerHeight: 10, footerHeight: 100 } } } };
    expect(getFrameBands(f, 'strip-2')).toEqual({ headerHeight: 10, footerHeight: 100 });
    expect(getFrameBands(f, 'single')).toEqual({ headerHeight: f.headerHeight, footerHeight: f.footerHeight });
  });
  it('an image frame without artwork draws a plain vector border (never nothing weird)', () => {
    expect(isImageFrame(vectorFrameOf(getFrame('kawaii')))).toBe(false);
    expect(vectorFrameOf(getFrame('minimal-receipt'))).toBe(getFrame('minimal-receipt'));
  });
});

describe('render plan', () => {
  it('no artwork → the old photo…frame…sticker plan (vector fallback, slot borders kept)', () => {
    const { snap } = addSticker(withFrame(buildSnapshot('strip-3', srcs), 'kawaii'), 'heart', 384, 700);
    const plan = buildPlan(snap, ctx, 384);
    expect(plan.cmds.map((c) => c.op)).toEqual(['photo', 'photo', 'photo', 'frame', 'sticker']);
    expect(plan.cmds.filter((c) => c.op === 'photo').every((c: any) => !c.noBorder)).toBe(true);
  });
  it('artwork → photos → image-frame → stickers, with the layout-specific file', () => {
    for (const l of LAYOUTS) {
      const frameId = 'kawaii';
      install(frameId, l.id, `/kawaii-${l.id}.png`);
      const { snap } = addSticker(withFrame(buildSnapshot(l.id, srcs), frameId), 'heart', 384, 700);
      const plan = buildPlan(snap, ctx, 576), ops = plan.cmds.map((c) => c.op);
      const n = ops.filter((o) => o === 'photo').length;
      expect(n).toBe(resolveFramed(l.id, frameId).slots.length);
      expect(ops).toEqual([...Array(n).fill('photo'), 'image-frame', 'sticker']);
      const fr = plan.cmds.find((c) => c.op === 'image-frame') as any;
      expect(fr).toMatchObject({ src: `/kawaii-${l.id}.png`, fit: 'stretch', w: plan.unitsW, h: plan.unitsH });
      expect(plan.cmds.filter((c) => c.op === 'photo').every((c: any) => c.noBorder)).toBe(true);
    }
  });
  it('switching layout keeps frame + stickers and swaps the artwork; switching frame keeps photos/crops/stickers', () => {
    install('kawaii', 'single', '/k-single.png'); install('kawaii', 'strip-4', '/k-strip-4.png'); install('retro-film', 'strip-4', '/r-strip-4.png');
    let s = withFrame(buildSnapshot('single', srcs), 'kawaii');
    s = addSticker(s, 'star', 384, 700).snap;
    expect((buildPlan(s, ctx, 384).cmds.find((c) => c.op === 'image-frame') as any).src).toBe('/k-single.png');
    const s4 = keepStickers(s, buildSnapshot('strip-4', srcs, s.frameId));
    expect(s4.frameId).toBe('kawaii');
    expect(s4.objects.some((o) => o.type === 'sticker')).toBe(true);
    expect((buildPlan(s4, ctx, 384).cmds.find((c) => c.op === 'image-frame') as any).src).toBe('/k-strip-4.png');
    const r4 = withFrame(s4, 'retro-film');
    expect((buildPlan(r4, ctx, 384).cmds.find((c) => c.op === 'image-frame') as any).src).toBe('/r-strip-4.png');
    expect(r4.objects.filter(isPhoto).map((o) => o.src)).toEqual(s4.objects.filter(isPhoto).map((o) => o.src));
    expect(r4.objects.some((o) => o.type === 'sticker')).toBe(true);
  });
  it('vector frames are untouched by the image-frame machinery', () => {
    install('kawaii', 'default', '/d.png');
    const plan = buildPlan(buildSnapshot('single', srcs, 'classic-receipt'), ctx, 384);
    expect(plan.cmds.map((c) => c.op)).toEqual(['photo', 'frame']);
  });
});

describe('rendering (real pixels)', () => {
  it('photos show through transparent windows; the border is opaque; stickers sit above the art; every layout × image frame × paper width', async () => {
    for (const w of [384, 576]) for (const l of LAYOUTS) for (const f of IMAGE_FRAMES) {
      install(f.id, l.id, makeArt(f.id, l.id));
      const { snap } = addSticker(withFrame(buildSnapshot(l.id, srcs), f.id), 'heart', 384, 700);
      const plan = buildPlan(snap, ctx, w), c = await renderPlan(plan, env), k = plan.k;
      expect([c.width, c.height]).toEqual([plan.width, plan.height]);
      const L = resolveFramed(l.id, f.id);
      expect(near(px(c, 2, 2), [255, 0, 255]), `${f.id}/${l.id} corner`).toBe(true); // artwork covers the margin
      // a point well inside each slot that is clear of the (centred) sticker is photo green
      const st = snap.objects.find((o) => o.type === 'sticker')!;
      let seen = 0;
      for (const s of L.slots) {
        const x = (s.x + s.w * 0.06), y = (s.y + s.h * 0.06);
        if (x > st.x && x < st.x + st.w && y > st.y && y < st.y + st.h) continue;
        expect(near(px(c, x * k, y * k), [0, 255, 0]), `${f.id}/${l.id} window`).toBe(true);
        seen++;
      }
      expect(seen).toBeGreaterThan(0);
      // stickers are drawn OVER the art: the sticker's box differs from the same render without it, and the art outside it is unchanged
      const bare = await renderPlan(buildPlan(withFrame(buildSnapshot(l.id, srcs), f.id), ctx, w), env);
      const a = (c as any).getContext('2d').getImageData(Math.round(st.x * k), Math.round(st.y * k), Math.max(1, Math.round(st.w * k)), Math.max(1, Math.round(st.h * k))).data;
      const b = (bare as any).getContext('2d').getImageData(Math.round(st.x * k), Math.round(st.y * k), Math.max(1, Math.round(st.w * k)), Math.max(1, Math.round(st.h * k))).data;
      let diff = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 40) diff++;
      expect(diff, `${f.id}/${l.id}/${w} sticker visible over frame`).toBeGreaterThan(50);
      expect(px(c, 2, 2)).toEqual(px(bare, 2, 2));
    }
  }, 120000);
  it("'cover' keeps artwork undistorted: a wide generic PNG is cropped, not squashed", async () => {
    // 2:1 art with a magenta square in the centre; canvas is portrait, so the centre square must stay square.
    install('kawaii', 'default', png(2000, 1000, (g) => { g.fillStyle = '#00f'; g.fillRect(0, 0, 2000, 1000); g.fillStyle = '#f0f'; g.fillRect(750, 250, 500, 500); }), 'cover');
    const snap = withFrame(buildSnapshot('single', srcs), 'kawaii');
    const plan = buildPlan(snap, ctx, 384), c = await renderPlan(plan, env);
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    const d = (c as any).getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
    expect((maxX - minX) / (maxY - minY)).toBeGreaterThan(0.95);
    expect((maxX - minX) / (maxY - minY)).toBeLessThan(1.05);
  });
  it('overlay (GIF path) + photo tiles equals the full composite with artwork', async () => {
    install('better-together', 'grid-2x2', makeArt('better-together', 'grid-2x2'));
    const snap = withFrame(buildSnapshot('grid-2x2', srcs), 'better-together');
    const plan = buildPlan(snap, ctx, 320), whole = await renderPlan(plan, env), ov = await renderOverlay(plan, env);
    expect(px(ov, 2, 2)[3]).toBe(255); // artwork is on the overlay
    const L = resolveFramed('grid-2x2', 'better-together');
    expect(px(ov, (L.slots[0].x + 10) * plan.k, (L.slots[0].y + 10) * plan.k)[3]).toBe(0); // window stays transparent for the GIF's photo tiles
    expect(px(whole, 2, 2)).toEqual(px(ov, 2, 2));
  });
  it('print render at 58mm / 80mm still returns exact paper widths with artwork', async () => {
    install('retro-film', 'strip-4', makeArt('retro-film', 'strip-4'));
    const snap = withFrame(buildSnapshot('strip-4', srcs), 'retro-film');
    expect((await renderPrint(snap, ctx, 58, env)).width).toBe(384);
    expect((await renderPrint(snap, ctx, 80, env)).width).toBe(576);
  });
  it('a frame image that fails to load rejects before anything is drawn', async () => {
    install('kawaii', 'single', '/missing.png');
    const bad = { ...env, image: (s: string) => (s === '/missing.png' ? Promise.reject(new Error('image')) : env.image(s)) };
    await expect(renderPlan(buildPlan(withFrame(buildSnapshot('single', srcs), 'kawaii'), ctx, 384), bad)).rejects.toThrow();
  });
});

// Validates the REAL artwork in src/assets/frames (png or webp; skips when none is supplied yet): right aspect for its layout, and real transparency.
describe('supplied artwork on disk', () => {
  const root = join(process.cwd(), 'src/assets/frames');
  const files: [string, string, string][] = [];
  if (existsSync(root)) for (const d of readdirSync(root)) if (statSync(join(root, d)).isDirectory())
    for (const n of readdirSync(join(root, d))) if (/\.(png|webp)$/.test(n)) files.push([d, n.replace(/\.(png|webp)$/, ''), join(root, d, n)]);
  it.skipIf(!files.length)('layout-specific art matches the canvas aspect (±1.5%) and has transparent photo windows', async () => {
    for (const [dir, name, path] of files) {
      const img = await loadImage(readFileSync(path)), w = img.width, h = img.height;
      const f = IMAGE_FRAMES.find((x) => x.image!.dir === dir);
      expect(f, `no registry entry uses folder ${dir}`).toBeTruthy();
      const c = createCanvas(64, Math.max(1, Math.round((64 * h) / w))), g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      let clear = 0; for (let i = 3; i < px.length; i += 4) if (px[i] < 40) clear++;
      expect(clear, `${dir}/${name} has no transparent photo window`).toBeGreaterThan(20);
      if (name === 'default' || !f) continue;
      const L = resolveFramed(name, f.id);
      expect(Math.abs(w / h / (L.width / L.height) - 1), `${dir}/${name} is ${w}x${h}, canvas aspect is ${(L.width / L.height).toFixed(4)}`).toBeLessThan(0.015);
    }
  }, 60000);
  it.skipIf(!files.length)('every registered image frame ships artwork for every layout', () => {
    for (const f of IMAGE_FRAMES) for (const l of LAYOUTS) expect(files.some(([d, n]) => d === f.image!.dir && n === l.id), `${f.id}/${l.id}`).toBe(true);
  });
});
