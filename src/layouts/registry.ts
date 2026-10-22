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

export const getLayout = (id: string | null): LayoutDef => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
