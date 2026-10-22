import type { LayoutDef, Rect, ResolvedLayout } from './types';

export const PAPER_DOTS = { 58: 384, 80: 576 } as const; // printable dots @203dpi (approx.)
const REF = 384;

/** Pure function: layout data + target width in pixels → concrete geometry. No UI, no DOM. */
export function resolveLayout(def: LayoutDef, width: number = REF, over?: { headerHeight?: number; footerHeight?: number; padding?: number }): ResolvedLayout {
  const k = width / REF;
  const pad = (over?.padding ?? def.padding) * k, gap = def.gap * k;
  const headerH = (over?.headerHeight ?? def.headerHeight) * k, footerH = (over?.footerHeight ?? def.footerHeight) * k;
  const a = def.arrangement;
  let slots: Rect[] = [];
  let height: number;

  if (a.kind === 'grid') {
    const innerW = width - 2 * pad;
    const w = (innerW - gap * (a.columns - 1)) / a.columns;
    const h = w / a.slotAspect;
    const top = pad + headerH + (headerH ? gap : 0);
    for (let r = 0; r < a.rows; r++)
      for (let c = 0; c < a.columns; c++) slots.push({ x: pad + c * (w + gap), y: top + r * (h + gap), w, h });
    const gridBottom = top + a.rows * h + (a.rows - 1) * gap;
    height = gridBottom + (footerH ? gap : 0) + footerH + pad;
  } else {
    slots = a.slots.map((s) => ({ x: s.x * width, y: s.y * width, w: s.w * width, h: s.h * width }));
    height = a.heightRatio * width;
  }

  const r = Math.round;
  const round = (s: Rect): Rect => ({ x: r(s.x), y: r(s.y), w: r(s.w), h: r(s.h) });
  height = r(height);
  return {
    id: def.id, width, height,
    slots: slots.map(round),
    header: headerH ? round({ x: pad, y: pad, w: width - 2 * pad, h: headerH }) : null,
    footer: footerH ? round({ x: pad, y: height - pad - footerH, w: width - 2 * pad, h: footerH }) : null,
    border: def.border * k, background: def.background
  };
}

export const slotCount = (def: LayoutDef) => resolveLayout(def).slots.length;
