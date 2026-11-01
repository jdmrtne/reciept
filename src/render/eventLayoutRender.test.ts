// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { readFileSync } from 'fs';
import jsQR from 'jsqr';
import { buildPlan, verifyPlanQr, type RenderPlan } from './plan';
import { renderOverlay, renderPrint, type RenderEnv } from './render';
import { PAPER_DOTS } from '../layouts/engine';
import { buildSnapshot } from '../editor/model';
import { frameForLayout, resolveFramed } from '../frames/registry';
import { makeCtx, makeEventCtx } from '../frames/prims';
import { DEFAULT_EVENT_PROFILE, getActiveEvent, type EventProfile } from '../config/events';
import { qrMatrix } from '../share/qr';
import { FakeIndexedDB } from '../frames/custom/fakeIdb';
import * as store from '../frames/custom/store';
import * as ev from '../frames/custom/eventRuntime';
import * as rt from '../frames/custom/runtime';
import type { CustomLayoutArt, CustomQrArea } from '../frames/custom/types';
import { EVENT_SPOT_INSET, QR_MODULE_SLACK, insetSpot, spotUnits, validateQrSpot } from '../frames/custom/qrArea';

/**
 * EL-3 guest path with REAL pixels: event layouts (their own PNG art with transparent photo windows) x 58/80 mm x QR on/off x with and without the info block.
 * Photos must show only inside the windows (no paper gap), the art must stay on top everywhere else, and the QR must decode from the rendered canvas.
 */
const PAPER = [194, 24, 91]; // the art colour
const COLORS: [number, number, number][] = [[230, 20, 20], [20, 180, 20], [20, 20, 230]];
const dataUrl = (c: { toBuffer: (m: 'image/png') => Buffer }) => 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64');
const solid = (rgb: number[]) => { const c = createCanvas(1600, 900), g = c.getContext('2d'); g.fillStyle = `rgb(${rgb.join(',')})`; g.fillRect(0, 0, 1600, 900); return { src: dataUrl(c), iw: 1600, ih: 900 }; };

interface Spec { name: string; windows: { x: number; y: number; w: number; h: number }[]; W: number; H: number; qr?: { x: number; y: number; w: number; h: number } }
const SPECS: Spec[] = [
  { name: 'Three windows, no QR spot', W: 600, H: 1500, windows: [{ x: 60, y: 60, w: 480, h: 360 }, { x: 60, y: 480, w: 480, h: 360 }, { x: 60, y: 900, w: 480, h: 360 }] },
  { name: 'Two windows, QR spot', W: 600, H: 1200, windows: [{ x: 60, y: 60, w: 480, h: 360 }, { x: 60, y: 480, w: 480, h: 360 }], qr: { x: 330, y: 880, w: 240, h: 240 } }
];
function paint(s: Spec): CustomLayoutArt {
  const c = createCanvas(s.W, s.H), g = c.getContext('2d');
  g.fillStyle = `rgb(${PAPER.join(',')})`; g.fillRect(0, 0, s.W, s.H);
  // A clear spot for the QR. It reaches 12 px past the declared spot: the QR sits flush in the spot's corner and the placement rules need clear paper around it (anti-aliasing at the art edge would otherwise count as content).
  if (s.qr) { g.fillStyle = '#fff'; g.fillRect(s.qr.x - 12, s.qr.y - 12, s.qr.w + 24, s.qr.h + 24); }
  for (const w of s.windows) g.clearRect(w.x, w.y, w.w, w.h); // transparent photo windows
  const qr: CustomQrArea | undefined = s.qr && { x: s.qr.x / s.W, y: s.qr.y / s.H, w: s.qr.w / s.W, h: s.qr.h / s.H };
  const art: CustomLayoutArt = {
    blob: new Blob([new Uint8Array(c.toBuffer('image/png'))], { type: 'image/png' }), mime: 'image/png', width: s.W, height: s.H, heightRatio: s.H / s.W,
    windows: s.windows, slots: s.windows.map((w) => ({ x: w.x / s.W, y: w.y / s.W, w: w.w / s.W, h: w.h / s.W })), ...(qr ? { qr } : {})
  };
  blobs.set(art.blob, dataUrl(c));
  return art;
}
const blobs = new WeakMap<Blob, string>();

const env: RenderEnv = {
  canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
  image: (s) => loadImage(s.startsWith('data:image/svg+xml;utf8,') ? Buffer.from(decodeURIComponent(s.slice('data:image/svg+xml;utf8,'.length))) : s.startsWith('/src/') ? readFileSync(s.slice(1)) : s) as unknown as Promise<CanvasImageSource>
};
const URL_ = 'https://booth.example/p/0123456789abcdef0123456789abcdef';
const matrix = qrMatrix(URL_);
const profile = (o: Partial<EventProfile> = {}): EventProfile => { const p = { ...DEFAULT_EVENT_PROFILE, details: [], ...o } as EventProfile; return getActiveEvent({ events: [p], activeEventId: p.id }); };
const CTX = {
  plain: makeCtx('PHOTOBOOTH', new Date(2026, 9, 31, 10, 0)),
  info: makeEventCtx(profile({ name: 'ZEBRA FEST', header: 'WEDDING RECEPTION', details: ['GRAND BALLROOM'], thankYou: 'MERCI' }), new Date(2026, 9, 31, 10, 0))
};
type Pix = { data: ArrayLike<number>; width: number; height: number };
const pixels = (c: HTMLCanvasElement): Pix => { const d = (c as any).getContext('2d').getImageData(0, 0, c.width, c.height); return { data: d.data, width: d.width, height: d.height }; };
const at = (p: Pix, x: number, y: number) => { const i = (Math.round(y) * p.width + Math.round(x)) * 4; return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]]; };
const close = (a: number[], b: number[], t = 14) => [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) <= t);
const scan = (p: Pix) => jsQR(new Uint8ClampedArray(p.data as ArrayLike<number> as any), p.width, p.height)?.data ?? null;

let idb: FakeIndexedDB; const made: Record<string, string> = {};
beforeAll(() => {
  try { GlobalFonts.register(readFileSync('src/assets/fonts/courier-prime-latin-400-normal.woff2'), 'Courier Prime'); } catch { /* fallback font is fine for these checks */ }
  try { GlobalFonts.register(readFileSync('src/assets/fonts/courier-prime-latin-700-normal.woff2'), 'Courier Prime'); } catch { /* idem */ }
});
beforeEach(async () => {
  idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); ev.resetEventRuntime(); rt.resetCustomRuntime();
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => blobs.get(b as Blob) ?? 'data:,');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  await ev.initEventLayouts();
  for (const s of SPECS) { const r = await ev.createEventLayoutRecord({ name: s.name, eventId: 'event-1', art: paint(s) }); if (!r.ok) throw new Error(r.message); made[s.name] = r.value.id; }
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); ev.resetEventRuntime(); rt.resetCustomRuntime(); delete (globalThis as any).indexedDB; });
afterAll(() => { for (const k of Object.keys(made)) delete made[k]; });

describe('event layouts: printed pixels (generated: layout x paper x QR x info block)', () => {
  for (const s of SPECS) for (const mm of [58, 80] as const) for (const qr of [true, false]) for (const c of ['plain', 'info'] as const) {
    it(`${s.name} x ${mm}mm x QR ${qr ? 'on' : 'off'} x ${c}`, async () => {
      const id = made[s.name], dots = PAPER_DOTS[mm], ctx = CTX[c];
      const photos = s.windows.map((_, i) => solid(COLORS[i]));
      const snap = buildSnapshot(id, photos, frameForLayout(id, null));
      expect(snap.frameId).toBe(id); // the guest holds the layout's own art
      const opts = qr ? { matrix, paperDots: dots } : undefined;
      const plan = buildPlan(snap, ctx, dots, opts), k = plan.k;
      expect(verifyPlanQr(plan)).toEqual({ ok: true });
      expect(plan.cmds.filter((x) => x.op === 'photo')).toHaveLength(s.windows.length);
      expect(plan.cmds.filter((x) => x.op === 'image-frame')).toHaveLength(1);
      const canvas = await renderPrint(snap, ctx, mm, env, qr ? { matrix } : undefined);
      expect([canvas.width, canvas.height]).toEqual([plan.width, plan.height]);
      const px = pixels(canvas), L = resolveFramed(id, id);

      // Photos fill every window completely: no paper gap, no white, no art colour inside the hole (2 px inside the edge, every pixel).
      L.slots.forEach((w, i) => {
        const x0 = Math.ceil(w.x * k) + 2, x1 = Math.floor((w.x + w.w) * k) - 2, y0 = Math.ceil(w.y * k) + 2, y1 = Math.floor((w.y + w.h) * k) - 2;
        let bad = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!close(at(px, x, y), COLORS[i])) bad++;
        expect(bad, `window ${i + 1} is all photo`).toBe(0);
      });
      // Photos appear ONLY inside the windows: the margins, the gaps between windows and the area under the last one are the art.
      const first = L.slots[0], last = L.slots[L.slots.length - 1];
      for (const [x, y] of [[first.x / 2, first.y + first.h / 2], [first.x / 2, L.height / 2], [(first.x + first.w + L.width) / 2, first.y + first.h / 2], [L.width / 2, first.y / 2]]) expect(close(at(px, x * k, y * k), PAPER), `art at ${Math.round(x)},${Math.round(y)}`).toBe(true);
      for (let i = 0; i + 1 < L.slots.length; i++) { const a = L.slots[i], b = L.slots[i + 1]; expect(close(at(px, L.width / 2 * k, ((a.y + a.h + b.y) / 2) * k), PAPER), `gap ${i + 1}`).toBe(true); }
      expect(close(at(px, first.x * k / 2, (last.y + last.h / 2) * k), PAPER)).toBe(true);

      if (qr) expect(scan(px), 'QR decodes from the rendered colour canvas').toBe(URL_);
    }, 30000);
  }

  it('the frame overlay (GIF path) is clear in every window and opaque on the art', async () => {
    const id = made[SPECS[0].name], plan = buildPlan(buildSnapshot(id, SPECS[0].windows.map((_, i) => solid(COLORS[i])), id), CTX.plain, PAPER_DOTS[58]);
    const o = pixels(await renderOverlay(plan, env)), L = resolveFramed(id, id);
    for (const w of L.slots) expect(at(o, (w.x + w.w / 2) * plan.k, (w.y + w.h / 2) * plan.k)[3]).toBe(0);
    expect(at(o, L.slots[0].x * plan.k / 2, L.height / 2 * plan.k)).toEqual([...PAPER, 255]);
  }, 30000);

  it('the same art is never drawn on a standard layout', () => {
    for (const lid of ['single', 'strip-3', 'grid-2x2']) { const plan = buildPlan(buildSnapshot(lid, [solid(COLORS[0])], frameForLayout(lid, made[SPECS[0].name])), CTX.plain, 384); expect(plan.cmds.some((x) => x.op === 'image-frame' && x.src.startsWith('data:image/png;base64,' + '') && blobs.get(ev.eventLayoutRecords()[0].art.blob) === x.src)).toBe(false); }
  });
});

/**
 * EL-5: the owner's QR spot of an event layout. The art here changes colour EXACTLY at the drawn rectangle (no clear paper painted beyond it,
 * unlike SPECS above), which is what an owner's design really looks like. The spot is validated and saved the way ADMIN does it
 * (validateQrSpot with EVENT_SPOT_INSET, then setEventLayoutRecordQr), and the print must pass verifyPlanQr and decode.
 */
const EDGE: Spec = { name: 'Edge spot', W: 600, H: 1200, windows: [{ x: 60, y: 60, w: 480, h: 360 }, { x: 60, y: 480, w: 480, h: 360 }], qr: { x: 296, y: 856, w: 288, h: 288 } };
function paintEdge(s: Spec): CustomLayoutArt {
  const c = createCanvas(s.W, s.H), g = c.getContext('2d');
  g.fillStyle = `rgb(${PAPER.join(',')})`; g.fillRect(0, 0, s.W, s.H);
  g.fillStyle = '#fff'; g.fillRect(s.qr!.x, s.qr!.y, s.qr!.w, s.qr!.h); // clear paper only inside the drawn spot
  for (const w of s.windows) g.clearRect(w.x, w.y, w.w, w.h);
  const art: CustomLayoutArt = {
    blob: new Blob([new Uint8Array(c.toBuffer('image/png'))], { type: 'image/png' }), mime: 'image/png', width: s.W, height: s.H, heightRatio: s.H / s.W,
    windows: s.windows, slots: s.windows.map((w) => ({ x: w.x / s.W, y: w.y / s.W, w: w.w / s.W, h: w.h / s.W }))
  };
  blobs.set(art.blob, dataUrl(c));
  return art;
}
const decoded = (art: CustomLayoutArt, s: Spec) => { const c = createCanvas(s.W, s.H), g = c.getContext('2d'); g.fillStyle = `rgb(${PAPER.join(',')})`; g.fillRect(0, 0, s.W, s.H); g.fillStyle = '#fff'; g.fillRect(s.qr!.x, s.qr!.y, s.qr!.w, s.qr!.h); for (const w of s.windows) g.clearRect(w.x, w.y, w.w, w.h); const d = g.getImageData(0, 0, s.W, s.H); return { width: d.width, height: d.height, data: d.data as unknown as Uint8ClampedArray }; };
// The owner drags over the plain area; the pixel check rounds the rectangle outwards, so a rectangle exactly on the colour change is refused. 2 px inside it is accepted.
const drawn = (s: Spec): CustomQrArea => ({ x: (s.qr!.x + 2) / s.W, y: (s.qr!.y + 2) / s.H, w: (s.qr!.w - 4) / s.W, h: (s.qr!.h - 4) / s.H });
const MODULES = matrix.length + QR_MODULE_SLACK;

describe('event layouts: owner QR spot (EL-5)', () => {
  let id = '';
  beforeEach(async () => {
    const art = paintEdge(EDGE), r = await ev.createEventLayoutRecord({ name: EDGE.name, eventId: 'event-1', art });
    if (!r.ok) throw new Error(r.message);
    id = r.value.id;
    const v = validateQrSpot(art, decoded(art, EDGE), drawn(EDGE), MODULES, EVENT_SPOT_INSET);
    if (!v.ok) throw new Error(v.errors.join(' '));
    const saved = await ev.setEventLayoutRecordQr(id, v.value);
    if (!saved.ok) throw new Error(saved.message);
  });

  it('the saved spot is the drawn spot inset on every side, and it keeps the picture', () => {
    const d = ev.eventLayoutById(id)!, art = paintEdge(EDGE);
    expect(d.art.qr).toEqual(insetSpot(art, drawn(EDGE), EVENT_SPOT_INSET));
    expect(d.art.qr!.x).toBeGreaterThan(drawn(EDGE).x);
    expect(d.art.qr!.x + d.art.qr!.w).toBeLessThan(drawn(EDGE).x + drawn(EDGE).w);
    expect(d.art.qr!.y + d.art.qr!.h).toBeLessThan(drawn(EDGE).y + drawn(EDGE).h);
    expect(ev.eventFrameById(id)!.qr!.byLayout![id]).toBeTruthy(); // the synthetic frame carries it for qrAreaFor
  });

  for (const mm of [58, 80] as const) for (const c of ['plain', 'info'] as const) {
    it(`edge spot x ${mm}mm x ${c}: verifyPlanQr passes, the QR is inside the spot and decodes`, async () => {
      const dots = PAPER_DOTS[mm], ctx = CTX[c], photos = EDGE.windows.map((_, i) => solid(COLORS[i]));
      const snap = buildSnapshot(id, photos, frameForLayout(id, null));
      const plan = buildPlan(snap, ctx, dots, { matrix, paperDots: dots });
      expect(verifyPlanQr(plan)).toEqual({ ok: true });
      const qrCmd = plan.cmds.find((x) => x.op === 'qr') as Extract<RenderPlan['cmds'][number], { op: 'qr' }>;
      expect(qrCmd.mode, 'the QR is drawn on the picture, not on a strip').toBe('safe-area');
      expect(qrCmd.cutY).toBeUndefined();
      const a = ev.eventLayoutById(id)!.art, u = spotUnits(a, a.qr!), r = qrCmd.rect, e = 0.01;
      expect(r.x).toBeGreaterThanOrEqual(u.x - e); expect(r.y).toBeGreaterThanOrEqual(u.y - e);
      expect(r.x + r.w).toBeLessThanOrEqual(u.x + u.w + e); expect(r.y + r.h).toBeLessThanOrEqual(u.y + u.h + e);
      const canvas = await renderPrint(snap, ctx, mm, env, { matrix });
      expect(scan(pixels(canvas)), 'QR decodes from the rendered colour canvas').toBe(URL_);
    }, 30000);
  }

  it('without a QR spot the QR goes on the strip with a cut line (as before)', async () => {
    await ev.setEventLayoutRecordQr(id, null);
    const dots = PAPER_DOTS[58], snap = buildSnapshot(id, EDGE.windows.map((_, i) => solid(COLORS[i])), id);
    const plan = buildPlan(snap, CTX.plain, dots, { matrix, paperDots: dots });
    expect(verifyPlanQr(plan)).toEqual({ ok: true });
    const canvas = await renderPrint(snap, CTX.plain, 58, env, { matrix });
    expect(scan(pixels(canvas))).toBe(URL_);
  }, 30000);

  it('replacing the picture clears the QR spot (the store rule, EL-2) and the layout still prints', async () => {
    const r = await ev.setEventLayoutRecordArt(id, paintEdge(EDGE));
    expect(r.ok).toBe(true);
    expect(ev.eventLayoutById(id)!.art.qr).toBeUndefined();
    const dots = PAPER_DOTS[58], snap = buildSnapshot(id, EDGE.windows.map((_, i) => solid(COLORS[i])), id);
    expect(verifyPlanQr(buildPlan(snap, CTX.plain, dots, { matrix, paperDots: dots }))).toEqual({ ok: true });
  });
});
