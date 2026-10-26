// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { CUSTOM_LAYOUT_IDS, LIMITS, inspectImageHeader, requiredWindows, validateArtwork, validateUpload, windowToSlot } from './validate';
import { resolveLayout } from '../../layouts/engine';
import { getLayout } from '../../layouts/registry';
import { makeArt, SINGLE, STRIP, GRID, W, heightFor } from './fixtures';

const sets = { single: SINGLE, 'strip-2': STRIP(2), 'strip-3': STRIP(3), 'strip-4': STRIP(4), 'grid-2x2': GRID, classic: STRIP(4) } as const;
const art = (id: keyof typeof sets) => makeArt(W, heightFor(sets[id]), sets[id] as any);

describe('layout ids and window counts', () => {
  it('covers exactly the six ordinary layouts', () => expect(CUSTOM_LAYOUT_IDS).toEqual(['single', 'strip-2', 'strip-3', 'strip-4', 'grid-2x2', 'classic']));
  it('needs as many windows as the layout has photos', () => expect(CUSTOM_LAYOUT_IDS.map(requiredWindows)).toEqual([1, 2, 3, 4, 4, 4]));
});

describe('validateArtwork', () => {
  it.each(CUSTOM_LAYOUT_IDS)('accepts a good %s', (id) => {
    const a = art(id), r = validateArtwork(id, a);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.slots).toHaveLength(requiredWindows(id)); expect(r.value.heightRatio).toBeCloseTo(a.height / a.width, 9); }
  });
  it('slots feed the existing manual arrangement and land on the window (within the bleed)', () => {
    const a = art('strip-3'), r = validateArtwork('strip-3', a);
    if (!r.ok) throw new Error(r.errors.join());
    const L = resolveLayout({ ...getLayout('strip-3'), arrangement: { kind: 'manual', heightRatio: r.value.heightRatio, slots: r.value.slots } }, 1152);
    expect(L.height).toBe(a.height);
    r.value.windows.forEach((w, i) => {
      expect(L.slots[i].x).toBe(Math.max(0, w.x - LIMITS.bleedPx));
      expect(L.slots[i].y).toBe(w.y - LIMITS.bleedPx);
      expect(L.slots[i].w).toBe(w.w + 2 * LIMITS.bleedPx);
      expect(L.slots[i].h).toBe(w.h + 2 * LIMITS.bleedPx);
    });
  });
  it('rejects too few windows with a clear message', () => {
    const r = validateArtwork('strip-3', art('strip-2'));
    expect(r).toEqual({ ok: false, errors: ['strip-3 needs 3 windows, found 2.'] });
  });
  it('rejects too many windows', () => {
    const r = validateArtwork('strip-2', art('strip-3'));
    expect(!r.ok && r.errors[0]).toBe('strip-2 needs 2 windows, found 3.');
  });
  it('explains a fully opaque window (no see-through area)', () => {
    const r = validateArtwork('single', makeArt(W, 1700, []));
    expect(!r.ok && r.errors[0]).toMatch(/single needs 1 window, found 0\. The image has no see-through area/);
  });
  it('explains edge touching transparency', () => {
    const r = validateArtwork('single', makeArt(W, 1700, [{ x: 0, y: 160, w: 500, h: 1200 }]));
    expect(!r.ok && r.errors[0]).toMatch(/touches the edge of the image and is ignored/);
  });
  it('rejects a non-rectangular hole, naming the window', () => {
    const r = validateArtwork('single', makeArt(W, 1700, [{ x: 96, y: 160, w: 960, h: 1200, round: 480 }]));
    expect(!r.ok && r.errors.join(' ')).toMatch(/Window 1 is not a plain rectangle/);
  });
  it('ignores tiny stray holes when the real windows are right', () => {
    const r = validateArtwork('strip-2', makeArt(W, 1500, [...STRIP(2), { x: 30, y: 30, w: 8, h: 8 }, { x: 700, y: 1250, w: 10, h: 10 }]));
    expect(r.ok).toBe(true);
  });
  it('rejects windows that are too close together', () => {
    const r = validateArtwork('strip-2', makeArt(W, 1300, [{ x: 120, y: 120, w: 912, h: 480 }, { x: 120, y: 604, w: 912, h: 480 }]));
    expect(!r.ok && r.errors[0]).toMatch(/Windows 1 and 2 touch or overlap/);
  });
  it('rejects a layout that cannot take a custom frame', () => {
    const r = validateArtwork('pass-1', art('single'));
    expect(!r.ok && r.errors[0]).toBe('pass-1 cannot use a custom frame.');
  });
  it('error text has no dashes or emojis', () => {
    const msgs = [validateArtwork('strip-3', art('strip-2')), validateArtwork('single', makeArt(W, 1700, [])), validateUpload({ size: 0 }, new Uint8Array())];
    for (const m of msgs) if (!m.ok) for (const e of m.errors) { expect(e).not.toMatch(/[\u2012-\u2015]/); expect(e).not.toMatch(/\p{Extended_Pictographic}/u); }
  });
});

describe('windowToSlot', () => {
  it('clamps the bleed to the image', () => expect(windowToSlot({ x: 1, y: 1, w: 10, h: 10 }, 100, 100)).toEqual({ x: 0, y: 0, w: 0.14, h: 0.14 }));
});

describe('header and upload checks', () => {
  const png = (w: number, h: number) => createCanvas(w, h).toBuffer('image/png');
  const webp = (w: number, h: number) => createCanvas(w, h).toBuffer('image/webp');
  const head = (b: Buffer) => new Uint8Array(b.subarray(0, 64));
  it('reads PNG and WebP sizes without decoding', () => {
    expect(inspectImageHeader(head(png(1152, 2000)))).toMatchObject({ format: 'png', width: 1152, height: 2000 });
    expect(inspectImageHeader(head(webp(1152, 2000)))).toMatchObject({ format: 'webp', width: 1152, height: 2000 });
  });
  it('rejects non images, jpeg and svg by their bytes, not their name', () => {
    expect(inspectImageHeader(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(64)))).toBeNull();
    expect(inspectImageHeader(head(createCanvas(10, 10).toBuffer('image/jpeg')))).toBeNull();
    const r = validateUpload({ size: 5000, type: 'image/png' }, new TextEncoder().encode('GIF89a'.padEnd(64)));
    expect(!r.ok && r.errors[0]).toMatch(/not a PNG or WebP/);
  });
  it('accepts a normal PNG', () => {
    const b = png(1152, 2800), r = validateUpload({ size: b.length, type: 'image/png' }, head(b));
    expect(r.ok && r.warnings).toEqual([]);
  });
  it('rejects an empty or oversized file', () => {
    expect(validateUpload({ size: 0 }, new Uint8Array())).toMatchObject({ ok: false });
    const r = validateUpload({ size: LIMITS.maxFileBytes + 1 }, head(png(1152, 2000)));
    expect(!r.ok && r.errors[0]).toMatch(/limit is 8 MB/);
  });
  it('rejects widths outside the range and warns for other widths', () => {
    expect(validateUpload({ size: 1000 }, head(png(500, 1000)))).toMatchObject({ ok: false });
    expect(validateUpload({ size: 1000 }, head(png(3000, 4000)))).toMatchObject({ ok: false });
    const r = validateUpload({ size: 1000 }, head(png(768, 1500)));
    expect(r.ok && r.warnings[0]).toMatch(/1152 px is recommended/);
  });
  it('rejects odd height ratios and too many pixels', () => {
    expect(validateUpload({ size: 1000 }, head(png(1152, 300)))).toMatchObject({ ok: false });
    expect(validateUpload({ size: 1000 }, head(png(1152, 6000)))).toMatchObject({ ok: false });
    expect(validateUpload({ size: 1000 }, head(png(2304, 7000)))).toMatchObject({ ok: false });
  });
  it('warns when the declared type lies', () => {
    const b = png(1152, 2000), r = validateUpload({ size: b.length, type: 'image/jpeg' }, head(b));
    expect(r.ok && r.warnings[0]).toMatch(/really a PNG/);
  });
});
