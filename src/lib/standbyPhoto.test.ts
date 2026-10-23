import { describe, expect, it } from 'vitest';
import { GIF_MAX_BYTES, fitSize, isGif, loadStandbyPhoto, removeStandbyPhoto, resizePhoto, storeStandbyPhoto } from './standbyPhoto';

describe('fitSize', () => {
  it('shrinks the long edge to the limit and keeps the ratio', () => {
    expect(fitSize(4000, 3000, 1920)).toEqual({ w: 1920, h: 1440 });
    expect(fitSize(3000, 4000, 1920)).toEqual({ w: 1440, h: 1920 });
  });
  it('never upscales', () => {
    expect(fitSize(800, 600, 1920)).toEqual({ w: 800, h: 600 });
  });
  it('never returns a zero-sized side', () => {
    expect(fitSize(20000, 1, 1920)).toEqual({ w: 1920, h: 1 });
  });
});

describe('fail-safe store (no browser APIs here)', () => {
  it('rejects a non-image file as unsupported', async () => {
    expect(await resizePhoto(new Blob(['hello'], { type: 'text/plain' }))).toEqual({ ok: false, reason: 'unsupported' });
    expect(await storeStandbyPhoto(new Blob(['hello'], { type: 'application/pdf' }))).toEqual({ ok: false, reason: 'unsupported' });
  });
  it('reports a corrupt image as unreadable instead of throwing', async () => {
    const r = await resizePhoto(new Blob(['not really a jpeg'], { type: 'image/jpeg' }));
    expect(r.ok).toBe(false);
  });
  it('load and remove resolve quietly when there is no IndexedDB or localStorage', async () => {
    expect(await loadStandbyPhoto()).toBeNull();
    await expect(removeStandbyPhoto()).resolves.toBeUndefined();
  });
});

describe('GIF standby', () => {
  const gifBytes = () => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
  it('recognises a GIF by type or by signature', async () => {
    expect(await isGif(new Blob([gifBytes()], { type: 'image/gif' }))).toBe(true);
    expect(await isGif(new Blob([gifBytes()]))).toBe(true);
    expect(await isGif(new Blob([gifBytes()], { type: 'image/png' }))).toBe(true);
    expect(await isGif(new Blob(['hello'], { type: 'image/png' }))).toBe(false);
    expect(await isGif(new Blob([gifBytes()], { type: 'application/pdf' }))).toBe(false);
  });
  it('rejects a GIF over the size limit instead of storing it', async () => {
    const big = new Blob([new Uint8Array(GIF_MAX_BYTES + 1)], { type: 'image/gif' });
    expect(await storeStandbyPhoto(big)).toEqual({ ok: false, reason: 'too-large' });
  });
  it('does not pass a GIF through the JPEG resizer (no canvas needed)', async () => {
    // With no IndexedDB/localStorage here the store fails with "storage", not "unreadable": proof the resizer was skipped.
    const r = await storeStandbyPhoto(new Blob([gifBytes()], { type: 'image/gif' }));
    expect(r).toEqual({ ok: false, reason: 'storage' });
  });
});
