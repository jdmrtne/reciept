// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync } from 'fs';
import { join } from 'path';
import { STICKERS, getSticker, stickerAspect } from './registry';
import { addSticker, buildSnapshot, stickerWidthRange, MIN_STICKER, hitSticker, stickerCorner } from '../editor/model';
import { buildPlan } from '../render/plan';
import { renderOverlay, renderPlan, type RenderEnv } from '../render/render';
import { makeCtx } from '../frames/prims';
import { isSticker } from '../editor/types';
import { renderPrint } from '../render/render';
import { canvasToRGBA } from '../print/browser';
import { toThermalBitmap } from '../print/pipeline';
import { blackRatio } from '../print/bitmap';
import { DEFAULT_THERMAL } from '../print/types';
import { PAPER_DOTS } from '../layouts/engine';

const ctx = makeCtx('PHOTOBOOTH', new Date(2026, 8, 28, 14, 5));
const root = process.cwd();
// Vite hands back '/src/assets/stickers/x.png' in tests; read the real file from disk.
const fromUrl = (s: string) => (s.startsWith('/') ? readFileSync(join(root, s.split('?')[0])) : s);
const env: RenderEnv = {
  canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
  image: (s) => loadImage(s.startsWith('data:image/svg+xml;utf8,') ? Buffer.from(decodeURIComponent(s.slice('data:image/svg+xml;utf8,'.length))) : (fromUrl(s) as any)) as unknown as Promise<CanvasImageSource>
};
const green = 'data:image/png;base64,' + (() => { const c = createCanvas(40, 40); const g = c.getContext('2d'); g.fillStyle = '#0f0'; g.fillRect(0, 0, 40, 40); return c.toBuffer('image/png').toString('base64'); })();
const base = buildSnapshot('single', [{ src: green, iw: 40, ih: 40 }]);
const PNG = STICKERS.filter((s) => s.src);

describe('PNG sticker pack', () => {
  it('registers all 28 stickers, in order, with unique ids and a loadable file each', async () => {
    expect(PNG).toHaveLength(28);
    expect(PNG.map((s) => s.id)).toEqual(Array.from({ length: 28 }, (_, i) => `sticker_${String(i + 1).padStart(3, '0')}`));
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length);
    for (const s of PNG) {
      const img = await loadImage(fromUrl(s.src!) as any);
      expect([s.id, img.width, img.height]).toEqual([s.id, s.iw, s.ih]); // table matches the real file
    }
  });
  it('keeps the SVG stickers and the fallback unchanged', () => {
    expect(STICKERS.filter((s) => !s.src)).toHaveLength(24);
    expect(getSticker('nope').id).toBe('heart');
    expect(stickerAspect('heart')).toBe(1);
  });
});

describe('placing PNG stickers', () => {
  it('keeps each sticker aspect ratio, a similar visual size, and centres it on the canvas', () => {
    for (const s of PNG) {
      const o = addSticker(base, s.id, 384, 700).snap.objects.filter(isSticker)[0];
      expect(o.h / o.w).toBeCloseTo(s.ih! / s.iw!, 6);
      expect(Math.max(o.w, o.h)).toBeLessThanOrEqual(384 * 0.45 + 1e-6); // never bigger than 45% of the paper
      expect(Math.min(o.w, o.h)).toBeGreaterThanOrEqual(MIN_STICKER);
      expect(Math.sqrt(o.w * o.h)).toBeGreaterThan(384 * 0.3 * 0.7); // not tiny next to a square sticker (side = 30%)
      expect(o.x + o.w / 2).toBeCloseTo(192, 6); expect(o.y + o.h / 2).toBeCloseTo(350, 6);
    }
    const sq = addSticker(base, 'heart', 384, 700).snap.objects.filter(isSticker)[0];
    expect([sq.w, sq.h]).toEqual([384 * 0.3, 384 * 0.3]); // existing SVG stickers keep their old default size
  });
  it('resize limits keep the short side grabbable and the long side on the paper', () => {
    for (const ar of [0.5, 1, 2.93]) {
      const r = stickerWidthRange(ar, 460);
      expect(Math.min(r.min, r.min * ar)).toBeCloseTo(MIN_STICKER, 6);
      expect(Math.max(r.max, r.max * ar)).toBeCloseTo(460, 6);
    }
  });
  it('multiple stickers coexist with their own geometry; hit test and handle follow the real box', () => {
    let s = addSticker(base, 'sticker_003', 384, 700).snap;
    s = addSticker(s, 'sticker_005', 384, 700).snap;
    s = addSticker(s, 'sticker_011', 384, 700).snap;
    const st = s.objects.filter(isSticker);
    expect(st.map((o) => o.stickerId)).toEqual(['sticker_003', 'sticker_005', 'sticker_011']);
    expect(new Set(st.map((o) => o.id)).size).toBe(3);
    const tall = st[0];
    expect(hitSticker(tall, { x: tall.x + tall.w / 2, y: tall.y + 2 })).toBe(true);
    expect(hitSticker(tall, { x: tall.x + tall.w + 5, y: tall.y + tall.h / 2 })).toBe(false);
    const k = stickerCorner(tall);
    expect(k.x).toBeCloseTo(tall.x + tall.w, 6); expect(k.y).toBeCloseTo(tall.y + tall.h, 6);
  });
});

describe('PNG stickers in the final output', () => {
  // Bounding box of every pixel that differs between a render with the sticker and one without it.
  const diffBox = (a: any, b: any) => {
    const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
    let x0 = a.width, y0 = a.height, x1 = -1, y1 = -1;
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    return { x0, y0, x1, y1 };
  };
  it('every sticker draws on top of the photo at the right size and aspect (print width and preview width)', async () => {
    for (const k of [384, 768]) for (const s of PNG) {
      const snap = addSticker(base, s.id, 384, 700).snap;
      const o = snap.objects.filter(isSticker)[0], f = k / 384;
      const c = await renderPlan(buildPlan(snap, ctx, k), env);
      const p = (c as any).getContext('2d').getImageData(Math.round((o.x + o.w / 2) * f), Math.round((o.y + o.h / 2) * f), 1, 1).data;
      expect(p[3]).toBe(255);
      const sticker = buildPlan(snap, ctx, k).cmds.at(-1) as any;
      expect(sticker.op).toBe('sticker');
      expect(sticker.w / sticker.h).toBeCloseTo(s.iw! / s.ih!, 6);
    }
  }, 120000);
  it('a rotated sticker keeps its transparent corners (the photo shows through) and is not distorted', async () => {
    let snap = addSticker(base, 'sticker_014', 384, 700).snap; // the narrowest, tallest one
    snap = { ...snap, objects: snap.objects.map((o) => (isSticker(o) ? { ...o, rotation: 90 } : o)) };
    const o = snap.objects.filter(isSticker)[0];
    const c = await renderPlan(buildPlan(snap, ctx, 384), env);
    const g = (c as any).getContext('2d');
    const at = (x: number, y: number) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data];
    // rotated 90deg: the old top-left corner region of the box is now elsewhere, but just outside the rotated box is untouched green
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    const out = at(cx, cy - o.w / 2 - 6); // beyond the rotated box (now o.w tall)
    expect(out[0] < 40 && out[1] > 200 && out[2] < 40).toBe(true);
    const without = await renderPlan(buildPlan(base, ctx, 384), env);
    const box = diffBox(c, without);
    expect((box.x1 - box.x0) / (box.y1 - box.y0)).toBeGreaterThan(1.5); // rotated 90 degrees: lying down, still elongated (2.9:1), not squashed
  });
  it('the GIF overlay layer draws the same PNG stickers as the print render', async () => {
    let snap = addSticker(base, 'sticker_001', 384, 700).snap;
    snap = addSticker(snap, 'sticker_028', 384, 700).snap;
    const plan = buildPlan(snap, ctx, 384);
    const whole = await renderPlan(plan, env), ov = await renderOverlay(plan, env);
    const o = snap.objects.filter(isSticker)[0];
    const a = (whole as any).getContext('2d').getImageData(Math.round(o.x + o.w / 2), Math.round(o.y + o.h / 2), 1, 1).data;
    const b = (ov as any).getContext('2d').getImageData(Math.round(o.x + o.w / 2), Math.round(o.y + o.h / 2), 1, 1).data;
    expect(b[3]).toBeGreaterThan(0);
    expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])).toBeLessThan(40);
  });
  it('a sticker that fails to load rejects before anything is drawn', async () => {
    const snap = addSticker(base, 'sticker_002', 384, 700).snap;
    const bad = { ...env, image: (s: string) => (s.startsWith('/') ? Promise.reject(new Error('image')) : env.image(s)) };
    await expect(renderPlan(buildPlan(snap, ctx, 384), bad)).rejects.toThrow();
  });
  it('prints: at 58mm and 80mm the sticker burns dots inside its box and the bitmap keeps the exact paper width', async () => {
    for (const mm of [58, 80] as const) {
      const w = PAPER_DOTS[mm], f = w / 384;
      const withS = addSticker(base, 'sticker_010', 384, 700).snap, o = withS.objects.filter(isSticker)[0];
      const a = toThermalBitmap(canvasToRGBA(await renderPrint(base, ctx, mm, env)), DEFAULT_THERMAL, w);
      const b = toThermalBitmap(canvasToRGBA(await renderPrint(withS, ctx, mm, env)), DEFAULT_THERMAL, w);
      expect(b.width).toBe(w); expect(b.height).toBe(a.height);
      const box = (bm: typeof a) => { const y0 = Math.round(o.y * f), y1 = Math.round((o.y + o.h) * f), x0 = Math.round(o.x * f), x1 = Math.round((o.x + o.w) * f); let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += (bm.data[y * bm.rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1; return n; };
      expect(box(b)).toBeGreaterThan(box(a) + 50); // the photo is flat green; the sticker adds real ink
      expect(blackRatio(b)).toBeGreaterThan(blackRatio(a));
    }
  }, 60000);
});
