import { padBitmap, createBitmap, setDot } from './bitmap';
import { DEFAULT_THERMAL, type Bitmap1, type DitherMode, type RGBAImage, type ThermalSettings } from './types';

/**
 * Thermal pipeline: PURE functions. Input is the renderPrint() output (RGBA), never mutated.
 * grayscale → resize to paper width → adaptive levels → tone (brightness/contrast/density)
 *   → unsharp mask → threshold|dither → 1-bit → margins.
 * PrintScreen previews this exact output, so what you see there is what burns.
 */

const DITHERS: DitherMode[] = ['threshold', 'floyd-steinberg', 'atkinson', 'ordered'];
const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;

/** Fills gaps and clamps hostile/old localStorage values so the pipeline can trust its settings. */
export function normalizeThermal(p: Partial<ThermalSettings> | undefined | null): ThermalSettings {
  const d = DEFAULT_THERMAL, s = p ?? {};
  return {
    brightness: num(s.brightness, -100, 100, d.brightness),
    contrast: num(s.contrast, -100, 100, d.contrast),
    dither: DITHERS.includes(s.dither as DitherMode) ? (s.dither as DitherMode) : d.dither,
    threshold: num(s.threshold, 0, 255, d.threshold),
    density: num(s.density, 1, 5, d.density),
    sharpen: num(s.sharpen, 0, 100, d.sharpen),
    autoLevel: num(s.autoLevel, 0, 100, d.autoLevel),
    marginX: num(s.marginX, 0, 96, d.marginX),
    marginTop: num(s.marginTop, 0, 400, d.marginTop),
    marginBottom: num(s.marginBottom, 0, 400, d.marginBottom),
    feedLines: num(s.feedLines, 0, 20, d.feedLines),
    cut: typeof s.cut === 'boolean' ? s.cut : d.cut
  };
}

/** Rec.601 luma (same weights as the grayscale filter), composited over white paper so transparency prints white. */
export function toGray(img: RGBAImage): Uint8Array {
  const n = img.width * img.height, out = new Uint8Array(n), d = img.data;
  for (let i = 0; i < n; i++) {
    const j = i * 4, a = d[j + 3] / 255;
    const y = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    out[i] = Math.round(y * a + 255 * (1 - a));
  }
  return out;
}

/** Area-average resample of one axis (box filter: good for big → small, exact when sizes match). */
function resampleAxis(src: Float32Array, sw: number, sh: number, dn: number, axis: 'x' | 'y'): Float32Array {
  const sn = axis === 'x' ? sw : sh, ratio = sn / dn;
  const dw = axis === 'x' ? dn : sw, dh = axis === 'x' ? sh : dn;
  const out = new Float32Array(dw * dh);
  for (let o = 0; o < dn; o++) {
    const a = o * ratio, b = (o + 1) * ratio;
    const i0 = Math.floor(a), i1 = Math.min(sn - 1, Math.ceil(b) - 1);
    const wts: [number, number][] = [];
    for (let i = i0; i <= i1; i++) wts.push([i, Math.min(b, i + 1) - Math.max(a, i)]);
    const total = wts.reduce((s, [, w]) => s + w, 0);
    if (axis === 'x') for (let y = 0; y < sh; y++) { let acc = 0; for (const [i, w] of wts) acc += src[y * sw + i] * w; out[y * dw + o] = acc / total; }
    else for (let x = 0; x < sw; x++) { let acc = 0; for (const [i, w] of wts) acc += src[i * sw + x] * w; out[o * dw + x] = acc / total; }
  }
  return out;
}

export function resizeGray(gray: Uint8Array, w: number, h: number, nw: number, nh: number): Uint8Array {
  if (w === nw && h === nh) return gray.slice();
  let f: Float32Array = Float32Array.from(gray), cw = w, ch = h;
  if (nw !== w) { f = resampleAxis(f, cw, ch, nw, 'x'); cw = nw; }
  if (nh !== h) { f = resampleAxis(f, cw, ch, nh, 'y'); ch = nh; }
  const out = new Uint8Array(nw * nh);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(255, Math.max(0, Math.round(f[i])));
  return out;
}

/**
 * Tone curve as a 256-entry LUT. Contrast is linear about mid-gray; brightness and density are a gamma
 * (so they never lift the paper white). Pure white (255) and pure ink (0) are pinned: the white paper and
 * black frame lines must not speckle or thin out whatever the owner tunes.
 */
export function toneLut(t: Pick<ThermalSettings, 'brightness' | 'contrast' | 'density'>): Uint8Array {
  const c = t.contrast * 2.55, f = (259 * (c + 255)) / (255 * (259 - c));
  const gamma = Math.pow(2, -t.brightness / 50 + (t.density - 3) * 0.3); // >1 darker, <1 lighter
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const lin = Math.min(255, Math.max(0, f * (v - 128) + 128));
    lut[v] = Math.min(255, Math.max(0, Math.round(255 * Math.pow(lin / 255, gamma))));
  }
  lut[0] = 0; lut[255] = 255;
  return lut;
}

/**
 * Adaptive levels. Looks only at "photographic" pixels (1..254): the pinned paper white and ink black of the
 * frame/text are ignored, so the receipt template never skews the measurement. The 2nd..98th percentile of those
 * pixels is stretched toward 0..255 by `strength` (0..1). A dim booth gets lifted, a blown-out one gets pulled
 * down, so the fixed tone curve afterwards always meets a face in the same range. 0 and 255 stay pinned.
 * Returns the input untouched when there are too few photo pixels to measure (e.g. a text-only page).
 */
const MID_TARGET = 0.45, GAMMA_MAX = 1.6; // photo median goal (fraction of full scale) and the most it may bend
export function autoLevels(gray: Uint8Array, strength: number): Uint8Array {
  if (strength <= 0) return gray;
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < gray.length; i++) { const v = gray[i]; if (v > 0 && v < 255) { hist[v]++; n++; } }
  if (n < gray.length * 0.02) return gray;
  const pct = (p: number) => { let acc = 0; for (let v = 1; v < 255; v++) { acc += hist[v]; if (acc >= n * p) return v; } return 254; };
  const lo = pct(0.02) * strength, hi = 255 - (255 - pct(0.98)) * strength;
  if (hi - lo < 32) return gray; // nearly flat: stretching would only amplify noise
  // Median anchor: after the stretch, a gamma nudges the photos' median toward MID_TARGET (limited to ±, and scaled
  // by `strength`), so an over-exposed booth doesn't push skin into white where nose/lips can't survive the dither.
  const stretch = (v: number) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  let acc = 0, med = 128;
  for (let v = 1; v < 255; v++) { acc += hist[v]; if (acc >= n * 0.5) { med = v; break; } }
  const m = Math.min(0.95, Math.max(0.05, stretch(med)));
  const g = Math.pow(Math.log(MID_TARGET) / Math.log(m), strength), gamma = Math.min(GAMMA_MAX, Math.max(1 / GAMMA_MAX, g));
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.min(255, Math.max(0, Math.round(255 * Math.pow(stretch(v), gamma))));
  lut[0] = 0; lut[255] = 255;
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < out.length; i++) out[i] = lut[gray[i]];
  return out;
}

/**
 * Unsharp mask at printer resolution: gray + amount × (gray − blur). The blur is a small separable binomial
 * (σ≈1 dot), the size of an eye/lip/brow edge on the paper. The detail term is capped (±LIMIT) so a strong edge
 * cannot ring into a halo, and results clamp to 0..255, which keeps paper white and ink black exactly as they were.
 */
const SHARP_LIMIT = 48;
export function sharpenGray(gray: Uint8Array, w: number, h: number, amount: number): Uint8Array {
  if (amount <= 0 || w < 3 || h < 3) return gray;
  const K = [1, 4, 6, 4, 1], tmp = new Float32Array(gray.length), blur = new Float32Array(gray.length);
  const cl = (v: number, n: number) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0; for (let k = -2; k <= 2; k++) a += gray[y * w + cl(x + k, w)] * K[k + 2];
    tmp[y * w + x] = a / 16;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0; for (let k = -2; k <= 2; k++) a += tmp[cl(y + k, h) * w + x] * K[k + 2];
    blur[y * w + x] = a / 16;
  }
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < out.length; i++) {
    const d = Math.max(-SHARP_LIMIT, Math.min(SHARP_LIMIT, gray[i] - blur[i]));
    out[i] = Math.min(255, Math.max(0, Math.round(gray[i] + amount * d)));
  }
  return out;
}

const BAYER8 = (() => { // classic 8×8 ordered-dither matrix
  const m = [[0]];
  let n = 1, cur = m;
  while (n < 8) {
    const next: number[][] = Array.from({ length: n * 2 }, () => new Array(n * 2).fill(0));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = cur[y][x] * 4;
      next[y][x] = v; next[y][x + n] = v + 2; next[y + n][x] = v + 3; next[y + n][x + n] = v + 1;
    }
    cur = next; n *= 2;
  }
  return cur;
})();

/** Error-diffusion kernels: [dx, dy, weight], weights over `div`. Atkinson deliberately diffuses only 6/8 (punchier blacks). */
const KERNELS = {
  'floyd-steinberg': { div: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  atkinson: { div: 8, k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] }
} as const;

/** Grayscale → 1-bit. 1 = black. Deterministic. */
export function ditherToBitmap(gray: Uint8Array, w: number, h: number, mode: DitherMode, threshold = 128): Bitmap1 {
  const out = createBitmap(w, h);
  if (mode === 'threshold') {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (gray[y * w + x] < threshold) setDot(out, x, y, true);
  } else if (mode === 'ordered') {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const cut = ((BAYER8[y & 7][x & 7] + 0.5) / 64) * 255;
      if (gray[y * w + x] < cut) setDot(out, x, y, true);
    }
  } else {
    const { div, k } = KERNELS[mode], f = Float32Array.from(gray);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const old = f[y * w + x], black = old < 128, err = old - (black ? 0 : 255);
      if (black) setDot(out, x, y, true);
      if (err !== 0) for (const [dx, dy, wt] of k) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny < h) f[ny * w + nx] += (err * wt) / div;
      }
    }
  }
  return out;
}

/** The whole pipeline. Output width is exactly `paperDots`; height follows the image aspect plus margins. */
export function toThermalBitmap(img: RGBAImage, settings: Partial<ThermalSettings>, paperDots: number): Bitmap1 {
  const t = normalizeThermal(settings);
  if (!(img.width > 0 && img.height > 0)) throw new Error('empty image');
  const mx = Math.min(t.marginX, Math.floor((paperDots - 8) / 2));
  const cw = paperDots - 2 * mx, ch = Math.max(1, Math.round((img.height * cw) / img.width));
  // Order matters (see PHOTOBOOTH_FACE): every step feeds the next one at FINAL dot resolution.
  //  1. resize to the paper's dots first, so nothing after this works on detail the printer can't draw;
  //  2. adaptive levels, so the fixed curve below always sees a face in the same tonal range;
  //  3. tone curve: brightness+density lift skin (thermal dots spread, so a 1-bit midtone prints darker than its
  //     grey value) while contrast keeps hair/brows/eyes black;
  //  4. sharpen AFTER tone, so the edges that survive are the ones the dither will actually see;
  //  5. error-diffusion dither LAST: it keeps grey structure (jaw, nose, lips) as dot density instead of a hard cut.
  let gray = resizeGray(toGray(img), img.width, img.height, cw, ch);
  gray = autoLevels(gray, t.autoLevel / 100);
  const lut = toneLut(t), toned = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) toned[i] = lut[gray[i]];
  const sharp = sharpenGray(toned, cw, ch, t.sharpen / 100);
  const bits = ditherToBitmap(sharp, cw, ch, t.dither, t.threshold);
  return padBitmap(bits, mx, mx, t.marginTop, t.marginBottom);
}
