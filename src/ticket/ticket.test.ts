// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { CODE128_PATTERNS, code128Modules, code128Runs, code128Symbols, decodeCode128Runs } from './code128';
import { BARCODE_MODULE, TICKET_ASPECT, TICKET_DEFAULTS, TICKET_FRAME_ID, TICKET_UNITS_H, TICKET_UNITS_W, resolveTicketInfo } from './config';
import { TICKET_TEMPLATES, buildTicket, isTicketLayoutId, wrapLines } from './layout';
import { FRAMES, frameForLayout, framesForLayout, getFrame, resolveFramed, vectorFrameOf } from '../frames/registry';
import { LAYOUTS } from '../layouts/registry';
import { framePrims, makeCtx, makeEventCtx } from '../frames/prims';
import { buildSnapshot } from '../editor/model';
import { buildPlan, verifyPlanQr } from '../render/plan';
import { renderPlan, renderPrint, type RenderEnv } from '../render/render';
import { primRegions, overlaps, inflate } from '../qr/placement';
import { qrMatrix } from '../share/qr';
import { canvasToRGBA } from '../print/browser';
import { toThermalBitmap } from '../print/pipeline';
import { bitmapToRGBA } from '../print/bitmap';
import { DEFAULT_THERMAL } from '../print/types';
import { PAPER_DOTS } from '../layouts/engine';
import { DEFAULT_EVENT_PROFILE } from '../config/events';
import { infoItems } from '../render/info';
import type { Prim } from '../frames/types';

const ctx = makeCtx('PHOTOBOOTH', new Date(2026, 9, 24, 18, 0));
const ASPECTS = [1.3, 1.4, 1.5, 1.7];
const IDS = TICKET_TEMPLATES.map((t) => t.id);
const HEIGHTS = ASPECTS.map((a) => Math.round(TICKET_UNITS_W / a));

describe('Code 128', () => {
  it('every symbol pattern is 11 modules wide (stop is 13)', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.forEach((p, i) => expect([...p].reduce((a, c) => a + Number(c), 0), `symbol ${i}`).toBe(i === 106 ? 13 : 11));
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
  });
  it('encodes and decodes back (set C digits, set B text) with a valid checksum', () => {
    for (const v of ['146020', '2026102412', 'J146NCL', 'J146 NCL-20', 'Ab~z']) expect(decodeCode128Runs(code128Runs(v)), v).toBe(v);
    expect(code128Symbols('146020')[0]).toBe(105);
    expect(code128Symbols('J146NCL')[0]).toBe(104);
    expect(code128Modules('146020')).toBe(11 + 3 * 11 + 11 + 13); // start + 3 pairs + check + stop
  });
  it('a corrupted run list is rejected', () => {
    const r = code128Runs('146020'); r[7] = r[7] === 1 ? 2 : 1;
    expect(decodeCode128Runs(r)).toBeNull();
  });
});

describe('ticket wording', () => {
  it('defaults are the requested J146 NCL details', () => {
    expect(resolveTicketInfo(ctx)).toEqual(TICKET_DEFAULTS);
    expect(TICKET_DEFAULTS).toMatchObject({ code: 'J146 NCL', title: '20th Anniversary', date: 'OCT 24, 2026', venue: 'DURIAN ST CALOOCAN', verse: 'EPHESIANS 4:11-13', secondary: 'BUILD UP', brand: 'MEMORYS', tagline: 'YOUR MOMENTS, OFFICIALLY RECEIPTED.' });
  });
  it('the owner event profile overrides them (no new settings screen)', () => {
    const c = makeEventCtx({ ...DEFAULT_EVENT_PROFILE, name: 'K9 GALA', header: '5th Year', details: ['NOV 1, 2026', 'MANILA HALL', 'JOHN 3:16'], thankYou: 'SEE YOU' });
    expect(resolveTicketInfo(c)).toMatchObject({ code: 'K9 GALA', title: '5th Year', date: 'NOV 1, 2026', venue: 'MANILA HALL', verse: 'JOHN 3:16', secondary: 'SEE YOU' });
    const texts = buildTicket('ticket-4', resolveTicketInfo(c)).prims.flatMap((p) => (p.k === 'text' ? [p.text] : []));
    expect(texts).toContain('K9 GALA'); expect(texts).not.toContain('J146 NCL');
  });
  it('an untouched default profile keeps the ticket defaults', () => {
    expect(resolveTicketInfo(makeEventCtx({ ...DEFAULT_EVENT_PROFILE })).code).toBe('J146 NCL');
  });
});

describe('landscape geometry (all four templates)', () => {
  it('registers exactly the four layouts, locked to the ticket frame', () => {
    expect(IDS).toEqual(['ticket-4', 'ticket-1', 'ticket-2', 'ticket-3']);
    expect(TICKET_TEMPLATES.map((t) => t.name)).toEqual(['Classic Boarding Pass — 4 Photos', 'Compact Ticket — 1 Photo', 'Double Ticket — 2 Photos', 'Triple Ticket — 3 Photos']);
    for (const id of IDS) { expect(LAYOUTS.find((l) => l.id === id)?.frame).toBe(TICKET_FRAME_ID); expect(isTicketLayoutId(id)).toBe(true); }
    expect(LAYOUTS.length).toBe(6 + 4); // the six existing layouts are untouched
  });
  it('width > height on every paper width, exactly the paper width wide', () => {
    for (const id of IDS) for (const w of [384, 576]) {
      const L = resolveFramed(id, TICKET_FRAME_ID, w);
      expect(L.width, `${id}@${w}`).toBe(w);
      expect(L.width).toBeGreaterThan(L.height);
      expect(L.height).toBe(Math.round(w / TICKET_ASPECT));
    }
    expect(resolveFramed('ticket-4', TICKET_FRAME_ID).height).toBe(TICKET_UNITS_H);
  });
  for (const H of HEIGHTS) for (const t of TICKET_TEMPLATES) {
    it(`${t.id} @ ${TICKET_UNITS_W}x${H}: windows inside, equal, ordered, nothing overlaps`, () => {
      const b = buildTicket(t.id, TICKET_DEFAULTS, TICKET_UNITS_W, H);
      expect(b.slots).toHaveLength(t.photos);
      const s0 = b.slots[0];
      b.slots.forEach((s, i) => {
        expect(s.w).toBe(s0.w); expect(s.h).toBe(s0.h); expect(s.y).toBe(s0.y);
        expect(s.x).toBeGreaterThanOrEqual(0); expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.x + s.w).toBeLessThanOrEqual(TICKET_UNITS_W); expect(s.y + s.h).toBeLessThanOrEqual(H);
        if (i) expect(s.x).toBeGreaterThan(b.slots[i - 1].x + b.slots[i - 1].w); // left to right, no overlap
      });
      expect(s0.w / s0.h).toBeGreaterThan(0.3); // faces stay recognisable (a window is never a sliver)
      // the stub (and its QR area) is on the right, the windows are all left of the perforation
      const perf = TICKET_UNITS_W - Math.round(TICKET_UNITS_W * 0.23);
      for (const s of b.slots) expect(s.x + s.w).toBeLessThan(perf);
      expect(b.qrArea.x).toBeGreaterThan(perf); expect(b.qrArea.x + b.qrArea.w).toBeLessThanOrEqual(TICKET_UNITS_W); expect(b.qrArea.y + b.qrArea.h).toBeLessThanOrEqual(H);
      // no ink collides with another element, a photo window or the QR area; every box is on the paper
      const boxes: { p: Prim; r: ReturnType<typeof primRegions>[number] }[] = [];
      b.prims.forEach((p, i) => {
        // outline, perforation and notches are the ticket body itself (they intentionally touch the edge / the stub)
        if (i < 5) return;
        for (const r of primRegions(p, TICKET_UNITS_W, H)) boxes.push({ p, r });
      });
      for (const { p, r } of boxes) {
        expect(r.x, `${p.k} x`).toBeGreaterThanOrEqual(2); expect(r.y, `${p.k} y`).toBeGreaterThanOrEqual(2);
        expect(r.x + r.w, `${p.k} right`).toBeLessThanOrEqual(TICKET_UNITS_W - 2); expect(r.y + r.h, `${p.k} bottom`).toBeLessThanOrEqual(H - 2);
        for (const s of b.slots) expect(overlaps(r, s), `${p.k} over photo window`).toBe(false);
        expect(overlaps(inflate(b.qrArea, 0), r), `${p.k} inside QR area`).toBe(false);
      }
      const texts = boxes.filter((x) => x.p.k === 'text');
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++)
        expect(overlaps(texts[i].r, texts[j].r), `${(texts[i].p as any).text} vs ${(texts[j].p as any).text}`).toBe(false);
      // text never goes below the thermal legibility floor
      for (const { p } of texts) expect((p as any).size).toBeGreaterThanOrEqual(9 - 1e-6);
    });
  }
  it('long owner text wraps or shrinks instead of overflowing', () => {
    const long = { ...TICKET_DEFAULTS, code: 'THE VERY LONG EVENT CODE', title: 'A Really Long Anniversary Title Here', venue: 'SOMEWHERE VERY FAR AWAY FROM THE CITY CENTER', verse: 'ROMANS 12:1-2 AND MORE VERSES', secondary: 'BUILD UP THE BODY OF CHRIST', tagline: 'A VERY LONG TAGLINE THAT KEEPS GOING AND GOING' };
    for (const t of TICKET_TEMPLATES) for (const p of buildTicket(t.id, long).prims) for (const r of primRegions(p, TICKET_UNITS_W, TICKET_UNITS_H)) {
      if (p.k === 'rect' && p.stroke) continue;
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.w).toBeLessThanOrEqual(TICKET_UNITS_W + 0.5);
    }
  });
  it('wrapLines respects the floor', () => {
    const w = wrapLines('OFFICIALLY RECEIPTED', 40, 9, 2);
    expect(w.size).toBeGreaterThanOrEqual(9); expect(w.lines.length).toBeLessThanOrEqual(2);
  });
  it('the barcode is a real Code 128 whose bars land on whole dots at 80mm and stays inside its box', () => {
    for (const t of TICKET_TEMPLATES) {
      const bars = buildTicket(t.id, TICKET_DEFAULTS).prims.filter((p): p is Extract<Prim, { k: 'rect' }> => p.k === 'rect' && p.fill === '#000' && p.h >= 30 && p.h <= 34 && p.w < 12);
      expect(bars.length, t.id).toBeGreaterThan(15);
      for (const r of bars) { expect(Number.isInteger(Math.round(r.w * 1.5 * 1000) / 1000)).toBe(true); expect(Math.abs(r.w * 1.5 - Math.round(r.w * 1.5))).toBeLessThan(1e-6); }
    }
    expect(BARCODE_MODULE * 1.5).toBe(2);
  });
});

describe('frame plumbing', () => {
  it('tickets only ever use the ticket frame and no other layout can use it', () => {
    for (const id of IDS) { expect(frameForLayout(id, 'classic-receipt')).toBe(TICKET_FRAME_ID); expect(framesForLayout(id).map((f) => f.id)).toEqual([TICKET_FRAME_ID]); }
    expect(frameForLayout('strip-3', TICKET_FRAME_ID)).toBe('classic-receipt');
    expect(frameForLayout('strip-3', 'birthday')).toBe('birthday');
    expect(framesForLayout('strip-3').some((f) => f.id === TICKET_FRAME_ID)).toBe(false);
    expect(framesForLayout('strip-3').length).toBe(FRAMES.length - 1); // every existing frame stays available
  });
  it('the ticket frame draws nothing on a non-ticket layout', () => {
    expect(framePrims(vectorFrameOf(getFrame(TICKET_FRAME_ID)), resolveFramed('strip-3', TICKET_FRAME_ID), ctx)).toEqual([]);
  });
  it('captured photos fill the windows in order; missing photos repeat (the app\'s existing behaviour)', () => {
    const src = (n: number) => ({ src: `p${n}`, iw: 1600, ih: 1200 });
    const four = buildSnapshot('ticket-4', [src(1), src(2), src(3), src(4)]);
    expect(four.frameId).toBe(TICKET_FRAME_ID);
    expect(four.objects.map((o) => (o as any).src)).toEqual(['p1', 'p2', 'p3', 'p4']);
    const two = buildSnapshot('ticket-4', [src(1), src(2)]);
    expect(two.objects.map((o) => (o as any).src)).toEqual(['p1', 'p2', 'p1', 'p2']);
    expect(buildSnapshot('ticket-1', [src(1)]).objects).toHaveLength(1);
    expect(buildSnapshot('ticket-2', [src(1), src(2)]).objects).toHaveLength(2);
    expect(buildSnapshot('ticket-3', [src(1), src(2), src(3)]).objects).toHaveLength(3);
    const L = resolveFramed('ticket-4', TICKET_FRAME_ID);
    four.objects.forEach((o, i) => expect(o).toMatchObject({ x: L.slots[i].x, y: L.slots[i].y, w: L.slots[i].w, h: L.slots[i].h }));
  });
  it('the ticket prints every owner field itself, so no info block is added below it', () => {
    const c = makeEventCtx({ ...DEFAULT_EVENT_PROFILE, details: ['A', 'B', 'C'], header: 'H' });
    expect(infoItems(c, getFrame(TICKET_FRAME_ID).prints)).toEqual([]);
    expect(infoItems(c, {}).length).toBeGreaterThan(0);
  });
});

// ---------------- real pixels ----------------
const fontOk = (() => { try { GlobalFonts.register(readFileSync('src/assets/fonts/courier-prime-latin-400-normal.woff2'), 'Courier Prime'); GlobalFonts.register(readFileSync('src/assets/fonts/courier-prime-latin-700-normal.woff2'), 'Courier Prime'); return true; } catch { return false; } })();
void fontOk;
const PHOTOS = [1, 2, 3, 4].map((n) => `/tmp/photos/p${n}.jpg`).filter(existsSync);
const env: RenderEnv = { canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement, image: (s) => loadImage(s.startsWith('/') ? readFileSync(s) : s) as unknown as Promise<CanvasImageSource> };
const flat = (() => { const c = createCanvas(1600, 1200), g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, 1600, 1200); g.fillStyle = '#222'; g.beginPath(); g.arc(800, 520, 260, 0, 7); g.fill(); return 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64'); })();
const srcs = (n: number) => Array.from({ length: n }, (_, i) => ({ src: PHOTOS.length ? PHOTOS[i % PHOTOS.length] : flat, iw: PHOTOS.length ? 783 : 1600, ih: PHOTOS.length ? 891 : 1200 }));
const URL_QR = qrMatrix('https://memorys.example/p/7f3a9c1e5b2d48a6b0c4e9d1f2a37b85');

describe('rendered tickets (real pixels, QR + thermal pipeline)', () => {
  for (const t of TICKET_TEMPLATES) for (const mm of [80, 58] as const) {
    it(`${t.id} on ${mm}mm paper: landscape, full paper width, QR on the stub, 1-bit output keeps the shape`, async () => {
      const snap = buildSnapshot(t.id, srcs(t.photos));
      const dots = PAPER_DOTS[mm];
      let plan;
      try { plan = buildPlan(snap, ctx, dots, { matrix: URL_QR, paperDots: dots, allowStrip: false }); }
      catch (e: any) { if (mm === 58) { expect(e.name).toBe('QrPlacementError'); return; } throw e; } // 58mm: the stub cannot hold a scannable QR (documented limit)
      expect(plan.width).toBe(dots);
      expect(plan.width).toBeGreaterThan(plan.height);
      expect(plan.height).toBe(Math.round(plan.unitsH * plan.k));
      expect(plan.unitsH).toBe(TICKET_UNITS_H); // the QR sits inside the stub: the canvas never grows into a strip
      expect(plan.cmds.map((c) => c.op)).toEqual([...Array(t.photos).fill('photo'), 'frame', 'qr']);
      const q = plan.cmds[plan.cmds.length - 1];
      if (q.op !== 'qr') throw new Error('no qr');
      expect(q.mode).toBe('safe-area');
      const area = buildTicket(t.id, TICKET_DEFAULTS).qrArea;
      expect(q.rect.x).toBeGreaterThanOrEqual(area.x); expect(q.rect.y).toBeGreaterThanOrEqual(area.y);
      expect(q.rect.x + q.rect.w).toBeLessThanOrEqual(area.x + area.w); expect(q.rect.y + q.rect.h).toBeLessThanOrEqual(area.y + area.h);
      expect(q.rect.w).toBe(q.rect.h); // square, never stretched
      expect(verifyPlanQr(plan).ok).toBe(true);
      const canvas = await renderPrint(snap, ctx, mm, env, { matrix: URL_QR, paperDots: dots, allowStrip: false });
      expect(canvas.width).toBe(dots); expect(canvas.width).toBeGreaterThan(canvas.height);
      const bmp = toThermalBitmap(canvasToRGBA(canvas), { ...DEFAULT_THERMAL, marginX: 0 }, dots);
      expect(bmp.width).toBe(dots);
      expect(bmp.height).toBe(canvas.height + DEFAULT_THERMAL.marginTop + DEFAULT_THERMAL.marginBottom); // not rotated, not scaled: ticket height + the usual feed margin
      expect(bmp.width).toBeGreaterThan(bmp.height);
      const dir = process.env.TICKET_PREVIEW_DIR;
      if (dir && mm === 80) {
        mkdirSync(dir, { recursive: true });
        const colour = await renderPlan(buildPlan(snap, ctx, dots * 2, { matrix: URL_QR, paperDots: dots, allowStrip: false }), env);
        writeFileSync(`${dir}/${t.id}-preview.png`, (colour as any).toBuffer('image/png'));
        const rgba = bitmapToRGBA(bmp), out = createCanvas(bmp.width, bmp.height), g = out.getContext('2d');
        const id = g.createImageData(bmp.width, bmp.height); id.data.set(rgba.data); g.putImageData(id, 0, 0);
        writeFileSync(`${dir}/${t.id}-print-1bit.png`, out.toBuffer('image/png'));
      }
    });
  }
  it('without a share QR the ticket still renders (no QR, same landscape canvas)', async () => {
    const snap = buildSnapshot('ticket-2', srcs(2));
    const c = await renderPrint(snap, ctx, 80, env);
    expect(c.width).toBe(576); expect(c.height).toBe(Math.round(TICKET_UNITS_H * 1.5));
  });
});
