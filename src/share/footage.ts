/** One sampled CLEAN camera frame from before a photo (mirrored like the photo; no countdown number or any other UI). */
export interface FootageFrame { t: number; canvas: HTMLCanvasElement }
/** The recorded countdown that led up to ONE captured photo. `src` is that photo's URL, which is how the GIF pairs them. */
export interface FootageClip { src: string; width: number; height: number; frames: FootageFrame[] }

export const FOOTAGE_MAX_SIDE = 448;   // longest side of a stored frame (px): plenty for a phone-sized GIF slot, small in memory
export const FOOTAGE_INTERVAL_MS = 125; // 8 samples/second while the countdown runs

/**
 * One frame of the raw camera <video> → a small canvas (mirrored for the front camera). The countdown number, flash and
 * viewfinder marks are separate DOM elements drawn ABOVE the video, so reading the video element yields clean footage.
 */
export function sampleFrame(video: HTMLVideoElement, mirror: boolean): HTMLCanvasElement | null {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const f = Math.min(1, FOOTAGE_MAX_SIDE / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * f)), h = Math.max(1, Math.round(vh * f));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  if (mirror) { g.translate(w, 0); g.scale(-1, 1); }
  g.drawImage(video, 0, 0, w, h);
  return c;
}

/**
 * Records the camera footage before ONE photo (during its countdown) by sampling the live preview. Never throws: if a frame can't be read it is
 * skipped, and a photo with no footage simply appears without a countdown in the GIF. Nothing here touches the capture.
 */
export class ClipRecorder {
  private frames: FootageFrame[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private t0 = performance.now();
  constructor(private video: HTMLVideoElement, private mirror: boolean) {
    this.take(); this.timer = setInterval(() => this.take(), FOOTAGE_INTERVAL_MS);
  }
  private take() {
    try { const c = sampleFrame(this.video, this.mirror); if (c) this.frames.push({ t: performance.now() - this.t0, canvas: c }); } catch { /* skip this sample */ }
  }
  /** Stops sampling, adds one last frame (the moment of capture) and returns the frames. */
  stop(final = true): FootageFrame[] {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
    if (final) this.take();
    const f = this.frames; this.frames = [];
    return f;
  }
}

export function makeClip(src: string, frames: FootageFrame[]): FootageClip | null {
  if (frames.length < 2) return null;
  return { src, width: frames[0].canvas.width, height: frames[0].canvas.height, frames };
}
