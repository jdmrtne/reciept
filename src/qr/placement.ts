import type { Rect } from '../layouts/types';
import type { FrameDef, Prim, QrArea } from '../frames/types';

/**
 * QR placement for the printed frame. PURE: no DOM, no canvas, no Vite-only imports (so it is unit-testable anywhere).
 *
 * WHERE THE QR GOES (same for every frame):
 *   1. SAFE AREA - a frame (per layout) may DECLARE an intentionally empty region (`FrameDef.qr`); the QR then lives only inside it.
 *   2. CORNER    - otherwise the LOWER-LEFT corner INSIDE the frame, small (about a quarter of the paper width, the smallest
 *                  that still scans). It is never placed over a photo slot (even a blank one), a sticker, or text/ornaments the
 *                  frame draws itself. Bitmap frame artwork has no geometry to read, so the QR's white plate may sit on the
 *                  artwork in that corner (a deliberate choice: see docs/QR-PLACEMENT.md).
 *   3. STRIP     - only when the corner would hit a photo/sticker/text (a thin footer): an empty strip is appended BELOW the
 *                  finished design, which keeps its exact coordinates. `allowStrip: false` forbids it, and the placement is rejected.
 * If nothing works the placement FAILS. It never "falls back" to covering a photo, sticker or text.
 */

/** Quiet-zone modules around the QR. Same value as `QUIET` in share/qr.ts (not imported, to keep this module dependency-free). */
export const QR_QUIET = 4;

export interface QrOptions {
  /** Empty margin (canvas units) kept around the QR so it never looks attached to a photo, sticker or drawn text. */
  margin: number;
  /** Distance (canvas units) from the left and bottom edges of the frame to the corner QR. */
  inset: number;
  /** Preferred QR side (quiet zone included) as a fraction of the canvas width. */
  sizeFrac: number;
  /** Smallest acceptable printed dots per module (measured on the real paper, see `paperDots`). Below this a thermal print is not reliably scannable. */
  minDotsPerModule: number;
}
export const DEFAULT_QR_OPTIONS: QrOptions = { margin: 3, inset: 6, sizeFrac: 0.24, minDotsPerModule: 2 };

export type OccupiedKind = 'photo' | 'sticker' | 'text' | 'frame' | 'artwork';
export interface Occupied { kind: OccupiedKind; rect: Rect }

export type QrFailure = 'no-safe-area' | 'too-small' | 'overlap' | 'out-of-bounds';
export type QrPlacement =
  | { ok: true; mode: 'corner' | 'safe-area' | 'strip'; rect: Rect; margin: number; /** total canvas height (units) once the QR is placed */ canvasHeight: number }
  | { ok: false; reason: QrFailure; message: string; hits: Occupied[] };

export class QrPlacementError extends Error {
  readonly reason: QrFailure | 'content';
  readonly hits: Occupied[];
  constructor(reason: QrFailure | 'content', message: string, hits: Occupied[] = []) { super(message); this.name = 'QrPlacementError'; this.reason = reason; this.hits = hits; }
}

/* ---------- geometry ---------- */

const EPS = 1e-6;
export const inflate = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
/** True when the interiors intersect. Rectangles that merely touch along an edge do NOT overlap. */
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
export const within = (r: Rect, outer: Rect) => r.x >= outer.x - EPS && r.y >= outer.y - EPS && r.x + r.w <= outer.x + outer.w + EPS && r.y + r.h <= outer.y + outer.h + EPS;
const bbox = (pts: [number, number][]): Rect => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

/** Axis-aligned box that contains a rectangle rotated (degrees) about its own centre. */
export function rotatedBounds(o: { x: number; y: number; w: number; h: number; rotation?: number }): Rect {
  const a = ((o.rotation ?? 0) * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const w = o.w * c + o.h * s, h = o.w * s + o.h * c, cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/* ---------- what is on the paper ---------- */

const GLYPH_W = 0.62; // monospace glyph width / font size, slightly above the renderer's 0.6 so we err on the safe side

/**
 * The area each drawn primitive covers. Deliberately generous: a stroke-only rectangle (a border) covers only its four
 * edges, so the empty inside is still available, but everything else covers its whole bounding box.
 */
export function primRegions(p: Prim, W: number, H: number): Rect[] {
  const edges = (r: Rect, t: number): Rect[] => [
    { x: r.x - t / 2, y: r.y - t / 2, w: r.w + t, h: t }, { x: r.x - t / 2, y: r.y + r.h - t / 2, w: r.w + t, h: t },
    { x: r.x - t / 2, y: r.y - t / 2, w: t, h: r.h + t }, { x: r.x + r.w - t / 2, y: r.y - t / 2, w: t, h: r.h + t }
  ];
  switch (p.k) {
    case 'rect': {
      const sw = p.stroke ? p.sw ?? 1 : 0, r = { x: p.x, y: p.y, w: p.w, h: p.h };
      return p.fill ? [inflate(r, sw / 2)] : edges(r, Math.max(1, sw));
    }
    case 'line': { const sw = p.sw, r = bbox([[p.x1, p.y1], [p.x2, p.y2]]); return [inflate(r, sw / 2)]; }
    case 'circle': return [inflate({ x: p.cx - p.r, y: p.cy - p.r, w: 2 * p.r, h: 2 * p.r }, (p.stroke ? p.sw ?? 1 : 0) / 2)];
    case 'poly': return p.pts.length ? [bbox(p.pts)] : [];
    case 'path': {
      const pts: [number, number][] = [];
      for (const c of p.cmds) { if (c[0] === 'Z') continue; for (let i = 1; i < c.length; i += 2) pts.push([c[i] as number, c[i + 1] as number]); }
      if (!pts.length) return [];
      const sw = p.stroke === 'none' ? 0 : p.sw ?? 1, r = bbox(pts);
      // A big open outline (hand-drawn border) wraps the canvas: only its edge band is ink. Its wobble is a few units, hence + 8.
      if (!p.fill && r.w >= W * 0.8 && r.h >= H * 0.8) return edges(r, sw + 8);
      return [inflate(r, sw / 2)];
    }
    case 'text': {
      const width = p.fit ?? p.text.length * (GLYPH_W * p.size + p.ls);
      const x = p.anchor === 'start' ? p.x : p.anchor === 'end' ? p.x - width : p.x - width / 2;
      return [{ x, y: p.y - p.size * 0.9, w: width, h: p.size * 1.2 }];
    }
  }
}

export interface OccupancyInput {
  /** Canvas size (units) of the composed design WITHOUT any QR strip. */
  width: number; height: number;
  /** EVERY photo slot of the layout. A slot is occupied even when no photo has been put in it yet. */
  slots: Rect[];
  /** Visible stickers (unrotated box + rotation). */
  stickers: { x: number; y: number; w: number; h: number; rotation: number }[];
  /** Drawn frame primitives (empty for bitmap-art frames). */
  prims: Prim[];
  /** The frame is a bitmap overlay. Its pixels cannot be analysed here, so only a DECLARED safe area may sit inside it (and the renderer pixel-checks it). */
  artwork: boolean;
}

export function occupiedRegions(i: OccupancyInput): Occupied[] {
  const out: Occupied[] = [];
  for (const s of i.slots) out.push({ kind: 'photo', rect: s });
  for (const s of i.stickers) out.push({ kind: 'sticker', rect: rotatedBounds(s) });
  for (const p of i.prims) for (const r of primRegions(p, i.width, i.height)) out.push({ kind: p.k === 'text' ? 'text' : 'frame', rect: r });
  return out;
}

/** Everything the QR box (grown by `margin`) would touch. Empty array = the spot is free. */
export const collisions = (rect: Rect, occupied: Occupied[], margin: number): Occupied[] => {
  const probe = inflate(rect, margin);
  return occupied.filter((o) => overlaps(probe, o.rect));
};

/* ---------- placement ---------- */

const frac = (a: QrArea['safeArea'], W: number, H: number): Rect => ({ x: a.x * W, y: a.y * H, w: a.w * W, h: a.h * H });

/** The QR-safe area a frame declares for a layout (layout-specific wins over the frame default), or null. */
export const qrAreaFor = (f: Pick<FrameDef, 'qr'>, layoutId: string): QrArea | null => f.qr?.byLayout?.[layoutId] ?? f.qr?.default ?? null;

/** Printed width of the paper in dots (58 mm = 384, 80 mm = 576). The canvas is always 384 units wide, so one unit = paperDots / 384 dots. */
export const REF_DOTS = 384;
export const qrMinSide = (modules: number, o: QrOptions = DEFAULT_QR_OPTIONS, paperDots = REF_DOTS, unitsW = 384) =>
  Math.ceil(((modules + 2 * QR_QUIET) * o.minDotsPerModule * unitsW) / paperDots);

export interface PlaceInput {
  /** Matrix size (modules per side, without quiet zone). */
  modules: number;
  occ: OccupancyInput;
  /** Declared safe area for this frame + layout, if any. */
  area?: QrArea | null;
  /** Allow the appended strip when the frame declares no safe area (default true). */
  allowStrip?: boolean;
  options?: Partial<QrOptions>;
  /** Dots across the real paper (58 mm = 384, 80 mm = 576). Default 384, the strictest. The scannable minimum is measured in real dots, so a wider paper may use a smaller QR. */
  paperDots?: number;
}

export function placeQr(i: PlaceInput): QrPlacement {
  const o = { ...DEFAULT_QR_OPTIONS, ...i.options }, { width: W, height: H } = i.occ;
  const minSide = qrMinSide(i.modules, o, i.paperDots ?? REF_DOTS, W);
  const occupied = occupiedRegions(i.occ);
  const fail = (reason: QrFailure, message: string, hits: Occupied[] = []): QrPlacement => ({ ok: false, reason, message, hits });
  const wanted = Math.max(minSide, Math.round((i.area?.size ?? o.sizeFrac) * W)); // a configured size below the scannable minimum is raised, never used

  if (i.area) {
    const a = frac(i.area.safeArea, W, H);
    if (!within(a, { x: 0, y: 0, w: W, h: H })) return fail('out-of-bounds', 'The QR-safe area is not inside the frame.');
    if (Math.min(a.w, a.h) < minSide + 2 * o.margin) return fail('too-small', 'The QR-safe area is too small for a scannable QR. Give this frame a larger empty QR-safe area.');
    const room = Math.floor(Math.min(a.w, a.h) - 2 * o.margin);
    let blocked: Occupied[] = [];
    for (let side = Math.min(wanted, room); side >= minSide; side -= 4) { // shrink only while it stays scannable
      const lo = { x: a.x + o.margin, y: a.y + o.margin }, hi = { x: a.x + a.w - o.margin - side, y: a.y + a.h - o.margin - side };
      // Prefer the bottom-right corner (where a receipt QR is expected), then sweep towards the top-left.
      for (let y = hi.y; y >= lo.y - EPS; y -= 4) for (let x = hi.x; x >= lo.x - EPS; x -= 4) {
        const rect = { x: Math.round(x), y: Math.round(y), w: side, h: side };
        const hits = collisions(rect, occupied, o.margin);
        if (!hits.length) return { ok: true, mode: 'safe-area', rect, margin: o.margin, canvasHeight: H };
        if (!blocked.length) blocked = hits;
      }
    }
    return fail('overlap', 'The QR-safe area is not empty: something is drawn inside it. Move the QR-safe area to genuinely empty space.', blocked);
  }

  const protectedOnly = occupied.filter((r) => r.kind === 'photo' || r.kind === 'sticker' || r.kind === 'text');
  // Corner: lower-left, inside the frame, as large as preferred and shrinking only while it stays scannable.
  // Protected here: photo slots, stickers and the text the frame draws. Drawn rules/ornaments and bitmap artwork in that corner sit under the QR's white plate.
  for (let side = Math.min(wanted, Math.floor(W - 2 * o.inset)); side >= minSide; side -= 2) {
    const rect = { x: Math.round(o.inset), y: Math.round(H - o.inset - side), w: side, h: side };
    if (rect.y >= 0 && !collisions(rect, protectedOnly, o.margin).length) return { ok: true, mode: 'corner', rect, margin: o.margin, canvasHeight: H };
  }

  if (i.allowStrip === false) return fail('no-safe-area', 'The lower-left corner of this frame is taken and the frame has no QR-safe area. Add one (FrameDef.qr) instead of placing the QR on the design.');

  // Strip: below EVERYTHING that is on the paper, including a sticker that hangs past the bottom edge. Nothing above moves.
  const side = Math.min(wanted, Math.floor(W - 2 * o.margin));
  if (side < minSide) return fail('too-small', 'The paper is too narrow for a scannable QR.');
  const pad = o.margin + 4;
  const top = Math.max(H, ...occupied.map((r) => r.rect.y + r.rect.h)) + o.margin;
  const rect = { x: Math.round((W - side) / 2), y: Math.round(top + pad), w: side, h: side };
  const hits = collisions(rect, occupied, o.margin);
  if (hits.length) return fail('overlap', 'The QR would touch the design.', hits); // cannot happen by construction; kept as a guard
  return { ok: true, mode: 'strip', rect, margin: o.margin, canvasHeight: rect.y + rect.h + pad };

}

/**
 * Editor/drag guard: may a QR of this box sit here? (the QR is placed by the system today; this is the single check any
 * future drag or resize handler must call, and the export gate uses the same rule.)
 */
export function canPlaceQr(rect: Rect, occ: OccupancyInput, canvas: { w: number; h: number }, margin = DEFAULT_QR_OPTIONS.margin): { ok: boolean; hits: Occupied[] } {
  if (!within(rect, { x: 0, y: 0, w: canvas.w, h: canvas.h })) return { ok: false, hits: [] };
  const hits = collisions(rect, occupiedRegions(occ), margin);
  return { ok: hits.length === 0, hits };
}

/* ---------- pixel backstop ---------- */

/**
 * Final guard on the REAL rendered pixels (artwork, text, stickers, everything but the QR): the QR box + margin must be one
 * flat colour. Catches what geometry cannot see (bitmap artwork, a declared safe area that is not really empty).
 * `tolerance` is the largest per-channel difference from the first pixel that still counts as "the same flat colour".
 */
export function regionIsClear(img: { data: ArrayLike<number>; width: number; height: number }, r: Rect, tolerance = 28): boolean {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(img.width, Math.ceil(r.x + r.w)), y1 = Math.min(img.height, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return false;
  const at = (x: number, y: number) => (y * img.width + x) * 4, d = img.data, b = at(x0, y0);
  const ref = [d[b], d[b + 1], d[b + 2]];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = at(x, y);
    if (Math.abs(d[p] - ref[0]) > tolerance || Math.abs(d[p + 1] - ref[1]) > tolerance || Math.abs(d[p + 2] - ref[2]) > tolerance) return false;
  }
  return true;
}
