import { FONT_STACK } from '../render/font';

/** One sampled preview frame of a countdown (already mirrored like the photo, with the countdown number drawn on). */
export interface FootageFrame { t: number; canvas: HTMLCanvasElement }
/** The recorded countdown that led up to ONE captured photo. `src` is that photo's URL, which is how the GIF pairs them. */
export interface FootageClip { src: string; width: number; height: number; frames: FootageFrame[] }

export const FOOTAGE_MAX_SIDE = 448;   // longest side of a stored frame (px): plenty for a phone-sized GIF slot, small in memory
export const FOOTAGE_INTERVAL_MS = 125; // 8 samples/second while the countdown runs

/** One preview frame → a small canvas (mirrored for the front camera, countdown number on top). null if the video has no frame yet. */
export function sampleFrame(video: HTMLVideoElement, mirror: boolean, count: number): HTMLCanvasElement | null {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const f = Math.min(1, FOOTAGE_MAX_SIDE / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * f)), h = Math.max(1, Math.round(vh * f));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  g.save();
  if (mirror) { g.translate(w, 0); g.scale(-1, 1); }
  g.drawImage(video, 0, 0, w, h);
  g.restore();
  if (count > 0) { // the same big outlined number the customer sees on screen
    const size = Math.round(Math.min(w, h) * 0.6);
    g.font = `700 ${size}px ${FONT_STACK}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = Math.max(3, size * 0.06);
    g.strokeStyle = '#000'; g.fillStyle = '#fff';
    g.strokeText(String(count), w / 2, h / 2); g.fillText(String(count), w / 2, h / 2);
  }
  return c;
}

/**
 * Records the countdown before ONE photo by sampling the live preview. Never throws: if a frame can't be read it is
 * skipped, and a photo with no footage simply appears without a countdown in the GIF. Nothing here touches the capture.
 */
export class ClipRecorder {
  private frames: FootageFrame[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private t0 = performance.now();
  constructor(private video: HTMLVideoElement, private mirror: boolean, private count: () => number) {
    this.take(); this.timer = setInterval(() => this.take(), FOOTAGE_INTERVAL_MS);
  }
  private take(count = this.count()) {
    try { const c = sampleFrame(this.video, this.mirror, count); if (c) this.frames.push({ t: performance.now() - this.t0, canvas: c }); } catch { /* skip this sample */ }
  }
  /** Stops sampling, adds the final "0" frame (the moment of capture, no number) and returns the frames. */
  stop(final = true): FootageFrame[] {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
    if (final) this.take(0);
    const f = this.frames; this.frames = [];
    return f;
  }
}

export function makeClip(src: string, frames: FootageFrame[]): FootageClip | null {
  if (frames.length < 2) return null;
  return { src, width: frames[0].canvas.width, height: frames[0].canvas.height, frames };
}
