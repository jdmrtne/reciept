/**
 * GIF -> MP4 for the admin auto-save (social platforms want a video, a GIF does not loop there). The MP4 is made FROM THE GIF BYTES the booth
 * already has: nothing is re-rendered. Decode = WebCodecs ImageDecoder (composited frames), encode = VideoEncoder (H.264), mux = mp4-muxer (pure JS).
 * Shape = the GIF's own shape: only the 1 px needed for even dimensions is trimmed; if the encoder rejects the size it is scaled DOWN with the same
 * aspect ratio (never up, never padded or cropped). The browser-only parts sit behind `VideoEnv` so tests can use a fake. Nothing here throws to a caller.
 */
export const FPS = 30, KEY_EVERY = 30, MIN_SECONDS = 6, MAX_REPEATS = 5;
export const H264 = ['avc1.640033', 'avc1.64002A', 'avc1.640028'] as const; // High profile, level 5.1 / 4.2 / 4.0 (highest first)
const yieldUi = () => new Promise<void>((r) => setTimeout(r, 0));

// ---- pure maths (exported for node tests) ----
/** H.264 needs even sides: round each DOWN to the nearest even number (at most 1 px trimmed per side). */
export const evenSize = (w: number, h: number) => ({ w: Math.max(2, Math.floor(w / 2) * 2), h: Math.max(2, Math.floor(h / 2) * 2) });

/** Proportional downscale into maxW x maxH (and maxPx pixels): same aspect ratio within 1 px of even rounding, never larger than the source. */
export function fitToLimit(w: number, h: number, maxW: number, maxH: number, maxPx = Infinity): { w: number; h: number } {
  const s = Math.min(1, maxW / w, maxH / h, Math.sqrt(maxPx / (w * h))), e = evenSize(w, h);
  if (!(s < 1)) return e;
  if (h >= w) { const nh = Math.max(2, 2 * Math.floor((h * s) / 2)); return { w: Math.min(e.w, Math.max(2, 2 * Math.round((nh * w) / h / 2))), h: nh }; }
  const nw = Math.max(2, 2 * Math.floor((w * s) / 2)); return { w: nw, h: Math.min(e.h, Math.max(2, 2 * Math.round((nw * h) / w / 2))) };
}

/** Candidate sizes, biggest first: the even GIF size, then 15 % smaller steps (same aspect ratio) down to `minSide`. */
export function sizeSteps(w: number, h: number, factor = 0.85, minSide = 64): { w: number; h: number }[] {
  const out = [evenSize(w, h)];
  for (let s = factor; ; s *= factor) {
    const r = fitToLimit(w, h, w * s, h * s), l = out[out.length - 1];
    if (Math.min(r.w, r.h) < minSide) break;
    if (r.w !== l.w || r.h !== l.h) out.push(r);
  }
  return out;
}

/** Constant frame rate: for every 1/fps tick, the index of the GIF frame active at that time (a long hold becomes repeated frames). */
export function cfrTicks(durationsMs: number[], fps = FPS): number[] {
  const d = durationsMs.map((x) => (Number.isFinite(x) && x > 0 ? x : 100)), total = d.reduce((a, b) => a + b, 0);
  const n = d.length ? Math.max(1, Math.ceil((total * fps) / 1000 - 1e-6)) : 0, out: number[] = [];
  let i = 0, end = d[0] ?? 0;
  for (let k = 0; k < n; k++) {
    while (i < d.length - 1 && k * 1000 >= end * fps) { i++; end += d[i]; } // tick k is at k*1000/fps ms
    out.push(i);
  }
  return out;
}

/** How many times the loop is played so the video lasts at least `minMs` (platforms do not loop a video like a GIF), at most `max`. */
export const repeatCount = (loopMs: number, minMs = MIN_SECONDS * 1000, max = MAX_REPEATS) => (loopMs > 0 ? Math.max(1, Math.min(max, Math.ceil(minMs / loopMs))) : 1);

/** About 5 Mbps per 1080p of pixels, kept between 1.5 and 20 Mbps. */
export const bitrateFor = (w: number, h: number) => Math.round(Math.min(20e6, Math.max(1.5e6, (5e6 * w * h) / (1920 * 1080))));

// ---- encoder flow (env injected) ----
export interface VideoCfg { codec: string; width: number; height: number; bitrate: number; framerate: number }
export interface Pic { close(): void }
export interface GifSource { width: number; height: number; durationsMs: number[]; frame(i: number, w: number, h: number): Promise<Pic>; close(): void }
export interface Mp4Writer { encode(pic: Pic, tsUs: number, durUs: number, key: boolean): void; backlog(): number; finish(): Promise<Uint8Array>; abort(): void }
export interface VideoEnv {
  available(): boolean;
  supports(cfg: VideoCfg): Promise<boolean>;
  decode(gif: Uint8Array): Promise<GifSource>;
  writer(cfg: VideoCfg): Promise<Mp4Writer>;
}
export type Mp4Result = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'unsupported' | 'failed' };

/** GIF bytes -> MP4 bytes, or why not. Never rejects; every decoded frame and the encoder are closed on every path. */
export async function encodeMp4Result(gif: Uint8Array, env: VideoEnv = browserVideoEnv): Promise<Mp4Result> {
  let src: GifSource | null = null, wr: Mp4Writer | null = null, pic: Pic | null = null;
  try {
    if (!gif?.length || !env.available()) return { ok: false, reason: 'unsupported' };
    src = await env.decode(gif);
    let cfg: VideoCfg | null = null;
    for (const s of sizeSteps(src.width, src.height)) { // highest H.264 level first at the GIF's own size, then smaller sizes (same aspect ratio)
      for (const codec of H264) { const c = { codec, width: s.w, height: s.h, bitrate: bitrateFor(s.w, s.h), framerate: FPS }; if (await env.supports(c)) { cfg = c; break; } }
      if (cfg) break;
    }
    if (!cfg) return { ok: false, reason: 'unsupported' };
    const ticks = cfrTicks(src.durationsMs, FPS);
    if (!ticks.length) return { ok: false, reason: 'failed' };
    const reps = repeatCount((ticks.length * 1000) / FPS), total = ticks.length * reps, dur = Math.round(1e6 / FPS);
    wr = await env.writer(cfg);
    let cur = -1;
    for (let k = 0; k < total; k++) {
      const gi = ticks[k % ticks.length];
      if (gi !== cur) { pic?.close(); pic = null; pic = await src.frame(gi, cfg.width, cfg.height); cur = gi; }
      wr.encode(pic!, Math.round((k * 1e6) / FPS), dur, k % KEY_EVERY === 0);
      for (let n = 0; wr.backlog() > 12 && n < 400; n++) await yieldUi(); // let the encoder catch up
      if (k % 3 === 2) await yieldUi(); // keep the booth UI responsive
    }
    const bytes = await wr.finish(); wr = null;
    return bytes.length ? { ok: true, bytes } : { ok: false, reason: 'failed' };
  } catch { return { ok: false, reason: 'failed' }; }
  finally { try { pic?.close(); } catch { /* ignore */ } try { wr?.abort(); } catch { /* ignore */ } try { src?.close(); } catch { /* ignore */ } }
}

/** Convenience: the MP4 bytes, or null when it cannot be made. */
export async function encodeMp4(gifBytes: Uint8Array, env: VideoEnv = browserVideoEnv): Promise<Uint8Array | null> {
  const r = await encodeMp4Result(gifBytes, env); return r.ok ? r.bytes : null;
}

// ---- the real browser parts (Chrome / Edge WebCodecs); minimal local typings so this does not depend on the DOM lib version ----
interface WcFrame { displayWidth: number; displayHeight: number; duration: number | null; close(): void }
interface WcDecoder { tracks: { ready: Promise<void>; selectedTrack?: { frameCount: number } | null }; decode(o: { frameIndex: number; completeFramesOnly?: boolean }): Promise<{ image: WcFrame }>; close(): void }
interface WcEncoder { encodeQueueSize: number; configure(c: object): void; encode(f: WcFrame, o?: { keyFrame?: boolean }): void; flush(): Promise<void>; close(): void }
interface WcGlobals {
  ImageDecoder?: (new (init: { data: Uint8Array; type: string }) => WcDecoder) & { isTypeSupported?(t: string): Promise<boolean> };
  VideoEncoder?: (new (init: { output: (chunk: unknown, meta?: unknown) => void; error: (e: Error) => void }) => WcEncoder) & { isConfigSupported(c: object): Promise<{ supported?: boolean }> };
  VideoFrame?: new (src: unknown, init: object) => WcFrame;
  OffscreenCanvas?: new (w: number, h: number) => { getContext(t: '2d'): { imageSmoothingEnabled: boolean; imageSmoothingQuality: string; drawImage(img: unknown, x: number, y: number, w: number, h: number): void } | null };
}
const wc = () => globalThis as unknown as WcGlobals;
const encCfg = (c: VideoCfg) => ({ codec: c.codec, width: c.width, height: c.height, bitrate: c.bitrate, framerate: c.framerate, avc: { format: 'avc' }, latencyMode: 'quality' });

export const browserVideoEnv: VideoEnv = {
  available: () => { const g = wc(); return typeof g.ImageDecoder === 'function' && typeof g.VideoEncoder === 'function' && typeof g.VideoFrame === 'function'; },
  async supports(c) { try { return (await wc().VideoEncoder!.isConfigSupported(encCfg(c))).supported === true; } catch { return false; } },
  async decode(gif) {
    const g = wc(), ID = g.ImageDecoder!, VF = g.VideoFrame!, OC = g.OffscreenCanvas;
    if (ID.isTypeSupported && !(await ID.isTypeSupported('image/gif'))) throw new Error('gif-decoder');
    const dec = new ID({ data: gif, type: 'image/gif' });
    try {
      await dec.tracks.ready;
      const n = dec.tracks.selectedTrack?.frameCount ?? 0;
      if (!n) throw new Error('gif-empty');
      const durationsMs: number[] = []; let width = 0, height = 0;
      for (let i = 0; i < n; i++) { // first pass: size and per-frame durations (one frame alive at a time)
        const { image } = await dec.decode({ frameIndex: i });
        try { if (i === 0) { width = image.displayWidth; height = image.displayHeight; } durationsMs.push((image.duration ?? 0) / 1000); } finally { image.close(); }
        if (i % 8 === 7) await yieldUi();
      }
      return {
        width, height, durationsMs, close: () => dec.close(),
        async frame(i, w, h) {
          const { image } = await dec.decode({ frameIndex: i }); let keep = false;
          try {
            const dw = image.displayWidth, dh = image.displayHeight, e = evenSize(dw, dh);
            if (dw === w && dh === h) { keep = true; return image; }
            if (w === e.w && h === e.h) return new VF(image, { visibleRect: { x: 0, y: 0, width: w, height: h }, timestamp: 0 }); // only the odd pixel trimmed
            const c = new OC!(w, h), x = c.getContext('2d'); if (!x) throw new Error('no-2d');
            x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(image, 0, 0, w, h); // proportional downscale
            return new VF(c, { timestamp: 0 });
          } finally { if (!keep) image.close(); }
        }
      };
    } catch (e) { try { dec.close(); } catch { /* ignore */ } throw e; }
  },
  async writer(cfg) {
    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer'), g = wc();
    const target = new ArrayBufferTarget(), muxer = new Muxer({ target, video: { codec: 'avc', width: cfg.width, height: cfg.height, frameRate: cfg.framerate }, fastStart: 'in-memory' });
    let err: Error | null = null, closed = false;
    const enc = new g.VideoEncoder!({ output: (chunk, meta) => { try { muxer.addVideoChunk(chunk as never, meta as never); } catch (e) { err = e as Error; } }, error: (e) => { err = e; } });
    enc.configure(encCfg(cfg));
    const close = () => { if (!closed) { closed = true; try { enc.close(); } catch { /* ignore */ } } };
    return {
      encode(pic, ts, dur, key) {
        if (err) throw err;
        const vf = new g.VideoFrame!(pic, { timestamp: ts, duration: dur });
        try { enc.encode(vf, { keyFrame: key }); } finally { vf.close(); }
      },
      backlog: () => enc.encodeQueueSize,
      async finish() { await enc.flush(); if (err) throw err; muxer.finalize(); close(); return new Uint8Array(target.buffer); },
      abort: close
    };
  }
};

/** Can this browser make the video at all (ImageDecoder + VideoEncoder + VideoFrame)? H.264 itself is only known once an encode is tried. */
export const videoSupported = (env: VideoEnv = browserVideoEnv) => env.available();
