// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import * as rt from './runtime';
import { validateArtwork } from './validate';
import { makeArt, STRIP, W } from './fixtures';
import { QR_MODULE_SLACK, suggestQrSpot, validateQrSpot } from './qrArea';
import { QrPlacementError } from '../../qr/placement';
import { buildSnapshot, withFrame } from '../../editor/model';
import { buildPlan, verifyPlanQr } from '../../render/plan';
import { renderPlan, type RenderEnv } from '../../render/render';
import { makeCtx } from '../prims';
import { qrMatrix } from '../../share/qr';

const ctx = makeCtx('PHOTOBOOTH', new Date(2026, 9, 28, 10, 0));
const green = (() => { const c = createCanvas(1600, 900); const g = c.getContext('2d'); g.fillStyle = '#0f0'; g.fillRect(0, 0, 1600, 900); return 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64'); })();
const srcs = [{ src: green, iw: 1600, ih: 900 }, { src: green, iw: 1600, ih: 900 }];
const matrix = qrMatrix('https://receipt-beta.vercel.app/p/abcdefghijkl');
const MODULES = matrix.length + QR_MODULE_SLACK;
const H = 1760;

const bySize = new Map<number, Buffer>();
const env: RenderEnv = {
  canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
  image: (s) => loadImage(s.startsWith('blob:t/') ? bySize.get(Number(s.slice(7)))! : s) as unknown as Promise<CanvasImageSource>
};
let idb: FakeIndexedDB, frameId: string;

async function install(fx: ReturnType<typeof makeArt>, qr?: { x: number; y: number; w: number; h: number }) {
  const v = validateArtwork('strip-2', fx); if (!v.ok) throw new Error(v.errors.join());
  bySize.set(fx.png.length, fx.png);
  await rt.setCustomLayoutArt(frameId, 'strip-2', { ...v.value, ...(qr ? { qr } : {}), blob: new Blob([new Uint8Array(fx.png)], { type: 'image/png' }) });
  return v.value;
}
beforeEach(async () => {
  idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); rt.resetCustomRuntime(); bySize.clear();
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => `blob:t/${(b as Blob).size}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  const f = await rt.createCustomFrame('Spot Frame'); if (!f.ok) throw new Error('create');
  frameId = f.value.id;
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); rt.resetCustomRuntime(); delete (globalThis as any).indexedDB; });

const plan = (paperDots = 384) => buildPlan(withFrame(buildSnapshot('strip-2', srcs), frameId), ctx, 576, { matrix, paperDots });

describe('QR spot through the real plan and renderer', () => {
  it('a suggested spot is used: safe-area placement inside the spot, no extra strip, plan verified, pixel gate passes', async () => {
    const fx = makeArt(W, H, STRIP(2)), meta = await install(fx);
    const spot = suggestQrSpot(meta, fx, MODULES); if (!spot) throw new Error('no spot');
    expect((await rt.setCustomLayoutQr(frameId, 'strip-2', spot)).ok).toBe(true);
    for (const paperDots of [384, 576]) {
      const p = plan(paperDots), q = p.cmds.find((c) => c.op === 'qr') as any;
      expect(q.mode).toBe('safe-area');
      expect(verifyPlanQr(p)).toEqual({ ok: true });
      const Hu = Math.round(384 * (H / W));
      expect(q.rect.x).toBeGreaterThanOrEqual(spot.x * 384 - 1); expect(q.rect.x + q.rect.w).toBeLessThanOrEqual((spot.x + spot.w) * 384 + 1);
      expect(q.rect.y).toBeGreaterThanOrEqual(spot.y * Hu - 1); expect(q.rect.y + q.rect.h).toBeLessThanOrEqual((spot.y + spot.h) * Hu + 1);
      await expect(renderPlan(p, env)).resolves.toBeTruthy();
    }
  }, 60000);
  it('a hand drawn good spot works the same way', async () => {
    const fx = makeArt(W, H, STRIP(2)), meta = await install(fx);
    const r = validateQrSpot(meta, fx, { x: 0.1, y: 1200 / H, w: 0.8, h: 520 / H }, MODULES); if (!r.ok) throw new Error(r.errors.join());
    await rt.setCustomLayoutQr(frameId, 'strip-2', r.value);
    expect((plan().cmds.find((c) => c.op === 'qr') as any).mode).toBe('safe-area');
  });
  it('no spot: strip below the design, as before', async () => {
    await install(makeArt(W, H, STRIP(2)));
    const p = plan(), q = p.cmds.find((c) => c.op === 'qr') as any;
    expect(q.mode).toBe('strip'); expect(verifyPlanQr(p)).toEqual({ ok: true });
  });
  it('why the screen refuses a spot with artwork in it: the renderer gate blocks the print', async () => {
    const busy = makeArt(W, H, STRIP(2), (g) => { g.fillStyle = '#fff'; g.fillRect(300, 1400, 400, 40); });
    const meta = await install(busy);
    const bad = { x: 0.1, y: 1200 / H, w: 0.8, h: 520 / H };
    expect(validateQrSpot(meta, busy, bad, MODULES).ok).toBe(false); // the admin screen never saves it
    await rt.setCustomLayoutQr(frameId, 'strip-2', bad);            // forced past the screen, to prove the gate
    await expect(renderPlan(plan(), env)).rejects.toBeInstanceOf(QrPlacementError);
  }, 60000);
  it('why the screen refuses a spot over a window: placement fails and the plan is not built', async () => {
    const fx = makeArt(W, H, STRIP(2)), meta = await install(fx);
    const bad = { x: 0.1, y: 900 / H, w: 0.8, h: 520 / H };
    expect(validateQrSpot(meta, fx, bad, MODULES).ok).toBe(false);
    await rt.setCustomLayoutQr(frameId, 'strip-2', bad);
    expect(() => plan()).toThrow(QrPlacementError);
  });
});
