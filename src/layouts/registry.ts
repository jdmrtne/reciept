import type { LayoutDef } from './types';

const base = { padding: 24, gap: 16, border: 0, headerHeight: 0, footerHeight: 0, background: '#fff' as const };
const strip = (n: number, id: string, name: string): LayoutDef =>
  ({ ...base, id, name, arrangement: { kind: 'grid', columns: 1, rows: n, slotAspect: 4 / 3 } });

/** Add a layout = add an entry here. The editor/renderer only consume ResolvedLayout. */
export const LAYOUTS: LayoutDef[] = [
  { ...base, id: 'single', name: 'Single', arrangement: { kind: 'grid', columns: 1, rows: 1, slotAspect: 4 / 5 } },
  strip(2, 'strip-2', 'Two Strip'),
  strip(3, 'strip-3', 'Three Strip'),
  strip(4, 'strip-4', 'Four Strip'),
  { ...base, id: 'grid-2x2', name: '2 × 2', arrangement: { kind: 'grid', columns: 2, rows: 2, slotAspect: 1 } },
  { ...base, id: 'classic', name: 'Classic', border: 3, headerHeight: 56, footerHeight: 72,
    arrangement: { kind: 'grid', columns: 1, rows: 4, slotAspect: 4 / 3 } }
];

/**
 * NCL boarding-pass family (frame 'ncl-boarding-pass', art in src/assets/frames/ncl-boarding-pass/<id>.png). Measured from the reference tickets
 * (design-src/ncl-boarding-pass/, scripts/build-ncl-pass.py prints these numbers). The ticket prints SIDEWAYS along the roll (rotated 90° clockwise),
 * so a ticket-portrait box is a landscape slot on the paper. Slots are in layout units @384 (written /384 because manual slots are fractions of the
 * canvas width); heightRatio = art height / art width (1152 px wide art, 3 px per unit). Photos are rotated 90° on placement (photoRotation).
 */
const U = (n: number) => n / 384;
const pass = (id: string, name: string, art: number, slots: [number, number, number, number][]): LayoutDef => ({
  ...base, id, name, photoRotation: 90,
  arrangement: { kind: 'manual', heightRatio: art / 1152, slots: slots.map(([x, y, w, h]) => ({ x: U(x), y: U(y), w: U(w), h: U(h) })) }
});
export const PASS_LAYOUTS: LayoutDef[] = [
  pass('pass-1', 'NCL Pass 1', 2839, [[85, 380, 237, 178]]),
  pass('pass-2', 'NCL Pass 2', 3108, [[85, 320, 237, 178], [85, 511, 237, 178]]),
  pass('pass-3', 'NCL Pass 3', 3521, [[85, 295, 237, 178], [85, 482, 237, 178], [85, 668, 237, 178]]),
  pass('pass-4', 'NCL Pass 4', 2745, [[160, 20, 126, 165], [160, 192, 126, 163], [160, 363, 126, 161], [160, 532, 126, 152]])
];
LAYOUTS.push(...PASS_LAYOUTS);
/** The layouts every ordinary frame works with (everything except the frame-locked ones above). */
export const STANDARD_LAYOUTS: LayoutDef[] = LAYOUTS.filter((l) => !PASS_LAYOUTS.includes(l));

export const getLayout = (id: string | null): LayoutDef => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
