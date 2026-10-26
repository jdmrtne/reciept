import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auto: { images: false, gifs: false, videos: false },
  writes: [] as { kind: string; bytes: Uint8Array; stem?: string }[],
  gif: { bytes: new Uint8Array([71, 73, 70]), type: 'image/gif' as const },
  failWrite: false
}));
vi.mock('../config/settings', () => ({ loadSettings: () => ({ autoSave: h.auto, paperWidthMm: 58 }) }));
vi.mock('../state/session', () => ({ sessionStore: { get: () => ({ editor: { present: { layoutId: 'x' } }, footage: [] }) } }));
vi.mock('../state/stamp', () => ({ ensureSessionStamp: () => stampNow }));
vi.mock('../share/assets', () => ({ renderColorPhoto: vi.fn(async () => ({ asset: { bytes: new Uint8Array([255]), type: 'image/jpeg' } })), renderGifVersion: vi.fn(async () => h.gif) }));
vi.mock('../qr/sessionQr', () => ({ frameQrForSession: () => null }));
vi.mock('../render/orient', () => ({ isSideways: () => false }));
vi.mock('./folder', async (orig) => ({
  ...(await orig<typeof import('./folder')>()),
  writeOutput: async (kind: string, bytes: Uint8Array, stem?: string) => {
    if (h.failWrite) throw new Error('disk');
    h.writes.push({ kind, bytes, stem });
    const ext = kind === 'image' ? 'jpg' : kind === 'gif' ? 'gif' : 'mp4';
    return { ok: true as const, name: `${stem}.${ext}`, stem: stem! };
  }
}));

import { autoSaveAsset, autoSaveSession, autoSaveVideoFromGif, lastAutoSave } from './autosave';
import { renderGifVersion } from '../share/assets';
import type { Mp4Result } from './mp4';

let stampNow: object = {};
const okEnc = () => vi.fn(async (): Promise<Mp4Result> => ({ ok: true, bytes: new Uint8Array([0, 0, 0, 24]) }));

beforeEach(() => { h.auto.images = h.auto.gifs = h.auto.videos = false; h.writes.length = 0; h.failWrite = false; stampNow = {}; vi.mocked(renderGifVersion).mockClear(); });

describe('autoSaveVideoFromGif', () => {
  it('saves one MP4 per session and never twice', async () => {
    h.auto.videos = true;
    const s = {}, enc = okEnc();
    expect(await autoSaveVideoFromGif(s, h.gif, enc)).toBe(true);
    expect(await autoSaveVideoFromGif(s, h.gif, enc)).toBe(false);
    expect(enc).toHaveBeenCalledTimes(1);
    expect(h.writes.map((w) => w.kind)).toEqual(['video']);
    expect(lastAutoSave()).toMatchObject({ kind: 'video', ok: true });
    expect(lastAutoSave()!.detail).toMatch(/\.mp4$/);
    expect(await autoSaveVideoFromGif({}, h.gif, enc)).toBe(true); // the next customer is saved again
  });
  it('two calls at the same time encode once (busy guard)', async () => {
    h.auto.videos = true;
    const enc = okEnc(), s = {};
    const r = await Promise.all([autoSaveVideoFromGif(s, h.gif, enc), autoSaveVideoFromGif(s, h.gif, enc)]);
    expect(r.filter(Boolean).length).toBe(1); expect(enc).toHaveBeenCalledTimes(1);
  });
  it('does nothing (and does not encode) when the video switch is off', async () => {
    const enc = okEnc();
    expect(await autoSaveVideoFromGif({}, h.gif, enc)).toBe(false);
    expect(enc).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
  });
  it('GIF off + video on: only the MP4 is written; photo, GIF and video of one session share a name stem', async () => {
    h.auto.videos = true;
    const s = {};
    expect(await autoSaveAsset('gif', s, h.gif)).toBe(false); // gif switch off: not saved
    expect(await autoSaveVideoFromGif(s, h.gif, okEnc())).toBe(true);
    expect(h.writes.map((w) => w.kind)).toEqual(['video']);
    h.writes.length = 0; h.auto.images = h.auto.gifs = true;
    const t = {};
    await autoSaveAsset('image', t, { bytes: new Uint8Array([1]), type: 'image/jpeg' }); await autoSaveAsset('gif', t, h.gif); await autoSaveVideoFromGif(t, h.gif, okEnc());
    expect(h.writes.map((w) => w.kind)).toEqual(['image', 'gif', 'video']);
    expect(new Set(h.writes.map((w) => w.stem)).size).toBe(1);
    expect(h.writes[0].stem).toMatch(/^MEMORYS-\d{8}-\d{6}-[0-9a-z]{3}$/);
  });
  it('unsupported browser: reports the reason, writes nothing, resolves false, and photo/GIF saves still work', async () => {
    h.auto.videos = h.auto.gifs = true;
    const s = {};
    expect(await autoSaveVideoFromGif(s, h.gif, vi.fn(async (): Promise<Mp4Result> => ({ ok: false, reason: 'unsupported' })))).toBe(false);
    expect(lastAutoSave()).toMatchObject({ kind: 'video', ok: false, detail: 'VIDEO ENCODING NOT SUPPORTED IN THIS BROWSER' });
    expect(h.writes).toEqual([]);
    expect(await autoSaveAsset('gif', s, h.gif)).toBe(true);
    expect(h.writes.map((w) => w.kind)).toEqual(['gif']);
  });
  it('failed encode: reports it, can be tried again, never throws', async () => {
    h.auto.videos = true;
    const s = {};
    expect(await autoSaveVideoFromGif(s, h.gif, vi.fn(async (): Promise<Mp4Result> => ({ ok: false, reason: 'failed' })))).toBe(false);
    expect(lastAutoSave()).toMatchObject({ kind: 'video', ok: false, detail: 'VIDEO ENCODING FAILED' });
    expect(await autoSaveVideoFromGif(s, h.gif, vi.fn(async () => { throw new Error('boom'); }))).toBe(false);
    expect(await autoSaveVideoFromGif(s, h.gif, okEnc())).toBe(true);
  });
  it('a write error or bad input resolves false instead of rejecting', async () => {
    h.auto.videos = true;
    h.failWrite = true;
    expect(await autoSaveVideoFromGif({}, h.gif, okEnc())).toBe(false);
    expect(await autoSaveVideoFromGif(null, h.gif, okEnc())).toBe(false);
    expect(await autoSaveVideoFromGif({}, null, okEnc())).toBe(false);
    expect(await autoSaveVideoFromGif({}, { bytes: new Uint8Array(0), type: 'image/gif' }, okEnc())).toBe(false);
  });
});

describe('autoSaveSession', () => {
  it('renders the GIF when only the video switch is on (the GIF itself is not saved) and reports the reason where WebCodecs is missing', async () => {
    h.auto.videos = true;
    autoSaveSession();
    await vi.waitFor(() => expect(lastAutoSave()?.kind).toBe('video'));
    expect(renderGifVersion).toHaveBeenCalledTimes(1);
    expect(h.writes).toEqual([]); // node has no WebCodecs: no MP4, and the GIF switch is off so no GIF either
    expect(lastAutoSave()).toMatchObject({ ok: false, detail: 'VIDEO ENCODING NOT SUPPORTED IN THIS BROWSER' });
  });
  it('renders no GIF at all when GIF and video are both off', async () => {
    h.auto.images = false;
    autoSaveSession();
    await new Promise((r) => setTimeout(r, 20));
    expect(renderGifVersion).not.toHaveBeenCalled();
  });
});
