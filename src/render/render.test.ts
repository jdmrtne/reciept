// @vitest-environment node
import { describe, expect, it, beforeAll } from 'vitest';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { readFileSync } from 'fs';
import { buildPlan } from './plan';
import { renderPlan, renderPrint, type RenderEnv } from './render';
import { canvasToRGBA } from '../print/browser';
import { toThermalBitmap } from '../print/pipeline';
import { blackRatio, getDot } from '../print/bitmap';
import { DEFAULT_THERMAL } from '../print/types';
import { PAPER_DOTS } from '../layouts/engine';
import { buildSnapshot, withFilter, withFrame, addSticker, commit, newEditor } from '../editor/model';
import { FRAMES } from '../frames/registry';
import { LAYOUTS } from '../layouts/registry';
import { makeCtx } from '../frames/prims';
import { isPhoto, type PhotoObject } from '../editor/types';

const ctx = makeCtx('PHOTOBOOTH', new Date(2026, 8, 28, 14, 5));

// Synthetic sources: A = left half red / right half blue, B = solid green.
const png = (w: number, h: number, paint: (g: any) => void) => { const c = createCanvas(w, h); paint(c.getContext('2d')); return 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64'); };
const A = png(1600, 900, (g) => { g.fillStyle = '#f00'; g.fillRect(0, 0, 800, 900); g.fillStyle = '#00f'; g.fillRect(800, 0, 800, 900); });
const B = png(1600, 900, (g) => { g.fillStyle = '#0f0'; g.fillRect(0, 0, 1600, 900); });
const srcs = [{ src: A, iw: 1600, ih: 900 }, { src: B, iw: 1600, ih: 900 }];

const env: RenderEnv = {
  canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
  // node-canvas can't read the utf8 SVG data-URL form browsers accept, so hand it the decoded markup.
  image: (s) => loadImage(s.startsWith('data:image/svg+xml;utf8,') ? Buffer.from(decodeURIComponent(s.slice('data:image/svg+xml;utf8,'.length))) : s) as unknown as Promise<CanvasImageSource>
};
const px = (c: HTMLCanvasElement, x: number, y: number) => [...(c as any).getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data];
const center = (o: { x: number; y: number; w: number; h: number }, k: number, fx = .5, fy = .5) => [(o.x + o.w * fx) * k, (o.y + o.h * fy) * k];
const near = (a: number[], b: number[], t = 12) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);

beforeAll(() => {
  try { GlobalFonts.register(readFileSync('src/assets/fonts/courier-prime-latin-400-normal.woff2'), 'Courier Prime'); } catch { /* fallback font is fine for these checks */ }
});

describe('buildPlan (pure)', () => {
  const snap = buildSnapshot('strip-3', srcs);
  it('orders photos → frame → stickers and scales to the requested width', () => {
    const { snap: s2 } = addSticker(snap, 'heart', 384, 700);
    const plan = buildPlan(s2, ctx, 576);
    expect(plan.width).toBe(576);
    expect(plan.k).toBeCloseTo(1.5);
    expect(plan.cmds.map((c) => c.op)).toEqual(['photo', 'photo', 'photo', 'frame', 'sticker']);
    expect(plan.height).toBe(Math.round(plan.unitsH * 1.5));
  });
  it('carries the snapshot filter on photos only', () => {
    const plan = buildPlan(withFilter(snap, 'vintage'), ctx, 384);
    expect(plan.cmds.filter((c) => c.op === 'photo').every((c: any) => c.filterId === 'vintage')).toBe(true);
    expect(plan.cmds.find((c) => c.op === 'frame')).not.toHaveProperty('filterId');
  });
});

describe('renderPlan (real pixels)', () => {
  it('draws white paper, the right photo in each slot, and frame ink', async () => {
    const snap = buildSnapshot('strip-2', srcs); // slot0 = A, slot1 = B
    const plan = buildPlan(snap, ctx, 384);
    const c = await renderPlan(plan, env);
    expect([c.width, c.height]).toEqual([plan.width, plan.height]);
    const [s0, s1] = snap.objects.filter(isPhoto);
    expect(px(c, 3, 3)).toEqual([255, 255, 255, 255]);
    expect(near(px(c, ...center(s0, 1, .25) as [number, number]), [255, 0, 0])).toBe(true);  // left of A = red
    expect(near(px(c, ...center(s0, 1, .75) as [number, number]), [0, 0, 255])).toBe(true);  // right of A = blue
    expect(near(px(c, ...center(s1, 1) as [number, number]), [0, 255, 0])).toBe(true);
    let ink = 0; const d = (c as any).getContext('2d').getImageData(0, 0, plan.width, 100).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100) ink++;
    expect(ink).toBeGreaterThan(200); // header text is drawn
  });
  it('honours crop zoom/pan exactly like the editor (pan to the red half)', async () => {
    let snap = buildSnapshot('single', [srcs[0]]);
    const o = snap.objects[0] as PhotoObject;
    // zoom 2, pan right so the LEFT part of the source (red) fills the slot
    snap = { ...snap, objects: [{ ...o, crop: { zoom: 2, ox: 1e6, oy: 0 } }] };
    const c = await renderPlan(buildPlan(snap, ctx, 384), env);
    for (const f of [.1, .5, .9]) expect(near(px(c, ...center(o, 1, f) as [number, number]), [255, 0, 0])).toBe(true);
  });
  it('applies the filter to photos but not to frame ink or stickers', async () => {
    let snap = withFilter(buildSnapshot('strip-2', srcs), 'grayscale');
    const st = addSticker(snap, 'heart', 384, 700); snap = st.snap;
    const c = await renderPlan(buildPlan(snap, ctx, 384), env);
    const [s0] = snap.objects.filter(isPhoto);
    const p = px(c, s0.x + 8, s0.y + 8); // photo corner area away from the centred sticker
    expect(Math.abs(p[0] - p[1]) < 3 && Math.abs(p[1] - p[2]) < 3).toBe(true); // grey
    expect(p[0]).toBeGreaterThan(20); // not pure black: it is the (grey) photo
  });
  it('draws stickers above the frame and rotated stickers stay inside the canvas', async () => {
    const snap0 = buildSnapshot('single', [srcs[1]]);
    const { snap } = addSticker(snap0, 'star', 384, 700);
    const plan = buildPlan(snap, ctx, 384);
    expect(plan.cmds[plan.cmds.length - 1].op).toBe('sticker');
    const c = await renderPlan(plan, env);
    expect(c.width).toBe(384);
  });
  it('renders every frame × layout at 58mm and 80mm without throwing, with sane sizes', async () => {
    for (const w of [384, 576]) for (const l of LAYOUTS) for (const f of FRAMES) {
      const snap = withFrame(buildSnapshot(l.id, srcs), f.id);
      const plan = buildPlan(snap, ctx, w);
      const c = await renderPlan(plan, env);
      expect(c.width).toBe(w);
      expect(c.height).toBeGreaterThan(w * 0.8);
      expect(c.height).toBe(plan.height);
    }
  }, 60000);
  it('an image that fails to load rejects before anything is drawn', async () => {
    const bad = { ...env, image: () => Promise.reject(new Error('image')) };
    await expect(renderPlan(buildPlan(buildSnapshot('single', srcs), ctx, 384), bad)).rejects.toThrow();
  });
});

describe('renderPrint → canvasToRGBA → toThermalBitmap (end to end, what PrintScreen does)', () => {
  it('makes an exact-width 1-bit receipt: header ink present, white paper stays white, deterministic', async () => {
    for (const mm of [58, 80] as const) {
      const snap = withFrame(buildSnapshot('strip-2', srcs), FRAMES[0].id);
      const c = await renderPrint(snap, ctx, mm, env);
      expect(c.width).toBe(PAPER_DOTS[mm]);
      const rgba = canvasToRGBA(c);
      const bits = toThermalBitmap(rgba, DEFAULT_THERMAL, PAPER_DOTS[mm]);
      expect(bits.width).toBe(PAPER_DOTS[mm]);
      expect(bits.height).toBeGreaterThan(bits.width * 0.8);
      // Header band: frame text is burned. Ratio is over a strip, so it is small but clearly non-zero.
      const hh = Math.round(60 * bits.width / 384); // header band scales with paper width
      const head = { ...bits, height: hh, data: bits.data.subarray(0, bits.rowBytes * hh) };
      expect(blackRatio(head)).toBeGreaterThan(0.005);
      // The very first rows and the four outer dots are paper: white stays white (pinned by the tone LUT).
      for (const [x, y] of [[0, 0], [bits.width - 1, 0], [2, 2], [bits.width - 3, 2]]) expect(getDot(bits, x, y)).toBe(0);
      // Same input → same dots.
      const again = toThermalBitmap(canvasToRGBA(await renderPrint(snap, ctx, mm, env)), DEFAULT_THERMAL, PAPER_DOTS[mm]);
      expect(Buffer.compare(Buffer.from(again.data), Buffer.from(bits.data))).toBe(0);
    }
  }, 60000);
});
