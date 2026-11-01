/**
 * Photo filters as DATA. Every filter is a set of simple params that compile to ONE 4×5 colour matrix
 * (same layout as SVG <feColorMatrix type="matrix">). The editor draws the matrix through an SVG filter,
 * the Phase 8 renderer/print pipeline runs `applyFilter` on canvas pixels — both use the SAME matrix,
 * so screen and print always match. Filters only ever apply to photos and never touch the source blob.
 * Add a filter = add an entry to FILTERS.
 */
export interface FilterParams {
  gray?: number;       // 0..1  desaturate (1 = full grayscale, Rec.601 luma)
  sepia?: number;      // 0..1  warm tone
  contrast?: number;   // 1 = unchanged, pivots around mid-gray
  brightness?: number; // 1 = unchanged (multiplier)
  lift?: number;       // 0..1  raise the black point (faded look)
}
export interface FilterDef { id: string; name: string; params: FilterParams }

export const FILTERS: FilterDef[] = [
  { id: 'original', name: 'Original', params: {} },
  { id: 'grayscale', name: 'Grayscale', params: { gray: 1 } },
  { id: 'high-contrast', name: 'High Contrast', params: { gray: 1, contrast: 1.65, brightness: 1.02 } },
  { id: 'vintage', name: 'Vintage', params: { gray: 0.55, sepia: 0.5, contrast: 0.9, brightness: 1.05, lift: 0.07 } },
  { id: 'soft', name: 'Soft', params: { gray: 0.2, contrast: 0.82, brightness: 1.1, lift: 0.05 } }
];
export const DEFAULT_FILTER = 'original';
export const getFilter = (id: string | null | undefined): FilterDef => FILTERS.find((f) => f.id === id) ?? FILTERS[0];

/** 4 rows × 5 columns (R,G,B,A, offset), values in 0..1 like feColorMatrix. */
export type Matrix = number[];
export const IDENTITY: Matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

/** Result of applying `a` first, then `b`. */
function mul(b: Matrix, a: Matrix): Matrix {
  const out: number[] = [];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 5; j++) {
      let s = j === 4 ? b[i * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) s += b[i * 5 + k] * a[k * 5 + j];
      out.push(s);
    }
  return out;
}
const mix = (a: Matrix, b: Matrix, t: number): Matrix => a.map((v, i) => v * (1 - t) + b[i] * t);
const rgb = (r: number[], g: number[], b: number[]): Matrix => [...r, 0, 0, ...g, 0, 0, ...b, 0, 0, 0, 0, 0, 1, 0]; // each row: R,G,B,A,offset
const LUMA: Matrix = rgb([.299, .587, .114], [.299, .587, .114], [.299, .587, .114]);
const SEPIA: Matrix = rgb([.393, .769, .189], [.349, .686, .168], [.272, .534, .131]);
const scale = (k: number, off = 0): Matrix => [k, 0, 0, 0, off, 0, k, 0, 0, off, 0, 0, k, 0, off, 0, 0, 0, 1, 0];

const r = (n: number) => Math.round(n * 1e5) / 1e5;
export function filterMatrix(p: FilterParams): Matrix {
  let m = IDENTITY;
  if (p.gray) m = mul(mix(IDENTITY, LUMA, Math.min(1, p.gray)), m);
  if (p.sepia) m = mul(mix(IDENTITY, SEPIA, Math.min(1, p.sepia)), m);
  if (p.contrast !== undefined && p.contrast !== 1) m = mul(scale(p.contrast, 0.5 - 0.5 * p.contrast), m);
  if (p.brightness !== undefined && p.brightness !== 1) m = mul(scale(p.brightness), m);
  if (p.lift) m = mul(scale(1 - p.lift, p.lift), m);
  return m.map(r);
}

/** Renderer/print: apply a filter to RGBA pixels IN PLACE (canvas ImageData). Alpha is untouched. */
export function applyFilter(data: Uint8ClampedArray, filterId: string): void {
  const f = getFilter(filterId);
  if (f.id === 'original') return;
  const m = filterMatrix(f.params);
  for (let i = 0; i < data.length; i += 4) {
    const R = data[i] / 255, G = data[i + 1] / 255, B = data[i + 2] / 255;
    data[i] = (m[0] * R + m[1] * G + m[2] * B + m[4]) * 255;     // Uint8ClampedArray clamps + rounds
    data[i + 1] = (m[5] * R + m[6] * G + m[7] * B + m[9]) * 255;
    data[i + 2] = (m[10] * R + m[11] * G + m[12] * B + m[14]) * 255;
  }
}
