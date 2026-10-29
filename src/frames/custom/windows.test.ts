// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { detectWindows, sortReadingOrder } from './windows';
import { makeArt, SINGLE, STRIP, GRID, W, heightFor } from './fixtures';

const run = (holes: Parameters<typeof makeArt>[2], h = heightFor(holes), paint?: (g: any) => void) => { const a = makeArt(W, h, holes, paint); return detectWindows(a.data, a.width, a.height); };

describe('detectWindows', () => {
  it('finds one window with an exact bounding box', () => {
    const r = run(SINGLE);
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0]).toMatchObject({ x: 96, y: 160, w: 960, h: 1200, fill: 1 });
  });
  it.each([2, 3, 4])('finds %i strip windows top to bottom', (n) => {
    const r = run(STRIP(n));
    expect(r.windows).toHaveLength(n);
    expect(r.windows.map((w) => w.y)).toEqual(STRIP(n).map((h) => h.y));
  });
  it('orders a 2x2 grid row by row, left to right', () => {
    const r = run(GRID);
    expect(r.windows.map((w) => [w.x, w.y])).toEqual([[96, 160], [600, 160], [96, 664], [600, 664]]);
  });
  it('reads a row left to right even when its windows differ a little in height or top', () => {
    const r = run([{ x: 600, y: 170, w: 456, h: 440 }, { x: 96, y: 160, w: 456, h: 456 }, { x: 96, y: 700, w: 456, h: 400 }]);
    expect(r.windows.map((w) => w.x)).toEqual([96, 600, 96]);
  });
  it('sortReadingOrder separates rows that do not overlap enough', () => {
    const a = { x: 0, y: 0, w: 10, h: 100 }, b = { x: 20, y: 90, w: 10, h: 100 };
    expect(sortReadingOrder([b, a])).toEqual([a, b]);
  });
  it('accepts small rounded corners with fill below 1 but above 0.97', () => {
    const r = run([{ x: 96, y: 160, w: 960, h: 1200, round: 30 }]);
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0].fill).toBeLessThan(1);
    expect(r.windows[0].fill).toBeGreaterThan(0.97);
  });
  it('reports a non-rectangular hole with a low fill ratio (an ellipse)', () => {
    const r = run([{ x: 96, y: 160, w: 960, h: 1200, round: 480 }]);
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0].fill).toBeLessThan(0.9);
  });
  it('ignores tiny stray holes and thin slivers and counts them', () => {
    const r = run([...STRIP(2), { x: 40, y: 60, w: 6, h: 6 }, { x: 300, y: 1300, w: 12, h: 12 }, { x: 76, y: 1230, w: 1000, h: 8 }], 1600);
    expect(r.windows).toHaveLength(2);
    expect(r.ignored.tiny).toBe(2);
    expect(r.ignored.thin).toBe(1);
  });
  it('ignores transparency that touches the image edge', () => {
    const r = run([...SINGLE, { x: 0, y: 0, w: 300, h: 100 }, { x: 1000, y: 1500, w: 152, h: 100 }], 1700);
    expect(r.windows).toHaveLength(1);
    expect(r.ignored.edge).toBe(2);
  });
  it('finds nothing in a fully opaque image', () => {
    const r = run([], 1700);
    expect(r.windows).toHaveLength(0);
    expect(r.ignored).toEqual({ edge: 0, tiny: 0, thin: 0 });
  });
  it('treats nearly transparent pixels (alpha below the threshold) as window, semi transparent as art', () => {
    const faint = run([], 1500, (g) => { g.clearRect(100, 100, 900, 600); });
    expect(faint.windows).toHaveLength(1);
    const half = makeArt(W, 1500, [], (g) => { g.clearRect(100, 100, 900, 600); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(100, 100, 900, 600); });
    expect(detectWindows(half.data, W, 1500).windows).toHaveLength(0);
  });
  it('a window with an opaque island inside is not a plain rectangle', () => {
    const r = run(SINGLE, undefined, (g) => { g.fillStyle = '#000'; g.fillRect(300, 400, 500, 500); });
    expect(r.windows[0].fill).toBeLessThan(0.8);
  });
  it('handles a large image quickly', () => {
    const t = Date.now(), a = makeArt(2304, 6000, [{ x: 100, y: 100, w: 2000, h: 5000 }]);
    const r = detectWindows(a.data, a.width, a.height);
    expect(r.windows).toHaveLength(1);
    expect(Date.now() - t).toBeLessThan(5000);
  });
  it('rejects a buffer that is too small', () => {
    expect(() => detectWindows(new Uint8Array(10), 100, 100)).toThrow();
  });
});
