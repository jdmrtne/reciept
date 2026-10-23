// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync } from 'fs';
import { join } from 'path';
import { COUPLED_FRAMES, DEFAULT_FRAME, FRAMES, PASS_FRAME_ID, STANDARD_FRAMES, frameForLayout, framesForLayout, getFrame, isFrameAllowed, resolveFramed } from './registry';
import { LAYOUTS, PASS_LAYOUTS, STANDARD_LAYOUTS, getLayout } from '../layouts/registry';
import { slotCount } from '../layouts/engine';
import { buildSnapshot } from '../editor/model';
import { rotatedSize } from '../editor/rotate';
import { buildPlan, verifyPlanQr } from '../render/plan';
import { qrAreaFor, qrMinSide, regionIsClear } from '../qr/placement';
import { makeEventCtx } from './prims';
import { DEFAULT_EVENT_PROFILE } from '../config/events';

const IDS = ['pass-1', 'pass-2', 'pass-3', 'pass-4'];
const COUNTS = [1, 2, 3, 4];
const photos = [{ src: 'a', iw: 1080, ih: 1920 }];
const matrixOf = (n: number) => Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (r * 7 + c * 3) % 5 === 0));
const ctx = makeEventCtx({ ...DEFAULT_EVENT_PROFILE, details: [] }, new Date(2026, 9, 24, 10, 0));

describe('registration', () => {
  it('adds exactly four layouts and one frame-locked frame, after everything that already existed', () => {
    expect(PASS_LAYOUTS.map((l) => l.id)).toEqual(IDS);
    expect(LAYOUTS.slice(-4).map((l) => l.id)).toEqual(IDS);
    expect(STANDARD_LAYOUTS.map((l) => l.id)).toEqual(['single', 'strip-2', 'strip-3', 'strip-4', 'grid-2x2', 'classic']);
    expect(COUPLED_FRAMES.map((f) => f.id)).toEqual([PASS_FRAME_ID]);
    expect(FRAMES[0].id).toBe(DEFAULT_FRAME);
    expect(STANDARD_FRAMES.some((f) => f.id === PASS_FRAME_ID)).toBe(false);
  });
  it('photo counts: 1, 2, 3, 4', () => {
    expect(IDS.map((id) => slotCount(getLayout(id)))).toEqual(COUNTS);
  });
  it('every pass layout rotates the photos a quarter turn clockwise; no other layout does', () => {
    for (const l of LAYOUTS) expect(l.photoRotation, l.id).toBe(IDS.includes(l.id) ? 90 : undefined);
    expect(rotatedSize(1920, 1080, 90)).toEqual({ iw: 1080, ih: 1920 });
    expect(rotatedSize(1920, 1080, 0)).toEqual({ iw: 1920, ih: 1080 });
  });
});

describe('layout <-> frame coupling', () => {
  it('pass layouts offer only the NCL frame; ordinary layouts never offer it', () => {
    for (const id of IDS) { expect(framesForLayout(id).map((f) => f.id)).toEqual([PASS_FRAME_ID]); expect(isFrameAllowed('kawaii', id)).toBe(false); }
    for (const l of STANDARD_LAYOUTS) {
      expect(isFrameAllowed(PASS_FRAME_ID, l.id), l.id).toBe(false);
      expect(framesForLayout(l.id).map((f) => f.id)).toEqual(STANDARD_FRAMES.map((f) => f.id)); // the ordinary choices are exactly what they were
    }
  });
  it('choosing a layout keeps an allowed frame and otherwise switches to the layout\'s own', () => {
    expect(frameForLayout('strip-3', 'kawaii')).toBe('kawaii');
    expect(frameForLayout('strip-3', null)).toBe(DEFAULT_FRAME);
    expect(frameForLayout('pass-3', 'kawaii')).toBe(PASS_FRAME_ID);
    expect(frameForLayout('pass-3', null)).toBe(PASS_FRAME_ID);
    expect(frameForLayout('single', PASS_FRAME_ID)).toBe(DEFAULT_FRAME);
  });
});

describe('photo boxes (paper space; the ticket prints sideways, rotated 90° clockwise)', () => {
  const slots = (id: string) => resolveFramed(id, PASS_FRAME_ID).slots;
  it('pass-1..3: ticket-portrait boxes become LANDSCAPE slots stacked top to bottom in ticket order, equal widths', () => {
    for (const id of ['pass-1', 'pass-2', 'pass-3']) {
      const s = slots(id);
      s.forEach((r, i) => { expect(r.w, `${id}#${i}`).toBeGreaterThan(r.h); if (i) expect(r.y).toBeGreaterThan(s[i - 1].y + s[i - 1].h); });
      expect(new Set(s.map((r) => r.x)).size).toBe(1);
    }
  });
  it('pass-4: ticket-landscape boxes become PORTRAIT slots, ordered along the roll', () => {
    const s = slots('pass-4');
    expect(s).toHaveLength(4);
    s.forEach((r, i) => { expect(r.h).toBeGreaterThan(r.w); if (i) expect(r.y).toBeGreaterThan(s[i - 1].y + s[i - 1].h); });
  });
  it('all slots are on the canvas and never overlap', () => {
    for (const id of IDS) {
      const L = resolveFramed(id, PASS_FRAME_ID);
      L.slots.forEach((a, i) => {
        expect(a.x).toBeGreaterThanOrEqual(0); expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.x + a.w).toBeLessThanOrEqual(L.width); expect(a.y + a.h).toBeLessThanOrEqual(L.height);
        L.slots.slice(i + 1).forEach((b) => expect(a.y + a.h <= b.y || b.y + b.h <= a.y || a.x + a.w <= b.x || b.x + b.w <= a.x).toBe(true));
      });
    }
  });
});

describe('artwork on disk (src/assets/frames/ncl-boarding-pass)', () => {
  const load = async (id: string) => {
    const img = await loadImage(readFileSync(join(process.cwd(), 'src/assets/frames/ncl-boarding-pass', `${id}.png`)));
    const c = createCanvas(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height) };
  };
  it('each PNG is 1152 px wide (3 px per unit) and matches its canvas aspect', async () => {
    for (const id of IDS) {
      const a = await load(id), L = resolveFramed(id, PASS_FRAME_ID);
      expect(a.w).toBe(1152);
      expect(Math.abs(a.w / a.h / (L.width / L.height) - 1), id).toBeLessThan(0.005);
    }
  }, 60000);
  it('the transparent windows are inside the slots and cover almost all of each slot (so photos fill the windows)', async () => {
    for (const id of IDS) {
      const a = await load(id), L = resolveFramed(id, PASS_FRAME_ID), S = a.w / L.width;
      const inSlot = (x: number, y: number) => L.slots.some((r) => x >= r.x * S && x < (r.x + r.w) * S && y >= r.y * S && y < (r.y + r.h) * S);
      let clear = 0, outside = 0;
      for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) if (a.d.data[(y * a.w + x) * 4 + 3] < 40) { clear++; if (!inSlot(x, y)) outside++; }
      const area = L.slots.reduce((t, r) => t + r.w * r.h * S * S, 0);
      expect(outside, `${id}: transparent pixels outside every slot`).toBe(0);
      expect(clear / area, `${id}: window / slot area`).toBeGreaterThan(0.85);
    }
  }, 60000);
  it('the QR safe area is flat paper in every pass layout (nothing drawn in it)', async () => {
    for (const id of IDS) {
      const a = await load(id), q = qrAreaFor(getFrame(PASS_FRAME_ID), id)!.safeArea;
      expect(regionIsClear(a.d, { x: q.x * a.w, y: q.y * a.h, w: q.w * a.w, h: q.h * a.h }), id).toBe(true);
    }
  }, 60000);
});

describe('plan, info block and QR', () => {
  const snapOf = (id: string) => buildSnapshot(id, photos, PASS_FRAME_ID);
  it('one photo object per box, using the pass frame', () => {
    IDS.forEach((id, i) => { const s = snapOf(id); expect(s.objects.filter((o) => o.type === 'photo')).toHaveLength(COUNTS[i]); expect(s.frameId).toBe(PASS_FRAME_ID); });
  });
  it('draws the artwork over the photos and adds no info block (all event text is in the art)', () => {
    for (const id of IDS) {
      const p = buildPlan(snapOf(id), ctx, 576);
      expect(p.cmds.some((c) => c.op === 'info'), id).toBe(false);
      expect(p.cmds.filter((c) => c.op === 'photo')).toHaveLength(COUNTS[IDS.indexOf(id)]);
      expect(p.cmds.some((c) => c.op === 'image-frame'), id).toBe(true);
      expect(p.unitsH).toBe(resolveFramed(id, PASS_FRAME_ID).height);
    }
  });
  it('80 mm: the real session QR goes into the declared safe area (no strip), verified, for 37 and 41 modules', () => {
    for (const id of IDS) for (const n of [37, 41]) {
      const p = buildPlan(snapOf(id), ctx, 576, { matrix: matrixOf(n), paperDots: 576 });
      const q = p.cmds[p.cmds.length - 1];
      expect(q.op, `${id}/${n}`).toBe('qr');
      if (q.op !== 'qr') return;
      expect(q.mode).toBe('safe-area');
      expect(p.unitsH).toBe(resolveFramed(id, PASS_FRAME_ID).height);
      expect(q.rect.w).toBeGreaterThanOrEqual(qrMinSide(n, undefined, 576));
      expect(verifyPlanQr(p).ok).toBe(true);
    }
  });
  it('58 mm (the default roll): the real session QR (37 modules, and 41 for a longer URL) goes into the safe area, verified', () => {
    for (const id of IDS) for (const n of [37, 41]) {
      const p = buildPlan(snapOf(id), ctx, 384, { matrix: matrixOf(n), paperDots: 384 });
      const q = p.cmds[p.cmds.length - 1];
      expect(q.op, `${id}/${n}`).toBe('qr');
      if (q.op !== 'qr') return;
      expect(q.mode).toBe('safe-area');
      expect(q.rect.w).toBeGreaterThanOrEqual(qrMinSide(n, undefined, 384));
      expect(verifyPlanQr(p).ok).toBe(true);
    }
  });
  it('a QR that cannot fit even in the enlarged stub is still refused (export blocked, never drawn over ink)', () => {
    for (const id of IDS) expect(() => buildPlan(snapOf(id), ctx, 384, { matrix: matrixOf(121), paperDots: 384 }), id).toThrow();
  });
  it('the QR safe area is at least 104 units square (41 modules at 2 dots/module on 58 mm) in every pass', () => {
    for (const id of IDS) {
      const L = resolveFramed(id, PASS_FRAME_ID), q = qrAreaFor(getFrame(PASS_FRAME_ID), id)!.safeArea;
      expect(Math.min(q.w * L.width, q.h * L.height), id).toBeGreaterThanOrEqual(qrMinSide(41, undefined, 384) + 6);
    }
  });
});

describe('3:4 photo boxes', () => {
  const slots = (id: string) => resolveFramed(id, PASS_FRAME_ID).slots;
  it('every box on pass-1..3 is 3:4 portrait on the ticket (paper slot 4:3 landscape, within 1 unit), and all of them have the same size', () => {
    const sizes = new Set<string>();
    for (const id of ['pass-1', 'pass-2', 'pass-3']) for (const r of slots(id)) {
      expect(Math.abs(r.w - (4 / 3) * r.h), `${id} slot ${r.w}x${r.h}`).toBeLessThanOrEqual(1);
      sizes.add(`${r.w}x${r.h}`);
    }
    expect(sizes.size).toBe(1);
  });
  it('pass-4 boxes are unchanged (four landscape boxes, portrait on paper)', () => {
    expect(slots('pass-4').map((r) => [r.x, r.y, r.w, r.h])).toEqual([[160, 20, 126, 165], [160, 192, 126, 163], [160, 363, 126, 161], [160, 532, 126, 152]]);
  });
});
