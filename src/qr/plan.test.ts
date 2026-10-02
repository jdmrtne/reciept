// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { buildPlan, verifyPlanQr } from '../render/plan';
import { renderPlan, renderPrint, type RenderEnv } from '../render/render';
import { buildSnapshot } from '../editor/model';
import { FRAMES } from '../frames/registry';
import { LAYOUTS } from '../layouts/registry';
import { makeCtx } from '../frames/prims';
import { QrPlacementError, cutBand, CUT_SW } from './placement';
import { QUIET } from '../share/qr';

void GlobalFonts;
const ctx = makeCtx('PHOTOBOOTH', new Date(2026, 9, 2, 13, 35));
const photos = [{ src: 'a', iw: 1600, ih: 900 }, { src: 'b', iw: 1600, ih: 900 }];
const matrix = Array.from({ length: 37 }, (_, r) => Array.from({ length: 37 }, (_, c) => (r * 7 + c * 3) % 5 === 0));

describe('buildPlan with a QR', () => {
  it('without a QR the plan is unchanged: no qr command', () => {
    expect(buildPlan(buildSnapshot('single', photos), ctx, 384).cmds.some((c) => c.op === 'qr')).toBe(false);
  });
  for (const f of FRAMES) for (const l of LAYOUTS) {
    it(`${f.id} × ${l.id}: the design is byte-identical, the QR is last, below it, and verified`, () => {
      const snap = buildSnapshot(l.id, photos, f.id);
      const plain = buildPlan(snap, ctx, 384), withQr = buildPlan(snap, ctx, 384, { matrix });
      expect(withQr.cmds.slice(0, -1)).toEqual(plain.cmds);
      expect(withQr.cmds[withQr.cmds.length - 1].op).toBe('qr');
      expect(withQr.height).toBeGreaterThan(plain.height);
      expect(verifyPlanQr(withQr).ok).toBe(true);
    });
  }
  it('refuses to place a QR when the frame has no safe area and the strip is not allowed', () => {
    expect(() => buildPlan(buildSnapshot('single', photos), ctx, 384, { matrix, allowStrip: false })).toThrow(QrPlacementError);
  });
  it('the export gate catches a QR moved over a photo', () => {
    const p = buildPlan(buildSnapshot('single', photos), ctx, 384, { matrix });
    const bad = { ...p, cmds: p.cmds.map((c) => (c.op === 'qr' ? { ...c, rect: { ...c.rect, x: 100, y: 100 } } : c)) };
    expect(verifyPlanQr(bad).ok).toBe(false);
  });
});

describe('cut line between the design and the QR', () => {
  type QrCmd = Extract<ReturnType<typeof buildPlan>['cmds'][number], { op: 'qr' }>;
  const qrOf = (p: ReturnType<typeof buildPlan>) => p.cmds[p.cmds.length - 1] as QrCmd;
  for (const f of FRAMES) for (const l of LAYOUTS) {
    it(`${f.id} × ${l.id}: the cut line is below the design and above the QR`, () => {
      const plan = buildPlan(buildSnapshot(l.id, photos, f.id), ctx, 384, { matrix }), q = qrOf(plan);
      expect(q.mode).toBe('strip');
      expect(q.cutY).toBeDefined();
      expect(q.cutY! - cutBand(q.cutY!, 384).h / 2).toBeGreaterThanOrEqual(q.designHeight); // scissors clear of the design
      expect(q.cutY! + CUT_SW / 2 + q.margin).toBeLessThanOrEqual(q.rect.y);                  // QR clear of the line
      expect(verifyPlanQr(plan).ok).toBe(true);
    });
  }
  it('the export gate catches a cut line dragged onto the design', () => {
    const p = buildPlan(buildSnapshot('single', photos), ctx, 384, { matrix });
    expect(verifyPlanQr({ ...p, cmds: p.cmds.map((c) => (c.op === 'qr' ? { ...c, cutY: 40 } : c)) }).ok).toBe(false);
  });
  it('the export gate catches a QR that touches the cut line', () => {
    const p = buildPlan(buildSnapshot('single', photos), ctx, 384, { matrix });
    expect(verifyPlanQr({ ...p, cmds: p.cmds.map((c) => (c.op === 'qr' ? { ...c, cutY: c.rect.y } : c)) }).ok).toBe(false);
  });
});

describe('rendering the QR', () => {
  const png = (w: number, h: number, c: string) => { const k = createCanvas(w, h), g = k.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, w, h); return 'data:image/png;base64,' + k.toBuffer('image/png').toString('base64'); };
  const src = png(1600, 900, '#0a0');
  const env: RenderEnv = { canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement, image: (s) => loadImage(s) as unknown as Promise<CanvasImageSource> };
  const snap = buildSnapshot('single', [{ src, iw: 1600, ih: 900 }], 'minimal-receipt');

  it('draws the QR in its reserved box and leaves the rest of the strip white', async () => {
    const plan = buildPlan(snap, ctx, 384, { matrix }), q = plan.cmds[plan.cmds.length - 1];
    if (q.op !== 'qr') throw new Error('no qr');
    const c = await renderPlan(plan, env), g = (c as any).getContext('2d');
    expect(c.height).toBe(plan.height);
    const n = matrix.length + QUIET * 2, mod = Math.floor(q.rect.w / n), px = mod * n, x0 = Math.round(q.rect.x + (q.rect.w - px) / 2), y0 = Math.round(q.rect.y + (q.rect.h - px) / 2);
    const dark = (r: number, cc: number) => g.getImageData(x0 + (cc + QUIET) * mod + 1, y0 + (r + QUIET) * mod + 1, 1, 1).data[0] < 60;
    for (const [r, cc] of [[0, 0], [0, 36], [36, 0], [1, 1], [5, 7]]) expect(dark(r, cc)).toBe(matrix[r][cc]);
    expect(g.getImageData(4, plan.height - 4, 1, 1).data[0]).toBe(255); // strip corner stays paper white
  });
  it('draws a dashed cut line with scissors in the strip, between the design and the QR', async () => {
    const plan = buildPlan(snap, ctx, 384, { matrix }), q = plan.cmds[plan.cmds.length - 1];
    if (q.op !== 'qr' || q.cutY === undefined) throw new Error('no cut line');
    const c = await renderPlan(plan, env), g = (c as any).getContext('2d');
    const row = Array.from({ length: 384 }, (_, x) => g.getImageData(x, q.cutY!, 1, 1).data[0] < 100);
    const dashed = row.slice(34, 374), ink = dashed.filter(Boolean).length;
    expect(ink).toBeGreaterThan(dashed.length * 0.4);   // a visible line,
    expect(ink).toBeLessThan(dashed.length * 0.8);      // but dashed, not solid
    expect(row.slice(8, 30).some(Boolean)).toBe(true);  // scissors at the left end
    const rowsBetween = (y0: number, y1: number) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < 384; x++) if (g.getImageData(x, y, 1, 1).data[0] < 100) n++; return n; };
    expect(rowsBetween(plan.height - 6, plan.height)).toBe(0);             // nothing printed under the QR
    expect(rowsBetween(Math.ceil(q.designHeight), Math.floor(q.cutY! - 6))).toBe(0); // gap under the design stays white
  });
  it('the printed canvas is taller than the design but the design rows are identical', async () => {
    const withQr = await renderPrint(snap, ctx, 58, env, { matrix }), without = await renderPrint(snap, ctx, 58, env);
    const a = (withQr as any).getContext('2d').getImageData(0, 0, 384, without.height).data, b = (without as any).getContext('2d').getImageData(0, 0, 384, without.height).data;
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });
  it('rendering is refused (not silently drawn over content) when the QR box is not empty', async () => {
    const plan = buildPlan(snap, ctx, 384, { matrix });
    const bad = { ...plan, cmds: plan.cmds.map((c) => (c.op === 'qr' ? { ...c, rect: { ...c.rect, x: 100, y: 100 } } : c)) };
    await expect(renderPlan(bad, env)).rejects.toBeInstanceOf(QrPlacementError);
  });
});
