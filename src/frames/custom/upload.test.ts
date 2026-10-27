// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { makeArt, GRID, heightFor, SINGLE, STRIP, W } from './fixtures';
import { prepareUpload, type DecodeFn } from './upload';
import { requiredWindows } from './validate';

const blobOf = (png: Uint8Array, type = 'image/png') => new Blob([png], { type });
const decoderFor = (f: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): DecodeFn => async () => f;
const noDash = (m: string) => !/[\u2013\u2014]/.test(m) && !/\p{Extended_Pictographic}/u.test(m);

describe('prepareUpload (Phase 4)', () => {
  it('accepts a good strip-3 picture and returns art ready for the store', async () => {
    const f = makeArt(W, heightFor(STRIP(3)), STRIP(3));
    const r = await prepareUpload('strip-3', blobOf(f.png), decoderFor(f));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.art.windows).toHaveLength(3);
    expect(r.art.slots).toHaveLength(3);
    expect(r.art.mime).toBe('image/png');
    expect(r.art.blob.size).toBe(f.png.length);
    expect(r.warnings).toEqual([]);
  });

  it('works for every layout with the right window count', async () => {
    const sets: Record<string, ReturnType<typeof STRIP>> = { single: SINGLE, 'strip-2': STRIP(2), 'strip-3': STRIP(3), 'strip-4': STRIP(4), 'grid-2x2': GRID, classic: STRIP(4) };
    for (const [id, holes] of Object.entries(sets)) {
      const f = makeArt(W, heightFor(holes), holes);
      const r = await prepareUpload(id, blobOf(f.png), decoderFor(f));
      expect(r.ok, id).toBe(true);
      if (r.ok) expect(r.art.windows).toHaveLength(requiredWindows(id));
    }
  });

  it('says how many windows were found when the count is wrong', async () => {
    const f = makeArt(W, heightFor(STRIP(2)), STRIP(2));
    const r = await prepareUpload('strip-3', blobOf(f.png), decoderFor(f));
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.errors.join(' ')).toMatch(/strip-3 needs 3 windows, found 2/i); r.errors.forEach((m) => expect(noDash(m), m).toBe(true)); }
  });

  it('refuses before decoding when the file is not a PNG or WebP (the decoder is never called)', async () => {
    let called = false;
    const r = await prepareUpload('single', blobOf(new TextEncoder().encode('GIF89a not a png at all, just text padding...............'), 'image/png'), async () => { called = true; throw new Error('no'); });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('refuses an empty file and an unknown layout', async () => {
    expect((await prepareUpload('single', new Blob([], { type: 'image/png' }))).ok).toBe(false);
    const f = makeArt(W, heightFor(SINGLE), SINGLE);
    const r = await prepareUpload('pass-1', blobOf(f.png), decoderFor(f));
    expect(r).toEqual({ ok: false, errors: ['This layout cannot have a custom frame.'] });
  });

  it('turns a decoder failure into a plain sentence instead of throwing', async () => {
    const f = makeArt(W, heightFor(SINGLE), SINGLE);
    const r = await prepareUpload('single', blobOf(f.png), async () => { throw new Error('boom'); });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/could not be opened/);
  });

  it('rejects a decode whose size disagrees with the file header', async () => {
    const f = makeArt(W, heightFor(SINGLE), SINGLE);
    const r = await prepareUpload('single', blobOf(f.png), async () => ({ width: W, height: 10, data: new Uint8ClampedArray(W * 40) }));
    expect(r.ok).toBe(false);
  });

  it('warns, but still accepts, a width other than 1152', async () => {
    const f = makeArt(768, 1400, [{ x: 64, y: 100, w: 640, h: 800 }]);
    const r = await prepareUpload('single', blobOf(f.png), decoderFor(f));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.warnings.length).toBeGreaterThan(0); r.warnings.forEach((m) => expect(noDash(m), m).toBe(true)); }
  });

  it('stores the blob with the type the bytes really are, whatever the picker declared', async () => {
    const f = makeArt(W, heightFor(SINGLE), SINGLE);
    const r = await prepareUpload('single', blobOf(f.png, ''), decoderFor(f));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.art.blob.type).toBe('image/png');
  });
});
