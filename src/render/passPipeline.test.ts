// @vitest-environment node
/**
 * Phase 3 validation of the NCL boarding-pass family (pass-1..pass-4) through the REAL pipeline, end to end:
 *   captured photo (landscape / portrait / 4:3) → quarter-turn copy (editor/rotate.ts drawRotated90) → buildSnapshot → buildPlan
 *   → renderPlan (preview 2×, print, and two more widths) → canvasToRGBA → toThermalBitmap → MockPrinterAdapter (real ESC/POS encode + decode).
 * Photos are SYNTHETIC and distinct (colour per photo, an off-centre black marker on the photo's top edge, a centre disc), so a wrong slot,
 * a mirrored or sideways photo, a stretch, a white strip or a black background cannot pass unnoticed.
 *
 * The orientation check is against an INDEPENDENT reference: cover-crop the ORIGINAL photo into the box AS IT SITS ON THE TICKET
 * (slot with width/height swapped), then turn that crop 90° clockwise. The app instead rotates first and crops in paper space.
 * Both must produce the same pixels.
 *
 * Set PASS_DUMP_DIR=/some/dir to also write PNG contact sheets (ticket view) for a human to look at.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildSnapshot } from '../editor/model';
import { drawRotated90 } from '../editor/rotate';
import { PASS_FRAME_ID, resolveFramed } from '../frames/registry';
import { PASS_LAYOUTS, STANDARD_LAYOUTS, getLayout } from '../layouts/registry';
import { PAPER_DOTS, slotCount } from '../layouts/engine';
import { makeEventCtx } from '../frames/prims';
import { DEFAULT_EVENT_PROFILE } from '../config/events';
import { buildPlan } from './plan';
import { renderPlan, type RenderEnv } from './render';
import { canvasToRGBA } from '../print/browser';
import { toThermalBitmap } from '../print/pipeline';
import { DEFAULT_THERMAL } from '../print/types';
import { MockPrinterAdapter } from '../print/adapters/mock';
import { getDot } from '../print/bitmap';

const IDS = PASS_LAYOUTS.map((l) => l.id); // pass-1..pass-4
const DUMP = process.env.PASS_DUMP_DIR;
const ctx = makeEventCtx({ ...DEFAULT_EVENT_PROFILE, details: [] }, new Date(2026, 9, 24, 10, 0));

type C2 = Canvas;
const env: RenderEnv = {
  canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
  image: (s) => loadImage(s.startsWith('/src/') ? readFileSync(s.slice(1)) : s) as unknown as Promise<CanvasImageSource>
};

// ---- synthetic photos -------------------------------------------------------------------------------------------------------------
const BG = ['#d62828', '#2a9d3f', '#1d4fd8', '#f08a00']; // none has a channel minimum above 60, so "near white" can only be an unpainted strip
const SOURCES = { landscape: [1920, 1080], portrait: [1080, 1920], fourThree: [1600, 1200] } as const;
type SourceKind = keyof typeof SOURCES;

function makePhoto(i: number, w: number, h: number): C2 {
  const c = createCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = BG[i]; g.fillRect(0, 0, w, h);
  const sh = g.createLinearGradient(0, 0, w, 0); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = sh; g.fillRect(0, 0, w, h); // left → right shading: breaks left/right symmetry over the WHOLE frame
  const bd = g.createLinearGradient(0, 0, 0, h); bd.addColorStop(0, 'rgba(0,229,255,0.45)'); bd.addColorStop(0.5, 'rgba(0,229,255,0)'); g.fillStyle = bd; g.fillRect(0, 0, w, h); // cyan wash fading downwards: breaks up/down symmetry
  g.fillStyle = '#000'; g.fillRect(Math.round(w * 0.40), 0, Math.round(w * 0.07), Math.round(h * 0.12)); // off-centre marker on the TOP edge
  g.fillStyle = '#ffe119'; g.beginPath(); g.arc(w / 2, h / 2, Math.min(w, h) * 0.12, 0, Math.PI * 2); g.fill(); // centre disc = stand-in for a face
  g.fillStyle = '#00e5ff'; g.fillRect(Math.round(w * 0.2), Math.round(h * 0.45), Math.round(w * 0.04), Math.round(h * 0.1)); // asymmetric tick, left of centre (cyan, never white)
  return c;
}
const url = (c: C2) => 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64');

/** What the app does for a sideways layout: a clockwise quarter-turn copy per captured photo (rotate.ts, same drawing code). */
function appPhotos(kind: SourceKind, n: number) {
  const [w, h] = SOURCES[kind];
  const originals = Array.from({ length: n }, (_, i) => makePhoto(i, w, h));
  const photos = originals.map((o) => { const r = createCanvas(h, w), g = r.getContext('2d'); drawRotated90(g as never, o, h); return { src: url(r), iw: h, ih: w }; });
  return { originals, photos };
}

/** Independent reference tile: cover-crop the original into the TICKET-space box (slot w/h swapped), then rotate 90° clockwise. */
function referenceTile(orig: C2, slotW: number, slotH: number, mirror = false): C2 {
  const bw = slotH, bh = slotW, s = Math.max(bw / orig.width, bh / orig.height), sw = bw / s, sh = bh / s;
  const t = createCanvas(bw, bh), tg = t.getContext('2d'); tg.imageSmoothingQuality = 'high';
  tg.drawImage(orig, (orig.width - sw) / 2, (orig.height - sh) / 2, sw, sh, 0, 0, bw, bh);
  const out = createCanvas(slotW, slotH), g = out.getContext('2d');
  if (mirror) { g.translate(0, slotH); g.scale(1, -1); } // deliberately wrong variant (used to prove the comparison can fail)
  drawRotated90(g as never, t, bh);
  return out;
}

const rgbaOf = (c: C2) => (c.getContext('2d') as any).getImageData(0, 0, c.width, c.height) as { data: Uint8ClampedArray; width: number; height: number };
function meanAbsDiff(a: C2, aRect: { x: number; y: number; w: number; h: number }, b: C2, inset: number): number {
  const A = (a.getContext('2d') as any).getImageData(aRect.x, aRect.y, aRect.w, aRect.h).data as Uint8ClampedArray, B = rgbaOf(b).data;
  let sum = 0, n = 0;
  for (let y = inset; y < aRect.h - inset; y++) for (let x = inset; x < aRect.w - inset; x++) { const i = (y * aRect.w + x) * 4; sum += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]); n += 3; }
  return sum / n;
}

// ---- art windows (alpha < 40) at the output scale -----------------------------------------------------------------------------------
const artCache = new Map<string, { w: number; h: number; a: Uint8ClampedArray; rgb: Uint8ClampedArray }>();
async function art(id: string) {
  if (!artCache.has(id)) {
    const img = await loadImage(readFileSync(join(process.cwd(), 'src/assets/frames/ncl-boarding-pass', `${id}.png`)));
    const c = createCanvas(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    artCache.set(id, { w: img.width, h: img.height, a: Uint8ClampedArray.from({ length: img.width * img.height }, (_, i) => d[i * 4 + 3]), rgb: d });
  }
  return artCache.get(id)!;
}
/** Window mask at W×H, eroded by `erode` px (so anti-aliased art edges are not judged). */
async function windowMask(id: string, W: number, H: number, erode: number): Promise<Uint8Array> {
  const A = await art(id), m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = A.a[Math.min(A.h - 1, Math.floor((y * A.h) / H)) * A.w + Math.min(A.w - 1, Math.floor((x * A.w) / W))] < 40 ? 1 : 0;
  for (let e = 0; e < erode; e++) {
    const n = m.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x] && (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !m[y * W + x - 1] || !m[y * W + x + 1] || !m[(y - 1) * W + x] || !m[(y + 1) * W + x])) n[y * W + x] = 0;
    m.set(n);
  }
  return m;
}


/** Output-scale mask of artwork paper whose whole neighbourhood (±R output px) is plain opaque white in the ART: no ink, no window, no edge. */
const flatCache = new Map<string, Int32Array>();
async function flatPaperMask(id: string, W: number, H: number, R: number): Promise<Uint8Array> {
  const A = await art(id);
  if (!flatCache.has(id)) {
    const sat = new Int32Array((A.w + 1) * (A.h + 1));
    for (let y = 0; y < A.h; y++) { let row = 0; for (let x = 0; x < A.w; x++) { const j = (y * A.w + x) * 4, ink = A.rgb[j + 3] < 255 || A.rgb[j] < 250 || A.rgb[j + 1] < 250 || A.rgb[j + 2] < 250 ? 1 : 0; row += ink; sat[(y + 1) * (A.w + 1) + x + 1] = sat[y * (A.w + 1) + x + 1] + row; } }
    flatCache.set(id, sat);
  }
  const sat = flatCache.get(id)!, m = new Uint8Array(W * H), sx = A.w / W, sy = A.h / H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, Math.floor((x - R) * sx)), x1 = Math.min(A.w, Math.ceil((x + R + 1) * sx)), y0 = Math.max(0, Math.floor((y - R) * sy)), y1 = Math.min(A.h, Math.ceil((y + R + 1) * sy));
    const ink = sat[y1 * (A.w + 1) + x1] - sat[y0 * (A.w + 1) + x1] - sat[y1 * (A.w + 1) + x0] + sat[y0 * (A.w + 1) + x0];
    m[y * W + x] = ink === 0 ? 1 : 0;
  }
  return m;
}

const render = (id: string, kind: SourceKind, width: number) => {
  const { originals, photos } = appPhotos(kind, slotCount(getLayout(id)));
  const snap = buildSnapshot(id, photos, PASS_FRAME_ID);
  const plan = buildPlan(snap, ctx, width);
  return renderPlan(plan, env).then((canvas) => ({ canvas: canvas as unknown as C2, plan, originals, snap }));
};

beforeAll(() => { if (DUMP) mkdirSync(DUMP, { recursive: true }); });

// 384 = 58 mm paper, 576 = 80 mm paper, 768 = 80 mm screen preview (2×), 1152 = 58 mm screen preview ×3 (art 1:1).
const WIDTHS = [384, 576, 768, 1152];
/** Ticket aspect (width / height) of each pass after the 3:4-box fix: art height / 1152. Passes 1-3 are wider than before (true 3:4 boxes); pass-4 is unchanged. */
const ASPECT: Record<string, number> = { 'pass-1': 2.4644, 'pass-2': 2.6979, 'pass-3': 3.0564, 'pass-4': 2.3828 };

describe('output geometry: the ticket is LANDSCAPE once the roll is turned, and the roll width is exact', () => {
  it.each(IDS)('%s: canvas = paper width × art aspect, no stretch, ticket reads landscape at its own aspect', async (id) => {
    const A = await art(id);
    for (const w of WIDTHS) {
      const plan = buildPlan(buildSnapshot(id, appPhotos('landscape', slotCount(getLayout(id))).photos, PASS_FRAME_ID), ctx, w);
      expect(plan.width).toBe(w);
      expect(Math.abs(plan.height / plan.width / (A.h / A.w) - 1), `${id}@${w} art aspect`).toBeLessThan(0.002);
      expect(plan.height, `${id}@${w} is taller than wide on the ROLL`).toBeGreaterThan(plan.width);
      expect(Math.abs(plan.height / plan.width / ASPECT[id] - 1), `${id}@${w} ticket ratio after turning the paper`).toBeLessThan(0.005);
      expect(plan.cmds.some((c) => c.op === 'info')).toBe(false); // all event text is in the art
    }
  });
  it('physical size at 203 dpi: 58 mm = 384 dots ≈ 48 mm printable, 80 mm = 576 dots ≈ 72 mm printable; ticket length per pass (pass-1 118.4, pass-2 129.6, pass-3 146.9, pass-4 114.5 mm at 58 mm; ×1.5 at 80 mm)', () => {
    const mm = (dots: number) => (dots / 203) * 25.4;
    for (const id of IDS) {
      const p58 = buildPlan(buildSnapshot(id, appPhotos('landscape', 4).photos, PASS_FRAME_ID), ctx, PAPER_DOTS[58]);
      const p80 = buildPlan(buildSnapshot(id, appPhotos('landscape', 4).photos, PASS_FRAME_ID), ctx, PAPER_DOTS[80]);
      expect(mm(p58.width)).toBeCloseTo(48.05, 1); expect(mm(p80.width)).toBeCloseTo(72.07, 1);
      const want58 = 48.05 * ASPECT[id];
      expect(Math.abs(mm(p58.height) - want58), id).toBeLessThan(0.6);
      expect(Math.abs(mm(p80.height) - 72.07 * ASPECT[id]), id).toBeLessThan(0.9);
    }
  });
});

describe('every photo box receives exactly its own photo (count, order, orientation, crop)', () => {
  const table: string[] = [];
  for (const kind of Object.keys(SOURCES) as SourceKind[]) {
    it.each(IDS)(`${kind} source → %s: N photos, each equals the independent ticket-space cover-crop rotated clockwise`, async (id) => {
      for (const w of [384, 576]) {
        const { canvas, plan, originals } = await render(id, kind, w);
        const photos = plan.cmds.filter((c) => c.op === 'photo') as Extract<(typeof plan.cmds)[number], { op: 'photo' }>[];
        expect(photos, `${id} photo count`).toHaveLength(IDS.indexOf(id) + 1);
        photos.forEach((p, i) => {
          // plan level: never stretched, always covers its slot
          expect(Math.abs(p.img.w / p.img.h / (p.iw / p.ih) - 1), `${id}#${i} img aspect`).toBeLessThan(1e-6);
          expect(p.img.x).toBeLessThanOrEqual(p.slot.x + 1e-6); expect(p.img.y).toBeLessThanOrEqual(p.slot.y + 1e-6);
          expect(p.img.x + p.img.w).toBeGreaterThanOrEqual(p.slot.x + p.slot.w - 1e-6); expect(p.img.y + p.img.h).toBeGreaterThanOrEqual(p.slot.y + p.slot.h - 1e-6);
          // pixel level: the box shows ITS photo, upright on the ticket
          const k = plan.k, r = { x: Math.round(p.slot.x * k), y: Math.round(p.slot.y * k), w: Math.max(1, Math.round(p.slot.w * k)), h: Math.max(1, Math.round(p.slot.h * k)) };
          const ref = referenceTile(originals[i], r.w, r.h), inset = Math.ceil(3 * k);
          const d = meanAbsDiff(canvas, r, ref, inset);
          expect(d, `${id}#${i}@${w} mean |Δ| vs reference`).toBeLessThan(5);
          if (w === 384) { // visible share of the source frame (face-visibility reality check), reported in the table below
            const vis = (p.slot.w * p.slot.h) / (p.img.w * p.img.h);
            if (i === 0) table.push(`${kind.padEnd(10)} ${id}: box shows ${(vis * 100).toFixed(0)}% of the frame (centred)`);
          }
        });
      }
    }, 120000);
  }
  it('the comparison has teeth: a MIRRORED reference is rejected for every layout', async () => {
    for (const id of IDS) {
      const { canvas, plan, originals } = await render(id, 'landscape', 384);
      const p = plan.cmds.find((c) => c.op === 'photo') as Extract<(typeof plan.cmds)[number], { op: 'photo' }>;
      const r = { x: p.slot.x, y: p.slot.y, w: p.slot.w, h: p.slot.h };
      const honest = meanAbsDiff(canvas, r, referenceTile(originals[0], r.w, r.h), 3), wrong = meanAbsDiff(canvas, r, referenceTile(originals[0], r.w, r.h, true), 3);
      expect(honest, id).toBeLessThan(5); expect(wrong, `${id}: mirrored ${wrong.toFixed(1)} vs honest ${honest.toFixed(1)}`).toBeGreaterThan(Math.max(8, honest * 10));
    }
  }, 60000);
  it('different boxes get different photos: box b is closest to photo b, never to another photo (order = ticket order, left to right)', async () => {
    for (const id of IDS.slice(1)) {
      const { canvas, plan, originals } = await render(id, 'landscape', 576);
      const boxes = plan.cmds.filter((c) => c.op === 'photo') as Extract<(typeof plan.cmds)[number], { op: 'photo' }>[];
      boxes.forEach((p, b) => {
        const r = { x: Math.round(p.slot.x * plan.k), y: Math.round(p.slot.y * plan.k), w: Math.round(p.slot.w * plan.k), h: Math.round(p.slot.h * plan.k) };
        const diffs = originals.slice(0, boxes.length).map((o) => meanAbsDiff(canvas, r, referenceTile(o, r.w, r.h), 4));
        expect(diffs.indexOf(Math.min(...diffs)), `${id} box ${b + 1} diffs ${diffs.map((d) => d.toFixed(1))}`).toBe(b);
        diffs.forEach((d, j) => { if (j !== b) expect(d, `${id} box ${b + 1} vs photo ${j + 1}`).toBeGreaterThan(20); });
      });
    }
  }, 60000);
  it('reports (not asserts) how much of the camera frame each box shows', () => { console.log('\nVISIBLE SHARE OF THE CAMERA FRAME\n' + table.join('\n')); expect(table.length).toBeGreaterThan(0); });
});

describe('no white strips, gaps or black backgrounds inside any window', () => {
  it.each(IDS)('%s: every pixel of the art window (eroded 2 px) is photo, at 4 widths and 3 source aspects', async (id) => {
    for (const kind of Object.keys(SOURCES) as SourceKind[]) for (const w of WIDTHS) {
      const { canvas } = await render(id, kind, w), W = canvas.width, H = canvas.height, m = await windowMask(id, W, H, 2), d = rgbaOf(canvas).data;
      let n = 0, white = 0, nearBlackOnly = 0;
      for (let i = 0; i < W * H; i++) if (m[i]) { n++; const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; if (Math.min(r, g, b) > 200) white++; if (Math.max(r, g, b) < 12) nearBlackOnly++; }
      expect(n, `${id}@${w}: window found`).toBeGreaterThan(1000 * (w / 384));
      expect(white, `${id} ${kind}@${w}: white pixels inside the window`).toBe(0);
      expect(nearBlackOnly / n, `${id} ${kind}@${w}: black share (marker only, a few %)`).toBeLessThan(0.08);
    }
  }, 240000);
  it.each(IDS)('%s: flat artwork paper stays pure white (no photo bleed, no grey cast) at 4 widths', async (id) => {
    for (const w of [384, 576, 1152]) {
      const { canvas } = await render(id, 'landscape', w), W = canvas.width, H = canvas.height, m = await flatPaperMask(id, W, H, 4), d = rgbaOf(canvas).data;
      let paper = 0, bad = 0, worst = 255;
      for (let i = 0; i < W * H; i++) if (m[i]) { paper++; const v = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); if (v < 250) bad++; worst = Math.min(worst, v); }
      expect(paper, `${id}@${w}: flat paper found`).toBeGreaterThan(5000 * (w / 384));
      expect(bad, `${id}@${w}: non-white pixels on flat artwork paper (darkest ${worst})`).toBe(0);
    }
  }, 120000);
});

describe('print path: 1-bit bitmap, exact roll width, ESC/POS round trip', () => {
  it.each([58, 80] as const)('%s mm: every layout becomes an exact-width bitmap that the (mock) printer receives unchanged', async (mm) => {
    for (const id of IDS) {
      const { canvas } = await render(id, 'landscape', PAPER_DOTS[mm]);
      const rgba = canvasToRGBA(canvas as unknown as HTMLCanvasElement), before = Uint8ClampedArray.from(rgba.data);
      const bits = toThermalBitmap(rgba, { ...DEFAULT_THERMAL }, PAPER_DOTS[mm]);
      expect(bits.width, `${id} ${mm}mm width`).toBe(PAPER_DOTS[mm]);
      expect(bits.height, `${id} ${mm}mm height = rendered rows + bottom margin`).toBe(rgba.height + DEFAULT_THERMAL.marginBottom);
      expect(Array.from(rgba.data.slice(0, 4000))).toEqual(Array.from(before.slice(0, 4000))); // input not mutated
      const printer = new MockPrinterAdapter({ stepMs: 0 }); await printer.connect();
      await printer.print(bits, { thermal: DEFAULT_THERMAL, paperDots: PAPER_DOTS[mm] } as never);
      const got = printer.lastJob!.bitmap;
      expect(got.width).toBe(bits.width); expect(got.height).toBe(bits.height); expect(Buffer.from(got.data).equals(Buffer.from(bits.data)), `${id} ${mm}mm bytes`).toBe(true);
      // windows are neither solid black nor solid white (no black background, photo tone survives), flat artwork paper carries no ink
      const m = await windowMask(id, canvas.width, canvas.height, 3); let n = 0, on = 0; for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (m[y * canvas.width + x]) { n++; on += getDot(bits, x, y); }
      expect(on / n, `${id} ${mm}mm window ink share`).toBeGreaterThan(0.03); expect(on / n).toBeLessThan(0.9);
      const fm = await flatPaperMask(id, canvas.width, canvas.height, 4); let pn = 0, pon = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (fm[y * canvas.width + x]) { pn++; pon += getDot(bits, x, y); }
      expect(pn).toBeGreaterThan(5000); expect(pon, `${id} ${mm}mm stray ink dots on flat paper`).toBe(0);
      if (DUMP) { // human-readable evidence: the ROLL as printed and the TICKET as read (roll turned counter-clockwise)
        const out = createCanvas(bits.width, bits.height), g = out.getContext('2d'), img = g.createImageData(bits.width, bits.height);
        for (let y = 0; y < bits.height; y++) for (let x = 0; x < bits.width; x++) { const v = getDot(bits, x, y) ? 0 : 255, i = (y * bits.width + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
        g.putImageData(img, 0, 0);
        const t = createCanvas(bits.height, bits.width), tg = t.getContext('2d'); tg.translate(0, bits.width); tg.rotate(-Math.PI / 2); tg.drawImage(out, 0, 0);
        writeFileSync(join(DUMP, `${id}-${mm}mm-ticket-1bit.png`), t.toBuffer('image/png'));
        const tc = createCanvas(canvas.height, canvas.width), tcg = tc.getContext('2d'); tcg.translate(0, canvas.width); tcg.rotate(-Math.PI / 2); tcg.drawImage(canvas, 0, 0);
        writeFileSync(join(DUMP, `${id}-${mm}mm-ticket-colour.png`), tc.toBuffer('image/png'));
      }
    }
  }, 240000);
});

describe('regression: ordinary layouts are untouched by the sideways family', () => {
  it('no ordinary layout rotates photos, none is frame-locked, and a standard frame still renders at the old size', async () => {
    for (const l of STANDARD_LAYOUTS) expect(l.photoRotation, l.id).toBeUndefined();
    const photos = [{ src: url(makePhoto(0, 640, 480)), iw: 640, ih: 480 }];
    const snap = buildSnapshot('strip-3', photos), plan = buildPlan(snap, ctx, 384);
    expect(plan.width).toBe(384); expect(plan.unitsH).toBe(resolveFramed('strip-3', snap.frameId).height + (plan.cmds.some((c) => c.op === 'info') ? plan.unitsH - resolveFramed('strip-3', snap.frameId).height : 0));
    expect(plan.cmds.filter((c) => c.op === 'photo')).toHaveLength(3);
  });
});
