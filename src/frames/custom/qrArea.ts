import { DEFAULT_QR_OPTIONS, overlaps, qrMinSide } from '../../qr/placement';
import type { CustomArtMeta, CustomQrArea } from './types';
import type { DecodedImage, Result } from './validate';

/**
 * Phase 5: the owner's QR spot for one layout (`CustomLayoutArt.qr`). Pure, no DOM.
 *
 * The app never trusts a spot. `qr/placement.ts` (unchanged) refuses to print when a declared safe area is too small, covers a photo slot
 * or is not empty, and a refused QR blocks the guest's print. So the owner may only SAVE a spot that already satisfies the same rules:
 *  1. inside the picture;
 *  2. big enough for a scannable QR on the strictest paper (58 mm, 2 dots per module) plus the margin on both sides, for the QR the booth
 *     really prints (the caller passes the module count, with slack for a longer site address);
 *  3. touching no photo window (so the QR box plus its margin can never touch a photo: the box stays inside the spot);
 *  4. one flat colour in the artwork (the renderer's pixel gate, `regionIsClear`, same tolerance), transparent pixels counted as paper white.
 * Spot fractions are the same as `QrArea.safeArea`: x and w of the canvas width, y and h of the canvas height.
 */
export const REF_UNITS = 384;
export const FLAT_TOLERANCE = 28;
/** Extra modules assumed beyond today's QR, so a slightly longer site address later does not make a saved spot too small. */
export const QR_MODULE_SLACK = 4;

type SpotMeta = Pick<CustomArtMeta, 'width' | 'height' | 'heightRatio' | 'slots'>;
export type Rect = { x: number; y: number; w: number; h: number };

/** Smallest side of a QR spot in layout units (384 across): the scannable QR plus the margin on both sides. */
export const requiredSpotSide = (modules: number): number => qrMinSide(modules) + 2 * DEFAULT_QR_OPTIONS.margin;
/** The same as a whole percent of the paper width, for messages. */
export const requiredSpotPercent = (modules: number): number => Math.ceil((requiredSpotSide(modules) / REF_UNITS) * 100);

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const EPS = 1e-6;

/** The spot in layout units (384 wide, height = 384 x heightRatio), the space `placeQr` works in. */
export const spotUnits = (m: Pick<SpotMeta, 'heightRatio'>, a: CustomQrArea): Rect => ({ x: a.x * REF_UNITS, y: a.y * REF_UNITS * m.heightRatio, w: a.w * REF_UNITS, h: a.h * REF_UNITS * m.heightRatio });

/** Rules 1 to 3. Cheap (no pixels), so the screen runs it while the owner drags. Empty array = fine. */
export function checkQrGeometry(m: SpotMeta, a: CustomQrArea, modules: number): string[] {
  const nums = [a.x, a.y, a.w, a.h];
  if (!nums.every(Number.isFinite) || a.w <= 0 || a.h <= 0) return ['Draw a rectangle for the QR spot.'];
  if (a.x < -EPS || a.y < -EPS || a.x + a.w > 1 + EPS || a.y + a.h > 1 + EPS) return ['The QR spot must stay inside the picture.'];
  const out: string[] = [], r = spotUnits(m, a), need = requiredSpotSide(modules);
  if (Math.min(r.w, r.h) < need - EPS) out.push(`The QR spot is too small for a scannable QR. Each side must be at least ${requiredSpotPercent(modules)} percent of the paper width.`);
  m.slots.forEach((s, i) => {
    if (overlaps(r, { x: s.x * REF_UNITS, y: s.y * REF_UNITS, w: s.w * REF_UNITS, h: s.h * REF_UNITS })) out.push(`The QR spot covers photo window ${i + 1}. Move it to empty space.`);
  });
  return out;
}

const white = (v: number, al: number) => v * al + 255 * (1 - al);
const at = (img: DecodedImage, x: number, y: number): [number, number, number] => {
  const i = (y * img.width + x) * 4, al = img.data[i + 3] / 255;
  return [white(img.data[i], al), white(img.data[i + 1], al), white(img.data[i + 2], al)];
};

/** Rule 4 on the stored artwork: every pixel of the spot within `tol` of the first one, transparent counted as white paper. */
export function spotIsFlat(img: DecodedImage, a: CustomQrArea, tol = FLAT_TOLERANCE): boolean {
  const x0 = Math.max(0, Math.floor(a.x * img.width)), y0 = Math.max(0, Math.floor(a.y * img.height));
  const x1 = Math.min(img.width, Math.ceil((a.x + a.w) * img.width)), y1 = Math.min(img.height, Math.ceil((a.y + a.h) * img.height));
  if (x1 <= x0 || y1 <= y0) return false;
  const ref = at(img, x0, y0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = at(img, x, y);
    if (Math.abs(p[0] - ref[0]) > tol || Math.abs(p[1] - ref[1]) > tol || Math.abs(p[2] - ref[2]) > tol) return false;
  }
  return true;
}

/** All four rules. Fractions are rounded to 4 decimals first, and the rounded value is what is checked and returned. */
export function validateQrSpot(m: SpotMeta, img: DecodedImage, area: CustomQrArea, modules: number): Result<CustomQrArea> {
  const a: CustomQrArea = { x: round4(area.x), y: round4(area.y), w: round4(area.w), h: round4(area.h) };
  const errors = checkQrGeometry(m, a, modules);
  if (errors.length) return { ok: false, errors };
  if (img.width !== m.width || img.height !== m.height) return { ok: false, errors: ['The picture could not be checked. Remove it and upload it again.'] };
  if (!spotIsFlat(img, a)) return { ok: false, errors: ['Something is drawn inside this spot. A QR code needs plain empty space, one flat colour. Move or resize the spot.'] };
  return { ok: true, value: a, warnings: [] };
}

interface Cell { ok: Uint8Array; gw: number; gh: number }

/** Largest all-ok rectangle with both sides at least minW and minH cells (every maximal rectangle is tried, so a valid one is never missed). */
function bestRect(c: Cell, minW: number, minH: number): { x: number; y: number; w: number; h: number } | null {
  const { ok, gw, gh } = c, hist = new Int32Array(gw);
  let best: { x: number; y: number; w: number; h: number } | null = null, area = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) hist[x] = ok[y * gw + x] ? hist[x] + 1 : 0;
    const st: number[] = [];
    for (let x = 0; x <= gw; x++) {
      const cur = x === gw ? 0 : hist[x];
      while (st.length && hist[st[st.length - 1]] >= cur) {
        const h = hist[st.pop()!], left = st.length ? st[st.length - 1] + 1 : 0, w = x - left;
        if (h >= minH && w >= minW && h * w > area) { area = h * w; best = { x: left, y: y - h + 1, w, h }; }
      }
      st.push(x);
    }
  }
  return best;
}

/**
 * "Find empty space": the largest plain rectangle in the artwork that is not on a photo window and is big enough, as a spot that already
 * passes `validateQrSpot`. Null when the picture has no such place (the owner then adds empty space to the design). One pass over the
 * pixels records each cell's colour range; every common flat colour is then tried against those ranges, so it stays fast on a 2304 px picture.
 */
export function suggestQrSpot(m: SpotMeta, img: DecodedImage, modules: number): CustomQrArea | null {
  const { width: W, height: H } = img;
  if (W !== m.width || H !== m.height) return null;
  const cell = Math.max(2, Math.round(W / 144)), gw = Math.ceil(W / cell), gh = Math.ceil(H / cell), n = gw * gh;
  const lo = new Float32Array(n * 3).fill(255), hi = new Float32Array(n * 3).fill(0);
  for (let y = 0; y < H; y++) {
    const gy = Math.floor(y / cell);
    for (let x = 0; x < W; x++) {
      const k = (gy * gw + Math.floor(x / cell)) * 3, p = at(img, x, y);
      for (let c = 0; c < 3; c++) { if (p[c] < lo[k + c]) lo[k + c] = p[c]; if (p[c] > hi[k + c]) hi[k + c] = p[c]; }
    }
  }
  const blocked = new Uint8Array(n);
  for (const s of m.slots) {
    const sx0 = Math.floor((s.x * W) / cell), sx1 = Math.ceil(((s.x + s.w) * W) / cell), sy0 = Math.floor((s.y * W) / cell), sy1 = Math.ceil(((s.y + s.h) * W) / cell);
    for (let gy = Math.max(0, sy0); gy < Math.min(gh, sy1); gy++) for (let gx = Math.max(0, sx0); gx < Math.min(gw, sx1); gx++) blocked[gy * gw + gx] = 1;
  }
  // candidate flat colours: the most common colours among nearly flat cells
  const bins = new Map<number, { count: number; rgb: [number, number, number] }>();
  for (let i = 0; i < n; i++) {
    if (blocked[i]) continue;
    const k = i * 3;
    if (hi[k] - lo[k] > 12 || hi[k + 1] - lo[k + 1] > 12 || hi[k + 2] - lo[k + 2] > 12) continue;
    const rgb: [number, number, number] = [(hi[k] + lo[k]) / 2, (hi[k + 1] + lo[k + 1]) / 2, (hi[k + 2] + lo[k + 2]) / 2];
    const key = ((rgb[0] >> 5) << 6) | ((rgb[1] >> 5) << 3) | (rgb[2] >> 5), b = bins.get(key);
    if (b) b.count++; else bins.set(key, { count: 1, rgb });
  }
  const refs = [...bins.values()].sort((a, b) => b.count - a.count).slice(0, 4);
  const needCells = Math.ceil((requiredSpotSide(modules) / REF_UNITS) * (W / cell)) + 2; // + 2: one cell of clearance on each side
  let best: { x: number; y: number; w: number; h: number } | null = null;
  for (const ref of refs) {
    const ok = new Uint8Array(n), tol = FLAT_TOLERANCE - 10;
    for (let i = 0; i < n; i++) {
      if (blocked[i]) continue;
      const k = i * 3;
      ok[i] = lo[k] >= ref.rgb[0] - tol && hi[k] <= ref.rgb[0] + tol && lo[k + 1] >= ref.rgb[1] - tol && hi[k + 1] <= ref.rgb[1] + tol && lo[k + 2] >= ref.rgb[2] - tol && hi[k + 2] <= ref.rgb[2] + tol ? 1 : 0;
    }
    const r = bestRect({ ok, gw, gh }, needCells, needCells);
    if (r && (!best || r.w * r.h > best.w * best.h)) best = r;
  }
  if (!best) return null;
  // one cell of clearance inside the plain region, so anti-aliased edges of the artwork never touch the spot
  const inner = { x: best.x + 1, y: best.y + 1, w: best.w - 2, h: best.h - 2 };
  const spot: CustomQrArea = { x: (inner.x * cell) / W, y: (inner.y * cell) / H, w: Math.min(inner.w * cell, W - inner.x * cell) / W, h: Math.min(inner.h * cell, H - inner.y * cell) / H };
  const r = validateQrSpot(m, img, spot, modules);
  return r.ok ? r.value : null;
}
