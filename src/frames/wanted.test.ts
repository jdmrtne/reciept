// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { buildPlan } from '../render/plan';
import { renderPlan, type RenderEnv } from '../render/render';
import { buildSnapshot, withFilter, withFrame } from '../editor/model';
import { LAYOUTS } from '../layouts/registry';
import { FRAMES, getFrame, resolveFramed } from './registry';
import { framePrims, makeCtx } from './prims';

const ID = 'straw-hat-wanted';
const ctx = makeCtx('PHOTOBOOTH', new Date(2026, 8, 30, 20, 56));
const SRC = (() => { const c = createCanvas(800, 600), g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 800, 600); return 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64'); })();
const env: RenderEnv = { canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement, image: (s) => loadImage(s) as unknown as Promise<CanvasImageSource> };
const px = (c: HTMLCanvasElement, x: number, y: number) => [...(c as any).getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data];

describe('STRAW HAT WANTED frame', () => {
  it('is registered once and does not change the other frames', () => {
    expect(FRAMES.filter((f) => f.id === ID)).toHaveLength(1);
    expect(getFrame(ID).name).toBe('STRAW HAT WANTED');
    expect(FRAMES[0].id).toBe('classic-receipt'); // default untouched
  });

  it('cuts exactly one parchment hole per layout slot, for every layout', () => {
    for (const l of LAYOUTS) {
      const L = resolveFramed(l.id, ID);
      const sheet = framePrims(getFrame(ID), L, ctx).find((p) => p.k === 'path' && p.eo) as any;
      const holes = sheet.cmds.filter((c: any) => c[0] === 'Z').length - 1; // minus the poster outline itself
      expect(holes).toBe(L.slots.length);
    }
  });

  it('keeps photos full colour: slot centres show the exact source pixels, with any layout and the default filter', async () => {
    for (const l of LAYOUTS) {
      const snap = withFrame(buildSnapshot(l.id, [{ src: SRC, iw: 800, ih: 600 }]), ID);
      const plan = buildPlan(snap, ctx, 384);
      const c = await renderPlan(plan, env);
      for (const o of snap.objects) expect(px(c, o.x + o.w / 2, o.y + o.h / 2).slice(0, 3)).toEqual([255, 0, 0]);
    }
  }, 30000);

  it('parchment is drawn (not white) between slots and around the edge, but a filter still only touches photos', async () => {
    const snap = withFilter(withFrame(buildSnapshot('grid-2x2', [{ src: SRC, iw: 800, ih: 600 }]), ID), 'grayscale');
    const c = await renderPlan(buildPlan(snap, ctx, 384), env);
    const [r, g, b] = px(c, 192, 60); // header band, beside the lettering
    expect(r).toBeGreaterThan(g); expect(g).toBeGreaterThan(b); // warm paper, not gray or white
    const [pr, pg, pb] = px(c, snap.objects[0].x + 10, snap.objects[0].y + 10);
    expect(Math.abs(pr - pg) + Math.abs(pg - pb)).toBeLessThan(4); // grayscale applied to the photo only
  });
});
