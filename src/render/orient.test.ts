// @vitest-environment node
/**
 * Reading orientation of the sideways (roll-printed) NCL boarding pass: render/orient.ts and everything that uses it.
 * The PRINTED bitmap stays in paper space (covered by passPipeline.test.ts); what a person LOOKS AT is turned 90° counter-clockwise,
 * which is exactly what they do with the paper. Ordinary layouts must be untouched.
 */
import { describe, expect, it } from 'vitest';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { readFileSync } from 'fs';
import { join } from 'path';
import { forReading, fromReading, isSideways, readingMatrix, readingSize, rotateRGBAForReading, stickerTurn, toReading, turnForReading, turnRect } from './orient';
import { LAYOUTS, PASS_LAYOUTS, STANDARD_LAYOUTS } from '../layouts/registry';
import { PASS_FRAME_ID } from '../frames/registry';
import { addSticker, buildSnapshot, keepStickers } from '../editor/model';
import { isSticker } from '../editor/types';
import { buildPlan } from './plan';
import { renderPlan, type RenderEnv } from './render';
import { renderColorPhoto, renderGifVersion, GIF_WIDTH, type JpegEncoder } from '../share/assets';
import { makeEventCtx } from '../frames/prims';
import { DEFAULT_EVENT_PROFILE } from '../config/events';
import { qrAreaFor } from '../qr/placement';
import { getFrame } from '../frames/registry';

const env: RenderEnv = {
  canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
  image: (s) => loadImage(s.startsWith('/src/') ? readFileSync(s.slice(1)) : s) as unknown as Promise<CanvasImageSource>
};
const ctx = makeEventCtx({ ...DEFAULT_EVENT_PROFILE, details: [] }, new Date(2026, 9, 24, 10, 0));
const jpeg: JpegEncoder = async (c) => new Uint8Array((c as unknown as Canvas).toBuffer('image/jpeg', 92));
const IDS = PASS_LAYOUTS.map((l) => l.id);

const paintPhoto = (i: number, w = 1920, h = 1080) => {
  const c = createCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = ['#d62828', '#2a9d3f', '#1d4fd8', '#f08a00'][i]; g.fillRect(0, 0, w, h);
  g.fillStyle = '#000'; g.fillRect(Math.round(w * 0.4), 0, Math.round(w * 0.07), Math.round(h * 0.12));
  return 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64');
};
// photos already in paper space (rotated copies), as the editor hands them to the plan
const paperPhotos = (n: number) => Array.from({ length: n }, (_, i) => { const o = createCanvas(1080, 1920), g = o.getContext('2d'); g.fillStyle = ['#d62828', '#2a9d3f', '#1d4fd8', '#f08a00'][i]; g.fillRect(0, 0, 1080, 1920); return { src: 'data:image/png;base64,' + o.toBuffer('image/png').toString('base64'), iw: 1080, ih: 1920 }; });
const rgba = (c: Canvas) => c.getContext('2d').getImageData(0, 0, c.width, c.height);

describe('which layouts are turned', () => {
  it('exactly the four NCL layouts; every ordinary layout is untouched', () => {
    for (const l of LAYOUTS) expect(isSideways(l.id), l.id).toBe(IDS.includes(l.id));
    for (const l of STANDARD_LAYOUTS) expect(stickerTurn(l.id), l.id).toBe(0);
    for (const id of IDS) expect(stickerTurn(id), id).toBe(90);
    expect(isSideways(null)).toBe(false); expect(isSideways(undefined)).toBe(false); expect(isSideways('no-such-layout')).toBe(false);
  });
  it('forReading returns the SAME canvas object for ordinary layouts (no copy, no change)', () => {
    const c = createCanvas(20, 30) as unknown as HTMLCanvasElement;
    for (const l of STANDARD_LAYOUTS) expect(forReading(c, l.id, env)).toBe(c);
    expect(forReading(c, 'pass-1', env)).not.toBe(c);
  });
});

describe('the quarter turn is exact and consistent everywhere it is used', () => {
  it('toReading / fromReading are inverses and the SVG matrix applies the same mapping', () => {
    const W = 384;
    for (const p of [{ x: 0, y: 0 }, { x: 384, y: 0 }, { x: 0, y: 916 }, { x: 100, y: 250 }, { x: 383.5, y: 915.5 }]) {
      expect(fromReading(toReading(p, W), W)).toEqual(p);
      const [a, b, c, d, e, f] = readingMatrix(W).match(/-?\d+(\.\d+)?/g)!.map(Number); // matrix(a b c d e f): x' = a x + c y + e, y' = b x + d y + f
      expect({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f }).toEqual(toReading(p, W));
    }
    expect(toReading({ x: 0, y: 0 }, W)).toEqual({ x: 0, y: W }); // paper top-left → bottom-left (the paper's top edge becomes the LEFT edge)
    expect(toReading({ x: W, y: 0 }, W)).toEqual({ x: 0, y: 0 }); // paper top-right → top-left
    expect(readingSize(384, 916)).toEqual({ w: 916, h: 384 });
  });
  it('rotateRGBAForReading moves every pixel (x, y) → (y, w−1−x) and nothing else', () => {
    const w = 5, h = 3, src = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { src[i * 4] = i; src[i * 4 + 1] = 255 - i; src[i * 4 + 2] = (i * 7) % 256; src[i * 4 + 3] = 255; }
    const r = rotateRGBAForReading(src, w, h);
    expect([r.width, r.height]).toEqual([h, w]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) expect(r.data[((w - 1 - x) * h + y) * 4 + k]).toBe(src[(y * w + x) * 4 + k]);
  });
  it('turnForReading (canvas) is pixel-identical to the pure rotation, and does not modify its source', () => {
    const w = 37, h = 23, c = createCanvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { img.data[i * 4] = (i * 13) % 256; img.data[i * 4 + 1] = (i * 29) % 256; img.data[i * 4 + 2] = (i * 53) % 256; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    const before = Buffer.from(img.data), t = turnForReading(c as unknown as HTMLCanvasElement, env) as unknown as Canvas;
    expect([t.width, t.height]).toEqual([h, w]);
    expect(Buffer.from(rgba(t).data).equals(Buffer.from(rotateRGBAForReading(before, w, h).data))).toBe(true);
    expect(Buffer.from(rgba(c).data).equals(before)).toBe(true);
  });
  it('a turned REGION lands exactly where the same pixels sit in the turned whole image (what the GIF encoder relies on)', () => {
    const W = 61, H = 47, full = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < full.length; i++) full[i] = (i * 31 + (i >> 3)) % 256;
    const whole = rotateRGBAForReading(full, W, H), RW = whole.width; // reading image is H wide
    for (const r of [{ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 9, w: 20, h: 11 }, { x: W - 7, y: H - 4, w: 7, h: 4 }, { x: 0, y: 0, w: W, h: H }]) {
      const part = new Uint8ClampedArray(r.w * r.h * 4);
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) for (let k = 0; k < 4; k++) part[(y * r.w + x) * 4 + k] = full[((r.y + y) * W + r.x + x) * 4 + k];
      const q = turnRect(r, W), tp = rotateRGBAForReading(part, r.w, r.h);
      expect([tp.width, tp.height]).toEqual([q.w, q.h]);
      for (let y = 0; y < q.h; y++) for (let x = 0; x < q.w; x++) for (let k = 0; k < 4; k++) expect(tp.data[(y * q.w + x) * 4 + k]).toBe(whole.data[((q.y + y) * RW + q.x + x) * 4 + k]);
    }
  });
});

describe('the finished ticket, turned for reading, matches the landscape DESIGN (design-src reference)', () => {
  /** `sw` = how many source px from the left to compare (default: all). */
  const gray = (c: Canvas, w: number, h: number, sw?: number) => { const t = createCanvas(w, h), g = t.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, sw ?? c.width, c.height, 0, 0, w, h); const d = g.getImageData(0, 0, w, h).data; return Float32Array.from({ length: w * h }, (_, i) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]); };
  it.each(IDS)('%s: landscape at its own aspect, same design as the reference ticket (passes 1-3: its unchanged left block; a wrong turn is rejected)', async (id) => {
    const n = IDS.indexOf(id) + 1, plan = buildPlan(buildSnapshot(id, paperPhotos(n), PASS_FRAME_ID), ctx, 576), paper = (await renderPlan(plan, env)) as unknown as Canvas;
    const read = turnForReading(paper as unknown as HTMLCanvasElement, env) as unknown as Canvas;
    expect(read.width).toBe(paper.height); expect(read.height).toBe(paper.width);
    // passes 1-3 are wider than their reference since the photo boxes are true 3:4 (aspect = art height / 1152); pass-4 is unchanged
    const ASPECT = [2.4644, 2.6979, 3.0564, 2.3828][n - 1]; expect(Math.abs(read.width / read.height / ASPECT - 1)).toBeLessThan(0.005);
    const ref = await loadImage(readFileSync(join(process.cwd(), 'design-src/ncl-boarding-pass', `ref-${n}-photo.png`)));
    const rc = createCanvas(ref.width, ref.height); rc.getContext('2d').drawImage(ref, 0, 0);
    if (n === 4) expect(Math.abs(ref.width / ref.height / (read.width / read.height) - 1)).toBeLessThan(0.01);
    // the left block of passes 1-3 (everything left of the first photo box in the reference: x < 802 / 676 / 623) is the reference's own pixels
    const X0 = [802, 676, 623, ref.width][n - 1], f = read.height / ref.height, cw0 = X0 * f;
    const W = 460, H = Math.round((W * read.height) / cw0), A = gray(read, W, H, cw0), B = gray(rc, W, H, X0);
    // ignore the photo boxes and the QR panel (the reference has placeholder boxes and a sample QR there); everything else is the shared design
    const skip = new Uint8Array(W * H), mark = (x0: number, y0: number, x1: number, y1: number) => { for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) skip[y * W + x] = 1; };
    const L = plan.cmds.filter((c) => c.op === 'photo') as { slot: { x: number; y: number; w: number; h: number } }[], s = plan.k;
    for (const p of L) { const q = turnRect({ x: p.slot.x * s, y: p.slot.y * s, w: p.slot.w * s, h: p.slot.h * s }, paper.width); mark((q.x / cw0) * W - 6, (q.y / read.height) * H - 6, ((q.x + q.w) / cw0) * W + 6, ((q.y + q.h) / read.height) * H + 6); }
    const qa = qrAreaFor(getFrame(PASS_FRAME_ID), id)!.safeArea, qq = turnRect({ x: qa.x * paper.width, y: qa.y * paper.height, w: qa.w * paper.width, h: qa.h * paper.height }, paper.width);
    mark((qq.x / cw0) * W - 25, (qq.y / read.height) * H - 25, ((qq.x + qq.w) / cw0) * W + 25, ((qq.y + qq.h) / read.height) * H + 25);
    const diff = (a: Float32Array) => { let sum = 0, cnt = 0; for (let i = 0; i < W * H; i++) if (!skip[i]) { sum += Math.abs(a[i] - B[i]); cnt++; } return sum / cnt; };
    const good = diff(A);
    const cw = createCanvas(paper.height, paper.width), cg = cw.getContext('2d'); cg.translate(paper.height, 0); cg.rotate(Math.PI / 2); cg.drawImage(paper, 0, 0); // clockwise = the WRONG way
    expect(good, `${id} mean |Δ| vs reference`).toBeLessThan(22);
    expect(diff(gray(cw, W, H, cw0)), `${id} wrong-way turn must be far worse`).toBeGreaterThan(good * 2.5);
  }, 120000);
});

describe('saved colour photo (JPEG) and GIF are delivered in reading orientation', () => {
  it.each(IDS)('%s: JPEG is landscape, upright, and decodes to the turned render', async (id) => {
    const n = IDS.indexOf(id) + 1, snap = buildSnapshot(id, paperPhotos(n), PASS_FRAME_ID);
    const { canvas, asset } = await renderColorPhoto(snap, ctx, 58, env, jpeg);
    expect(canvas.width).toBeGreaterThan(canvas.height); expect(canvas.width / canvas.height).toBeGreaterThan(2.3);
    expect(asset.type).toBe('image/jpeg'); expect(asset.bytes[0]).toBe(0xff); expect(asset.bytes[1]).toBe(0xd8);
    const dec = await loadImage(Buffer.from(asset.bytes));
    expect([dec.width, dec.height]).toEqual([canvas.width, canvas.height]);
    const paper = (await renderPlan(buildPlan(snap, ctx, 384 * 2), env)) as unknown as Canvas, want = rgba(turnForReading(paper as unknown as HTMLCanvasElement, env) as unknown as Canvas).data;
    const dc = createCanvas(dec.width, dec.height), dg = dc.getContext('2d'); dg.drawImage(dec, 0, 0); const got = dg.getImageData(0, 0, dec.width, dec.height).data;
    let sum = 0; for (let i = 0; i < got.length; i += 4) sum += Math.abs(got[i] - want[i]) + Math.abs(got[i + 1] - want[i + 1]) + Math.abs(got[i + 2] - want[i + 2]);
    expect(sum / ((got.length / 4) * 3), `${id} JPEG vs turned render`).toBeLessThan(4);
  }, 120000);
  it('an ordinary layout still produces the same portrait JPEG as before', async () => {
    const snap = buildSnapshot('strip-3', paperPhotos(3).map((p) => ({ ...p, iw: 1080, ih: 1920 })));
    const { canvas } = await renderColorPhoto(snap, ctx, 58, env, jpeg);
    expect(canvas.height).toBeGreaterThan(canvas.width);
    expect(canvas.width).toBe(384 * 2);
    expect(Buffer.from(rgba(canvas as unknown as Canvas).data).equals(Buffer.from(rgba((await renderPlan(buildPlan(snap, ctx, 768), env)) as unknown as Canvas).data))).toBe(true);
  }, 60000);
  it.each(IDS)('%s: GIF is landscape (width > height), its first frame is the turned layout, and an ordinary layout GIF is still portrait', async (id) => {
    const n = IDS.indexOf(id) + 1, snap = buildSnapshot(id, paperPhotos(n), PASS_FRAME_ID);
    const gb = Buffer.from((await renderGifVersion(snap, ctx, [], env)).bytes), gw = gb.readUInt16LE(6), gh = gb.readUInt16LE(8);
    expect(gb.subarray(0, 6).toString('latin1')).toBe('GIF89a');
    expect(gw).toBeGreaterThan(gh); expect(gw / gh).toBeGreaterThan(2.3);
    const plan = buildPlan(snap, ctx, gh), paper = (await renderPlan(plan, env)) as unknown as Canvas, want = rgba(turnForReading(paper as unknown as HTMLCanvasElement, env) as unknown as Canvas);
    expect([want.width, want.height]).toEqual([gw, gh]); // the GIF canvas is exactly the turned print layout
    const dec = await loadImage(gb), dc = createCanvas(gw, gh), dg = dc.getContext('2d'); dg.drawImage(dec, 0, 0); const got = dg.getImageData(0, 0, gw, gh).data;
    let sum = 0; for (let i = 0; i < got.length; i += 4) sum += Math.abs(got[i] - want.data[i]) + Math.abs(got[i + 1] - want.data[i + 1]) + Math.abs(got[i + 2] - want.data[i + 2]);
    expect(sum / ((got.length / 4) * 3), `${id} GIF first frame vs turned render (palette quantisation only)`).toBeLessThan(10);
    const plain = Buffer.from((await renderGifVersion(buildSnapshot('strip-3', paperPhotos(3)), ctx, [], env)).bytes);
    expect(plain.readUInt16LE(8)).toBeGreaterThan(plain.readUInt16LE(6)); expect(plain.readUInt16LE(6)).toBeLessThanOrEqual(GIF_WIDTH);
  }, 120000);
});

describe('editor: stickers read upright on the ticket as it is read', () => {
  it('a sticker added on a sideways layout starts turned 90° (paper space); on an ordinary layout 0°', () => {
    const pass = buildSnapshot('pass-2', paperPhotos(2), PASS_FRAME_ID), std = buildSnapshot('strip-2', paperPhotos(2));
    expect(addSticker(pass, 'heart', 384, 916, stickerTurn('pass-2')).snap.objects.find(isSticker)!.rotation).toBe(90);
    expect(addSticker(std, 'heart', 384, 700, stickerTurn('strip-2')).snap.objects.find(isSticker)!.rotation).toBe(0);
    expect(addSticker(std, 'heart', 384, 700).snap.objects.find(isSticker)!.rotation).toBe(0); // old 4-argument call unchanged
  });
  it('switching between sideways and ordinary layouts keeps stickers reading upright; ordinary → ordinary changes nothing', () => {
    const std = addSticker(buildSnapshot('strip-2', paperPhotos(2)), 'heart', 384, 700).snap;
    const toPass = keepStickers(std, buildSnapshot('pass-3', paperPhotos(3), PASS_FRAME_ID));
    expect(toPass.objects.find(isSticker)!.rotation).toBe(90);
    const back = keepStickers(toPass, buildSnapshot('strip-3', paperPhotos(3)));
    expect(back.objects.find(isSticker)!.rotation).toBe(0);
    const toPass2 = keepStickers(toPass, buildSnapshot('pass-1', paperPhotos(1), PASS_FRAME_ID));
    expect(toPass2.objects.find(isSticker)!.rotation).toBe(90); // sideways → sideways
    const same = keepStickers(std, buildSnapshot('strip-4', paperPhotos(4)));
    expect(same.objects.find(isSticker)!.rotation).toBe(0);
  });
});
