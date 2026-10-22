import type { LayoutDef } from './types';
import { TICKET_DEFAULTS, TICKET_FRAME_ID } from '../ticket/config';
import { TICKET_TEMPLATES, buildTicket } from '../ticket/layout';

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
 * Landscape event tickets: `manual` arrangements whose slots come from the ONE ticket renderer (ticket/layout.ts), so the picker
 * thumbnail, the editor, the preview and the print all use the same windows. Canvas = 384 units wide x TICKET_UNITS_H tall (width > height).
 */
for (const t of TICKET_TEMPLATES) {
  const b = buildTicket(t.id, TICKET_DEFAULTS);
  LAYOUTS.push({ ...base, id: t.id, name: t.name, frame: TICKET_FRAME_ID, padding: 0, gap: 0,
    arrangement: { kind: 'manual', heightRatio: b.H / b.W, slots: b.slots.map((s) => ({ x: s.x / b.W, y: s.y / b.W, w: s.w / b.W, h: s.h / b.W })) } });
}

export const getLayout = (id: string | null): LayoutDef => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
