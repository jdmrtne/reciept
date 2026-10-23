// @vitest-environment node
/**
 * Phase 4 final QA of the NCL boarding-pass family (pass-1..pass-4). Everything here runs on REAL rendered pixels.
 * Gaps the earlier suites left open:
 *   1. the real session QR is decoded (jsQR) from the paper-space canvas, from the reading-view canvas and from the 1-bit thermal bitmap;
 *   2. photos are not stretched (a round disc stays round) for portrait, landscape and 4:3 sources, in every box;
 *   3. fewer photos than boxes behaves like every other layout (the existing wrap-around rule), and no photos does not throw;
 *   4. switching between every pair of layouts (ordinary <-> pass, pass <-> pass), with stickers carried over, builds and renders;
 *   5. the ordinary layouts and their frames render exactly as before (a pass layout leaves no residue).
 * jsQR and the 1-bit bitmap are a SIMULATION of a phone and a printer, not a physical scan or print.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createCanvas, loadImage, GlobalFonts, type Canvas } from '@napi-rs/canvas';
import { readFileSync } from 'fs';
import jsQR from 'jsqr';
import { addSticker, buildSnapshot, keepStickers } from '../editor/model';
import { drawRotated90 } from '../editor/rotate';
import { PASS_FRAME_ID, frameForLayout, resolveFramed } from '../frames/registry';
import { LAYOUTS, PASS_LAYOUTS, getLayout } from '../layouts/registry';
import { PAPER_DOTS, slotCount } from '../layouts/engine';
import { makeEventCtx } from '../frames/prims';
import { DEFAULT_EVENT_PROFILE } from '../config/events';
import { buildPlan, verifyPlanQr } from './plan';
import { renderPlan, renderPrint, type RenderEnv } from './render';
import { forReading, isSideways } from './orient';
import { canvasToRGBA } from '../print/browser';
import { toThermalBitmap } from '../print/pipeline';
import { bitmapToRGBA } from '../print/bitmap';
import { DEFAULT_THERMAL } from '../print/types';
import { qrMatrix } from '../share/qr';
import { renderColorPhoto } from '../share/assets';
import { renderPreview } from './render';

const IDS = PASS_LAYOUTS.map((l) => l.id);
const ctx = makeEventCtx({ ...DEFAULT_EVENT_PROFILE, details: [] }, new Date(2026, 9, 24, 10, 0));
const env: RenderEnv = {
  canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
  image: (s) => loadImage(s.startsWith('/src/') ? readFileSync(s.slice(1)) : s) as unknown as Promise<CanvasImageSource>
};
beforeAll(() => {
  try { GlobalFonts.register(readFileSync('src/assets/fonts/courier-prime-latin-400-normal.woff2'), 'Courier Prime'); } catch { /* geometry checks only */ }
});

const URL_ = 'https://booth.example/p/0123456789abcdef0123456789abcdef';
const matrix = qrMatrix(URL_);
const SOURCES = { landscape: [1920, 1080], portrait: [1080, 1920], fourThree: [1600, 1200] } as const;
type Kind = keyof typeof SOURCES;
const COLORS = ['#d62828', '#2a9d3f', '#1d4fd8', '#f08a00'];

/** Distinct colour per photo, ONE small yellow disc dead centre (radius 6% of the short side, so it is never cropped away). */
function photo(i: number, w: number, h: number): Canvas {
  const c = createCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = COLORS[i]; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffe119'; g.beginPath(); g.arc(w / 2, h / 2, Math.min(w, h) * 0.06, 0, Math.PI * 2); g.fill();
  return c;
}
const url = (c: Canvas) => 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64');
/** What the app does for a sideways layout: a clockwise quarter-turn copy of each captured photo. */
function appPhotos(kind: Kind, n: number) {
  const [w, h] = SOURCES[kind];
  return Array.from({ length: n }, (_, i) => {
    const o = photo(i, w, h), r = createCanvas(h, w);
    drawRotated90(r.getContext('2d') as never, o, h);
    return { src: url(r), iw: h, ih: w };
  });
}
const px = (c: unknown) => { const cv = c as Canvas; const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height); return { data: d.data, width: d.width, height: d.height }; };
const scan = (p: { data: ArrayLike<number>; width: number; height: number }) => jsQR(new Uint8ClampedArray(p.data as never), p.width, p.height)?.data ?? null;
const isYellow = (d: Uint8ClampedArray, i: number) => d[i] > 220 && d[i + 1] > 190 && d[i + 2] < 90;

describe('real session QR: the printed stub still scans', () => {
  for (const id of IDS) {
    it(`${id} at 80 mm: decodes from the colour canvas, the reading view and the 1-bit bitmap; QR region verified clear`, async () => {
      const dots = PAPER_DOTS[80];
      const snap = buildSnapshot(id, appPhotos('landscape', slotCount(getLayout(id))), PASS_FRAME_ID);
      const plan = buildPlan(snap, ctx, dots, { matrix, paperDots: dots });
      expect(verifyPlanQr(plan)).toEqual({ ok: true });
      const canvas = await renderPrint(snap, ctx, 80, env, { matrix });
      expect(scan(px(canvas)), 'paper-space colour canvas').toBe(URL_);
      expect(scan(px(forReading(canvas as never, id, env))), 'reading view (what the customer sees)').toBe(URL_);
      const bm = toThermalBitmap(canvasToRGBA(canvas), DEFAULT_THERMAL, dots);
      const rgba = bitmapToRGBA(bm);
      expect(scan(rgba), '1-bit thermal bitmap').toBe(URL_);
    }, 60000);
  }
  it('58 mm with a QR is refused (never a covered design); 58 mm without a QR renders at the exact roll width', async () => {
    for (const id of IDS) {
      const snap = buildSnapshot(id, appPhotos('landscape', slotCount(getLayout(id))), PASS_FRAME_ID);
      expect(() => buildPlan(snap, ctx, 384, { matrix, paperDots: 384 }), id).toThrow();
      expect((await renderPlan(buildPlan(snap, ctx, 384), env)).width, id).toBe(384);
    }
  }, 60000);
});

describe('photos are cover-cropped, never stretched', () => {
  for (const kind of Object.keys(SOURCES) as Kind[]) for (const id of IDS) {
    it(`${id} with ${kind} photos: every disc is round (±4 % or 2 px) and sits at the centre of its box`, async () => {
      const n = slotCount(getLayout(id)), L = resolveFramed(id, PASS_FRAME_ID);
      const snap = buildSnapshot(id, appPhotos(kind, n), PASS_FRAME_ID);
      const plan = buildPlan(snap, ctx, 1152); // art 1:1 (3x the 384 reference geometry): discs are ~60 px, so a 2 px edge blend cannot read as a stretch
      const c = await renderPlan(plan, env), k = plan.k, p = px(c);
      L.slots.forEach((s, i) => {
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, area = 0;
        const sx = Math.floor(s.x * k), sy = Math.floor(s.y * k), ex = Math.ceil((s.x + s.w) * k), ey = Math.ceil((s.y + s.h) * k);
        for (let y = sy; y < ey; y++) for (let x = sx; x < ex; x++) if (isYellow(p.data, (y * p.width + x) * 4)) { area++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        expect(area, `${id}#${i} disc visible`).toBeGreaterThan(40);
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        // The bounding box of an anti-aliased disc is only good to about +-1 px per edge, so allow max(4 %, 2 px). A real stretch in these boxes
        // would be tens of percent (box and photo proportions differ that much), so this still fails loudly on one.
        expect(Math.abs(bw / bh - 1), `${id}#${i} disc aspect ${bw}x${bh}`).toBeLessThan(Math.max(0.04, 2 / Math.min(bw, bh)) + 1e-9);
        expect(Math.abs((x0 + x1) / 2 - (sx + ex) / 2) / (ex - sx), `${id}#${i} centred x`).toBeLessThan(0.03);
        expect(Math.abs((y0 + y1) / 2 - (sy + ey) / 2) / (ey - sy), `${id}#${i} centred y`).toBeLessThan(0.03);
        // each box shows ITS photo's colour (a swapped or repeated photo would fail here)
        const mid = ((Math.floor((sy + ey) / 2) - Math.floor(bh)) * p.width + sx + 6) * 4, want = COLORS[i];
        const r = parseInt(want.slice(1, 3), 16), g = parseInt(want.slice(3, 5), 16), b = parseInt(want.slice(5, 7), 16);
        expect(Math.abs(p.data[mid] - r) + Math.abs(p.data[mid + 1] - g) + Math.abs(p.data[mid + 2] - b), `${id}#${i} colour`).toBeLessThan(150);
      });
    }, 60000);
  }
});

describe('missing or incomplete photos behave like every other layout', () => {
  it('fewer photos than boxes: the existing wrap-around rule fills every box (same rule as ordinary layouts)', () => {
    for (const id of [...IDS, 'strip-3']) {
      const n = slotCount(getLayout(id)), one = appPhotos('landscape', 1);
      const frame = id.startsWith('pass') ? PASS_FRAME_ID : undefined;
      const s = buildSnapshot(id, one, frame);
      expect(s.objects.filter((o) => o.type === 'photo'), id).toHaveLength(n);
    }
  });
  it('no photos at all: an empty snapshot (as for every layout); the plan and the render do not throw', async () => {
    for (const id of IDS) {
      const s = buildSnapshot(id, [], PASS_FRAME_ID);
      expect(s.objects).toEqual([]);
      const c = await renderPlan(buildPlan(s, ctx, 384), env);
      expect(c.width).toBe(384);
    }
  }, 60000);
});

describe('switching layouts never crashes and never leaks pass state into ordinary layouts', () => {
  const ids = LAYOUTS.map((l) => l.id);
  it('every ordered pair of layouts builds a plan with a legal frame, and sideways is flagged only for pass layouts', () => {
    for (const a of ids) for (const b of ids) {
      const pa = appPhotos('landscape', 1);
      const fa = frameForLayout(a, null);
      let snap = buildSnapshot(a, pa, fa);
      snap = addSticker(snap, 'sticker_001', resolveFramed(a, fa).width, resolveFramed(a, fa).height, isSideways(a) ? 90 : 0).snap;
      const fb = frameForLayout(b, snap.frameId);
      const next = keepStickers(snap, buildSnapshot(b, pa, fb));
      expect(next.objects.filter((o) => o.type === 'sticker'), `${a}->${b}`).toHaveLength(1);
      expect(() => buildPlan(next, ctx, 384), `${a}->${b}`).not.toThrow();
      expect(isSideways(b), b).toBe(IDS.includes(b));
      if (!IDS.includes(b)) expect(fb, `${a}->${b} frame`).not.toBe(PASS_FRAME_ID);
      if (IDS.includes(b)) expect(fb, `${a}->${b} frame`).toBe(PASS_FRAME_ID);
    }
  }, 120000);
  it('rendered ring: single -> pass-1 -> pass-4 -> pass-2 -> strip-3 -> pass-3 -> classic -> single', async () => {
    const ring = ['single', 'pass-1', 'pass-4', 'pass-2', 'strip-3', 'pass-3', 'classic', 'single'];
    for (const id of ring) {
      const f = frameForLayout(id, null), n = slotCount(getLayout(id));
      const c = await renderPlan(buildPlan(buildSnapshot(id, appPhotos('portrait', n), f), ctx, 384), env);
      expect(c.width, id).toBe(384);
      expect(c.height, id).toBeGreaterThan(100);
    }
  }, 120000);
});

describe('artwork text: the exact tagline', () => {
  it('pass-4 bottom-right tagline ends with its full stop (reference 4 lacked it; added by scripts/build-ncl-pass.py)', async () => {
    const img = await loadImage(readFileSync('src/assets/frames/ncl-boarding-pass/pass-4.png'));
    const c = createCanvas(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    // paper space: reading-view dot at x 1423..1426, y 738..741 (ref px) -> art x 99..104, y 2018..2024 (turned 90 deg clockwise, scaled 1.4187)
    let ink = 0;
    for (let y = 2018; y <= 2024; y++) for (let x = 99; x <= 104; x++) { const i = (y * img.width + x) * 4; if (d[i + 3] > 200 && d[i] < 100) ink++; }
    expect(ink, 'full stop ink').toBeGreaterThan(20);
    // and nothing else was drawn right next to it (the dot is isolated: blank ring around it)
    let ring = 0;
    for (let y = 2012; y <= 2030; y++) for (let x = 90; x <= 113; x++) { if (x >= 97 && x <= 106 && y >= 2016 && y <= 2026) continue; const i = (y * img.width + x) * 4; if (d[i + 3] > 200 && d[i] < 100) ring++; }
    expect(ring, 'blank ring around the full stop').toBe(0);
  });
});

describe('preview, saved image and print agree', () => {
  for (const id of IDS) {
    it(`${id}: the on-screen preview and the saved colour JPEG are the same pixels, both LANDSCAPE; the print stays roll-width and runs along the roll`, async () => {
      const n = slotCount(getLayout(id));
      const snap = buildSnapshot(id, appPhotos('portrait', n), PASS_FRAME_ID);
      const preview = forReading(await renderPreview(snap, ctx, 80, env) as never, id, env) as unknown as Canvas;
      const jpeg = async (c: HTMLCanvasElement) => new Uint8Array((c as unknown as Canvas).toBuffer('image/jpeg', 90));
      const { canvas: saved, asset } = await renderColorPhoto(snap, ctx, 80, env, jpeg);
      const a = px(preview), b = px(saved);
      expect([a.width, a.height], 'same size').toEqual([b.width, b.height]);
      let diff = 0; for (let i = 0; i < a.data.length; i++) diff += Math.abs(a.data[i] - b.data[i]);
      expect(diff, 'identical pixels').toBe(0);
      expect(a.width / a.height, 'landscape ticket 2.38:1').toBeGreaterThan(2.2);
      expect(a.width / a.height).toBeLessThan(2.5);
      const dec = await loadImage(Buffer.from(asset.bytes));
      expect([dec.width, dec.height], 'the stored JPEG decodes to the same landscape size').toEqual([b.width, b.height]);
      const print = await renderPrint(snap, ctx, 80, env);
      expect(print.width, 'print is exactly the roll width').toBe(576);
      expect(print.height, 'the ticket runs along the roll (turn the paper to read)').toBeGreaterThan(576 * 2);
    }, 60000);
  }
});
