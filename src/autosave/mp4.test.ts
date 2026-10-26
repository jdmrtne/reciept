import { describe, expect, it } from 'vitest';
import { bitrateFor, cfrTicks, encodeMp4, encodeMp4Result, evenSize, fitToLimit, H264, repeatCount, sizeSteps, type VideoCfg, type VideoEnv } from './mp4';

describe('evenSize', () => {
  it('rounds each side DOWN to even (at most 1 px trimmed) and leaves even sizes alone', () => {
    expect(evenSize(1153, 3201)).toEqual({ w: 1152, h: 3200 });
    expect(evenSize(1152, 3200)).toEqual({ w: 1152, h: 3200 });
    expect(evenSize(101, 202)).toEqual({ w: 100, h: 202 });
  });
});

describe('fitToLimit', () => {
  const near = (w: number, h: number, r: { w: number; h: number }) => {
    const big = Math.max(w, h), small = Math.min(w, h), rb = Math.max(r.w, r.h), rs = Math.min(r.w, r.h);
    return Math.abs(rs - (rb * small) / big) <= 1;
  };
  it('never upscales and returns the even size when it already fits', () => {
    expect(fitToLimit(1152, 3200, 5000, 9000)).toEqual({ w: 1152, h: 3200 });
    expect(fitToLimit(1153, 3201, 5000, 9000)).toEqual({ w: 1152, h: 3200 });
  });
  it('downscales proportionally (aspect ratio kept within 1 px, even sides, never larger than the source)', () => {
    for (const [w, h] of [[1152, 3200], [1153, 3201], [1600, 576], [576, 1152], [800, 800]]) {
      for (const lim of [1920, 1080, 700, 300]) {
        const r = fitToLimit(w, h, lim, lim);
        expect(r.w % 2).toBe(0); expect(r.h % 2).toBe(0);
        expect(r.w).toBeLessThanOrEqual(w); expect(r.h).toBeLessThanOrEqual(h);
        expect(Math.max(r.w, r.h)).toBeLessThanOrEqual(Math.max(lim, 2));
        expect(near(w, h, r)).toBe(true);
      }
    }
  });
  it('a tall strip such as 1152x3200 still gets a valid size under a pixel budget', () => {
    const r = fitToLimit(1152, 3200, 4096, 4096, 8704 * 256);
    expect(r.w % 2 + r.h % 2).toBe(0);
    expect(r.w * r.h).toBeLessThanOrEqual(8704 * 256);
    expect(near(1152, 3200, r)).toBe(true);
  });
  it('sizeSteps starts at the even GIF size and only gets smaller, same aspect ratio', () => {
    const s = sizeSteps(1153, 3201);
    expect(s[0]).toEqual({ w: 1152, h: 3200 });
    for (let i = 1; i < s.length; i++) { expect(s[i].h).toBeLessThan(s[i - 1].h); expect(s[i].w % 2 + s[i].h % 2).toBe(0); expect(near(1153, 3201, s[i])).toBe(true); }
    expect(sizeSteps(40, 40)).toEqual([{ w: 40, h: 40 }]);
  });
});

describe('cfrTicks', () => {
  it('maps every 1/30 s tick to the active GIF frame', () => {
    const t = cfrTicks([100, 100, 100]); // 300 ms = 9 ticks
    expect(t).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
  });
  it('turns the 1800 ms final hold into repeated frames', () => {
    const t = cfrTicks([100, 100, 1800]);
    expect(t.length).toBe(60);
    expect(t.slice(0, 6)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(t.slice(6).every((i) => i === 2)).toBe(true);
  });
  it('copes with odd durations and an empty list', () => {
    expect(cfrTicks([0, NaN, 50]).length).toBeGreaterThan(0);
    expect(cfrTicks([])).toEqual([]);
    expect(cfrTicks([10]).length).toBe(1);
  });
});

describe('repeatCount', () => {
  it('repeats until the video lasts at least 6 s, at most 5 times', () => {
    expect(repeatCount(2000)).toBe(3);
    expect(repeatCount(7000)).toBe(1);
    expect(repeatCount(6000)).toBe(1);
    expect(repeatCount(500)).toBe(5);
    expect(repeatCount(0)).toBe(1);
  });
});

it('bitrate follows pixel count (about 5 Mbps at 1080p, bounded)', () => {
  expect(bitrateFor(1920, 1080)).toBe(5_000_000);
  expect(bitrateFor(100, 100)).toBe(1_500_000);
  expect(bitrateFor(8000, 8000)).toBe(20_000_000);
});

const mkEnv = (o: { w?: number; h?: number; durs?: number[]; ok?: (c: VideoCfg) => boolean; avail?: boolean; failAt?: number; decodeFails?: boolean } = {}) => {
  const log = { opened: 0, closed: 0, decodes: [] as number[], size: [] as number[][], enc: [] as { ts: number; key: boolean }[], aborted: 0, finished: 0, cfg: null as VideoCfg | null, srcClosed: 0 };
  const env: VideoEnv = {
    available: () => o.avail ?? true,
    supports: async (c) => (o.ok ?? (() => true))(c),
    decode: async () => {
      if (o.decodeFails) throw new Error('bad gif');
      return {
        width: o.w ?? 101, height: o.h ?? 203, durationsMs: o.durs ?? [100, 100, 1800], close: () => { log.srcClosed++; },
        frame: async (i, w, h) => { log.decodes.push(i); log.size.push([w, h]); log.opened++; return { close: () => { log.closed++; } }; }
      };
    },
    writer: async (c) => {
      log.cfg = c;
      return {
        encode: (_p, ts, _d, key) => { if (log.enc.length === o.failAt) throw new Error('boom'); log.enc.push({ ts, key }); },
        backlog: () => 0, finish: async () => { log.finished++; return new Uint8Array([1, 2, 3]); }, abort: () => { log.aborted++; }
      };
    }
  };
  return { env, log };
};

describe('encodeMp4 with a fake env', () => {
  it('encodes a 30 fps video at the GIF shape (odd pixel trimmed), repeated to 6 s, key frame every 30, nothing leaked', async () => {
    const { env, log } = mkEnv();
    const r = await encodeMp4Result(new Uint8Array([1]), env);
    expect(r.ok).toBe(true); if (r.ok) expect([...r.bytes]).toEqual([1, 2, 3]);
    expect(log.cfg).toMatchObject({ width: 100, height: 202, framerate: 30, codec: H264[0] });
    expect(log.enc.length).toBe(180); // 2 s loop x 3 repeats
    expect(log.enc.filter((e) => e.key).map((_, i) => i * 30).length).toBe(6);
    expect(log.enc.every((e, i) => e.key === (i % 30 === 0))).toBe(true);
    expect(log.enc[1].ts - log.enc[0].ts).toBeGreaterThan(33000); expect(log.enc[179].ts).toBeGreaterThan(5.9e6);
    expect(log.decodes).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2]); // consecutive ticks reuse the same decoded frame
    expect(log.size.every(([w, h]) => w === 100 && h === 202)).toBe(true);
    expect(log.closed).toBe(log.opened); expect(log.srcClosed).toBe(1); expect(log.finished).toBe(1); expect(log.aborted).toBe(0);
  });
  it('picks the highest H.264 level the browser accepts', async () => {
    const { env, log } = mkEnv({ ok: (c) => c.codec === H264[1] });
    expect((await encodeMp4Result(new Uint8Array([1]), env)).ok).toBe(true);
    expect(log.cfg?.codec).toBe(H264[1]);
  });
  it('a tall strip the encoder rejects is scaled down with the same aspect ratio, never changed or upscaled', async () => {
    const { env, log } = mkEnv({ w: 1152, h: 3200, ok: (c) => c.width * c.height <= 8704 * 256 });
    expect((await encodeMp4Result(new Uint8Array([1]), env)).ok).toBe(true);
    const c = log.cfg!;
    expect(c.width % 2 + c.height % 2).toBe(0); expect(c.width).toBeLessThan(1152); expect(c.height).toBeLessThan(3200);
    expect(Math.abs(c.width - (c.height * 1152) / 3200)).toBeLessThanOrEqual(1);
    expect(log.size.every(([w, h]) => w === c.width && h === c.height)).toBe(true);
  });
  it('reports unsupported (and decodes nothing) when WebCodecs is missing or no H.264 size works', async () => {
    const a = mkEnv({ avail: false }); expect(await encodeMp4Result(new Uint8Array([1]), a.env)).toEqual({ ok: false, reason: 'unsupported' }); expect(a.log.opened).toBe(0);
    const b = mkEnv({ ok: () => false }); expect(await encodeMp4Result(new Uint8Array([1]), b.env)).toEqual({ ok: false, reason: 'unsupported' }); expect(b.log.srcClosed).toBe(1);
    expect(await encodeMp4(new Uint8Array([1]), b.env)).toBeNull();
  });
  it('an encoder failure mid-way returns failed, closes every frame and aborts the encoder; it never throws', async () => {
    const { env, log } = mkEnv({ failAt: 10 });
    expect(await encodeMp4Result(new Uint8Array([1]), env)).toEqual({ ok: false, reason: 'failed' });
    expect(log.closed).toBe(log.opened); expect(log.aborted).toBeGreaterThan(0); expect(log.srcClosed).toBe(1);
  });
  it('a GIF that cannot be decoded returns failed', async () => {
    expect(await encodeMp4Result(new Uint8Array([1]), mkEnv({ decodeFails: true }).env)).toEqual({ ok: false, reason: 'failed' });
    expect(await encodeMp4Result(new Uint8Array(0), mkEnv().env)).toEqual({ ok: false, reason: 'unsupported' });
  });
});
