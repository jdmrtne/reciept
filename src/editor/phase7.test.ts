import { describe, expect, it } from 'vitest';
import { applyCarry, buildSnapshot, clampCrop, commit, newEditor, redo, resetEditor, swapPhotos, undo, withFilter, withFrame, keepStickers, addSticker } from './model';
import { isPhoto, isSticker, type PhotoObject } from './types';
import { FILTERS, applyFilter, filterMatrix, getFilter } from '../filters/registry';

const photos = [
  { src: 'a', iw: 1280, ih: 720 }, { src: 'b', iw: 1280, ih: 720 }, { src: 'c', iw: 1000, ih: 1000 }, { src: 'd', iw: 1280, ih: 720 }
];
const px = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 200]);

describe('filters', () => {
  it('has the five required filters with unique ids', () => {
    expect(FILTERS.map((f) => f.id)).toEqual(['original', 'grayscale', 'high-contrast', 'vintage', 'soft']);
  });
  it('original is a no-op and unknown ids fall back to original', () => {
    const d = px(10, 120, 250); applyFilter(d, 'original'); expect([...d]).toEqual([10, 120, 250, 200]);
    expect(getFilter('nope').id).toBe('original');
  });
  it('grayscale gives equal channels using Rec.601 luma, alpha untouched', () => {
    const d = px(200, 100, 50); applyFilter(d, 'grayscale');
    const y = Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50);
    expect(d[0]).toBe(y); expect(d[1]).toBe(y); expect(d[2]).toBe(y); expect(d[3]).toBe(200);
  });
  it('high contrast pushes darks darker and lights lighter', () => {
    const dark = px(90, 90, 90), light = px(170, 170, 170);
    applyFilter(dark, 'high-contrast'); applyFilter(light, 'high-contrast');
    expect(dark[0]).toBeLessThan(90); expect(light[0]).toBeGreaterThan(170);
  });
  it('soft lowers contrast (range compresses) and vintage lifts blacks', () => {
    const black = px(0, 0, 0), white = px(255, 255, 255);
    applyFilter(black, 'soft'); applyFilter(white, 'soft');
    expect(black[0]).toBeGreaterThan(0); expect(white[0]).toBeLessThanOrEqual(255);
    expect(white[0] - black[0]).toBeLessThan(255); // range compressed
    const vb = px(0, 0, 0); applyFilter(vb, 'vintage'); expect(vb[0]).toBeGreaterThan(10);
  });
  it('vintage is warm (R >= G >= B on neutral gray)', () => {
    const d = px(128, 128, 128); applyFilter(d, 'vintage');
    expect(d[0]).toBeGreaterThanOrEqual(d[1]); expect(d[1]).toBeGreaterThanOrEqual(d[2]);
  });
  it('matrices are 20 finite numbers, alpha row is identity', () => {
    for (const f of FILTERS) {
      const m = filterMatrix(f.params);
      expect(m).toHaveLength(20); expect(m.every(Number.isFinite)).toBe(true);
      expect(m.slice(15)).toEqual([0, 0, 0, 1, 0]);
    }
  });
});

describe('filter in snapshot + history', () => {
  const base = () => newEditor(buildSnapshot('strip-3', photos));
  it('defaults to original and normalises unknown ids', () => {
    expect(base().present.filterId).toBe('original');
    expect(buildSnapshot('strip-3', photos, undefined, 'bogus').filterId).toBe('original');
  });
  it('is undoable / redoable / resettable and never mutates photo sources', () => {
    let e = base();
    const before = JSON.stringify(e.present.objects);
    e = commit(e, withFilter(e.present, 'high-contrast'));
    expect(e.present.filterId).toBe('high-contrast');
    expect(JSON.stringify(e.present.objects)).toBe(before);
    e = undo(e); expect(e.present.filterId).toBe('original');
    e = redo(e); expect(e.present.filterId).toBe('high-contrast');
    e = resetEditor(e); expect(e.present.filterId).toBe('original');
    e = undo(e); expect(e.present.filterId).toBe('high-contrast');
  });
  it('survives frame and layout changes', () => {
    const s = withFilter(buildSnapshot('strip-3', photos), 'vintage');
    expect(withFrame(s, 'retro-receipt').filterId).toBe('vintage');
    const next = keepStickers(s, buildSnapshot('grid-2x2', photos, s.frameId, s.filterId));
    expect(next.filterId).toBe('vintage');
  });
});

describe('swapPhotos', () => {
  const s = buildSnapshot('strip-3', photos);
  const ph = (x: typeof s) => x.objects.filter(isPhoto);
  it('exchanges sources, keeps slot geometry and layers', () => {
    const r = swapPhotos(s, 'photo-0', 'photo-2');
    const [a0, , c0] = ph(s), [a1, , c1] = ph(r);
    expect(a1.src).toBe(c0.src); expect(c1.src).toBe(a0.src);
    expect([a1.x, a1.y, a1.w, a1.h, a1.layer]).toEqual([a0.x, a0.y, a0.w, a0.h, a0.layer]);
    expect([a1.iw, a1.ih]).toEqual([1000, 1000]); // source dimensions travel with the photo
    expect([c1.iw, c1.ih]).toEqual([1280, 720]);
  });
  it('swapping twice restores the original', () => {
    expect(ph(swapPhotos(swapPhotos(s, 'photo-0', 'photo-1'), 'photo-0', 'photo-1')).map((p) => p.src)).toEqual(ph(s).map((p) => p.src));
  });
  it('carries the crop with the photo and keeps it valid for the new slot', () => {
    const z = { ...s, objects: s.objects.map((o) => (o.id === 'photo-0' ? { ...(o as PhotoObject), crop: { zoom: 2, ox: 30, oy: 0 } } : o)) };
    const r = swapPhotos(z, 'photo-0', 'photo-2');
    const moved = ph(r)[2];
    expect(moved.src).toBe('a');
    expect(moved.crop.zoom).toBe(2);
    expect(moved.crop).toEqual(clampCrop(moved, moved.crop));
  });
  it('is a no-op for same id, unknown ids and stickers', () => {
    expect(swapPhotos(s, 'photo-0', 'photo-0')).toBe(s);
    expect(swapPhotos(s, 'photo-0', 'nope')).toBe(s);
    const { snap, id } = addSticker(s, 'star-1', 384, 600);
    expect(swapPhotos(snap, 'photo-0', id)).toBe(snap);
  });
  it('can be undone', () => {
    let e = newEditor(s);
    e = commit(e, swapPhotos(e.present, 'photo-0', 'photo-1'));
    expect(ph(undo(e).present).map((p) => p.src)).toEqual(ph(s).map((p) => p.src));
  });
});

describe('applyCarry (retake from editor)', () => {
  it('restores stickers and filter onto a rebuilt snapshot, clamped to the canvas', () => {
    const old = addSticker(withFilter(buildSnapshot('strip-3', photos), 'soft'), 'star-1', 384, 600).snap;
    const carry = { stickers: old.objects.filter(isSticker), filterId: old.filterId };
    const rebuilt = applyCarry(buildSnapshot('strip-3', photos.map((p) => ({ ...p, src: p.src + '2' }))), carry);
    expect(rebuilt.filterId).toBe('soft');
    expect(rebuilt.objects.filter(isSticker)).toHaveLength(1);
    expect(rebuilt.objects.filter(isPhoto).every((p) => p.src.endsWith('2'))).toBe(true);
  });
});
