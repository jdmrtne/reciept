import { describe, expect, it } from 'vitest';
import { collisions, inflate, occupiedRegions, overlaps, placeQr, primRegions, qrAreaFor, qrMinSide, regionIsClear, rotatedBounds, canPlaceQr, type OccupancyInput } from './placement';
import { FRAMES, isImageFrame, resolveFramed } from '../frames/registry';
import { LAYOUTS } from '../layouts/registry';
import { framePrims, makeCtx } from '../frames/prims';
import { vectorFrameOf, getFrame } from '../frames/registry';
import type { FrameDef } from '../frames/types';

const ctx = makeCtx('PHOTOBOOTH', new Date(2026, 9, 2, 13, 35));
const MODULES = 37; // a typical /p/<sessionId> QR (version 5-ish)

/** What the renderer would see for one frame × layout, with optional stickers. */
function occ(frame: FrameDef, layoutId: string, stickers: OccupancyInput['stickers'] = []): OccupancyInput {
  const L = resolveFramed(layoutId, frame.id), art = isImageFrame(frame);
  return { width: L.width, height: L.height, slots: L.slots, stickers, prims: art ? [] : framePrims(vectorFrameOf(frame), L, ctx), artwork: art };
}

describe('geometry', () => {
  it('touching edges do not overlap; any shared interior does', () => {
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 0, w: 5, h: 5 })).toBe(true);
  });
  it('a rotated sticker is bounded by its rotated corners', () => {
    const r = rotatedBounds({ x: 0, y: 0, w: 100, h: 20, rotation: 90 });
    expect(Math.round(r.w)).toBe(20); expect(Math.round(r.h)).toBe(100);
  });
  it('a stroke-only border covers its edges, not its inside', () => {
    const rs = primRegions({ k: 'rect', x: 0, y: 0, w: 384, h: 500, stroke: '#000', sw: 2 }, 384, 500);
    expect(rs.some((r) => overlaps(r, { x: 150, y: 200, w: 20, h: 20 }))).toBe(false);
    expect(rs.some((r) => overlaps(r, { x: 100, y: 0, w: 20, h: 3 }))).toBe(true);
  });
});

describe('occupancy', () => {
  it('every photo slot is occupied even with no photo in it', () => {
    const f = getFrame('minimal-receipt'), o = occ(f, 'strip-3');
    const kinds = occupiedRegions(o).filter((r) => r.kind === 'photo');
    expect(kinds).toHaveLength(3);
  });
  it('text, ornaments and decorations drawn by the frame are occupied', () => {
    const f = getFrame('retro-receipt'), o = occ(f, 'single');
    const frameRegions = occupiedRegions(o).filter((r) => r.kind === 'frame');
    expect(frameRegions.length).toBeGreaterThan(5);
  });
});

describe('strip placement (default, every frame): centered below the design, nothing is covered or moved', () => {
  for (const f of FRAMES) for (const l of LAYOUTS) for (const paperDots of [384, 576]) {
    it(`${f.id} × ${l.id} (${paperDots} dots)`, () => {
      const o = occ(f, l.id), p = placeQr({ modules: MODULES, occ: o, paperDots });
      expect(p.ok).toBe(true);
      if (!p.ok) return;
      expect(p.mode).toBe('strip');
      expect(p.rect.x + p.rect.w / 2).toBeCloseTo(o.width / 2, 0); // centered horizontally
      expect(collisions(p.rect, occupiedRegions(o), p.margin)).toHaveLength(0);
      expect(p.rect.y).toBeGreaterThanOrEqual(o.height + p.margin); // entirely below the design
      expect(p.rect.x).toBeGreaterThanOrEqual(0); expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(o.width);
      expect(p.rect.w).toBeGreaterThanOrEqual(qrMinSide(MODULES, undefined, paperDots, o.width));
      expect(p.canvasHeight).toBeGreaterThan(p.rect.y + p.rect.h);
    });
  }
  it('straw-hat-wanted gets the same centered strip as every other frame', () => {
    const o = occ(getFrame('straw-hat-wanted'), 'single'), p = placeQr({ modules: MODULES, occ: o });
    expect(p.ok && p.mode).toBe('strip');
    if (p.ok) expect(p.rect.x + p.rect.w / 2).toBeCloseTo(o.width / 2, 0);
  });
  it('a sticker hanging off the bottom edge pushes the strip down instead of being covered', () => {
    const f = getFrame('classic-receipt'), L = resolveFramed('single', f.id);
    const s = { x: 100, y: L.height - 20, w: 120, h: 120, rotation: 30 };
    const o = occ(f, 'single', [s]), p = placeQr({ modules: MODULES, occ: o });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const bottom = rotatedBounds(s); expect(p.rect.y).toBeGreaterThanOrEqual(bottom.y + bottom.h + p.margin);
    expect(collisions(p.rect, occupiedRegions(o), p.margin)).toHaveLength(0);
  });
  it('is refused (never forced onto the design) when the strip is not allowed and the frame has no safe area', () => {
    const p = placeQr({ modules: MODULES, occ: occ(getFrame('classic-receipt'), 'single'), allowStrip: false });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toBe('no-safe-area');
  });
});

describe('declared safe area', () => {
  const f = getFrame('minimal-receipt'), base = occ(f, 'single');
  // Free band between the last photo slot and the footer text.
  const slot = base.slots[0], footerTop = base.height - 44;
  const gap = footerTop - (slot.y + slot.h);
  it('has a free band to test with', () => expect(gap).toBeGreaterThan(0));

  it('rejects a safe area that overlaps a photo slot, and reports what it hit', () => {
    const p = placeQr({ modules: MODULES, occ: base, area: { safeArea: { x: 0.6, y: 0.3, w: 0.35, h: 0.3 } } });
    expect(p.ok).toBe(false);
    if (!p.ok) { expect(p.reason).toBe('overlap'); expect(p.hits.some((h) => h.kind === 'photo')).toBe(true); }
  });
  it('rejects an area too small for a scannable QR (no silent shrink below the minimum)', () => {
    const p = placeQr({ modules: MODULES, occ: base, area: { safeArea: { x: 0.8, y: 0.01, w: 0.1, h: 0.05 } } });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toBe('too-small');
  });
  it('rejects an area outside the canvas', () => {
    const p = placeQr({ modules: MODULES, occ: base, area: { safeArea: { x: 0.9, y: 0.9, w: 0.3, h: 0.3 } } });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toBe('out-of-bounds');
  });
  it('places inside a genuinely empty area, bottom-right first, with its margin kept', () => {
    // Artwork frame: only photos/stickers are known geometrically, so an area below the slots is empty.
    const art: OccupancyInput = { ...base, artwork: true, prims: [], height: 600, slots: [{ x: 24, y: 24, w: 336, h: 420 }] };
    const area = { safeArea: { x: 0.55, y: 0.76, w: 0.4, h: 0.22 }, size: 0.2 };
    const p = placeQr({ modules: MODULES, occ: art, area });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.mode).toBe('safe-area');
    expect(collisions(p.rect, occupiedRegions(art), p.margin)).toHaveLength(0);
    expect(p.canvasHeight).toBe(600); // nothing grew, nothing moved
    const a = { x: 0.55 * 384, y: 0.76 * 600, w: 0.4 * 384, h: 0.22 * 600 };
    expect(p.rect.x).toBeGreaterThanOrEqual(a.x); expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(a.x + a.w);
    expect(p.rect.y).toBeGreaterThanOrEqual(a.y); expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(a.y + a.h);
  });
  it('a sticker dropped into the safe area blocks it: the QR does not move onto the sticker', () => {
    const art: OccupancyInput = { ...base, artwork: true, prims: [], height: 600, slots: [{ x: 24, y: 24, w: 336, h: 420 }], stickers: [{ x: 200, y: 460, w: 140, h: 120, rotation: 0 }] };
    const p = placeQr({ modules: MODULES, occ: art, area: { safeArea: { x: 0.55, y: 0.76, w: 0.4, h: 0.22 } } });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.hits.some((h) => h.kind === 'sticker')).toBe(true);
  });
  it('qrAreaFor prefers the layout override', () => {
    const a = { safeArea: { x: 0, y: 0, w: 1, h: 1 } }, b = { safeArea: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } };
    expect(qrAreaFor({ qr: { default: a, byLayout: { single: b } } }, 'single')).toBe(b);
    expect(qrAreaFor({ qr: { default: a, byLayout: { single: b } } }, 'strip-2')).toBe(a);
    expect(qrAreaFor({}, 'single')).toBeNull();
  });
});

describe('canPlaceQr (the drag guard)', () => {
  it('refuses a box that touches a photo slot, even a blank one, or leaves the canvas', () => {
    const o = occ(getFrame('minimal-receipt'), 'single');
    expect(canPlaceQr({ x: 100, y: 100, w: 100, h: 100 }, o, { w: o.width, h: o.height }).ok).toBe(false);
    expect(canPlaceQr({ x: -5, y: 0, w: 50, h: 50 }, o, { w: o.width, h: o.height }).ok).toBe(false);
    expect(canPlaceQr({ x: 100, y: o.height + 10, w: 100, h: 100 }, o, { w: o.width, h: o.height + 200 }).ok).toBe(true);
  });
  it('margin matters: a box 2 units from a slot is refused with the default 3-unit margin, accepted with a 1-unit margin', () => {
    const o: OccupancyInput = { width: 384, height: 600, slots: [{ x: 24, y: 24, w: 336, h: 420 }], stickers: [], prims: [], artwork: true };
    const near = { x: 24, y: 446, w: 60, h: 60 }; // 2 units below the slot
    expect(canPlaceQr(near, o, { w: 384, h: 600 }).ok).toBe(false);
    expect(canPlaceQr(near, o, { w: 384, h: 600 }, 1).ok).toBe(true);
  });
});

describe('regionIsClear (pixel backstop)', () => {
  const px = (w: number, h: number, paint: (x: number, y: number) => number[]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = paint(x, y); data.set([r, g, b, 255], (y * w + x) * 4); }
    return { data, width: w, height: h };
  };
  it('flat white and flat colour are clear', () => {
    expect(regionIsClear(px(40, 40, () => [255, 255, 255]), { x: 0, y: 0, w: 40, h: 40 })).toBe(true);
    expect(regionIsClear(px(40, 40, () => [250, 200, 210]), { x: 0, y: 0, w: 40, h: 40 })).toBe(true);
  });
  it('a single dark pixel of artwork is not clear', () => {
    expect(regionIsClear(px(40, 40, (x, y) => (x === 20 && y === 20 ? [0, 0, 0] : [255, 255, 255])), { x: 0, y: 0, w: 40, h: 40 })).toBe(false);
  });
  it('an empty region is never reported clear', () => expect(regionIsClear(px(4, 4, () => [255, 255, 255]), { x: 10, y: 10, w: 5, h: 5 })).toBe(false));
  it('inflate grows every side', () => expect(inflate({ x: 5, y: 5, w: 10, h: 10 }, 2)).toEqual({ x: 3, y: 3, w: 14, h: 14 }));
});
