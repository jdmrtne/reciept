import type { Prim } from '../frames/types';
import type { FrameCtx } from '../frames/types';
import type { Rect } from '../layouts/types';
import type { Snapshot } from '../editor/types';
import { isPhoto, isSticker } from '../editor/types';
import { getFrame, resolveFramed } from '../frames/registry';
import { framePrims } from '../frames/prims';
import { photoRect } from '../editor/model';

/** Editor/layout units: everything in a Snapshot lives on a 384-unit-wide canvas (58mm @203dpi). */
export const UNITS_W = 384;

export type Cmd =
  | { op: 'photo'; src: string; iw: number; ih: number; slot: Rect; img: Rect; filterId: string }
  | { op: 'frame'; prims: Prim[] }
  | { op: 'sticker'; stickerId: string; cx: number; cy: number; w: number; h: number; rotation: number };

/**
 * PURE description of the final image: no DOM, no canvas. The canvas executor (render.ts) just runs it.
 * Order = the editor's draw order: white paper → photos (filter applies HERE only) → frame → stickers.
 * Editor-only overlays (selection outline, handle, swap highlight) never appear in a plan.
 */
export interface RenderPlan { width: number; height: number; k: number; unitsW: number; unitsH: number; cmds: Cmd[] }

export function buildPlan(snap: Snapshot, ctx: FrameCtx, widthPx: number): RenderPlan {
  const L = resolveFramed(snap.layoutId, snap.frameId); // 384-unit geometry, same as the editor
  const k = widthPx / UNITS_W;
  const cmds: Cmd[] = [];
  for (const o of snap.objects.filter(isPhoto).filter((p) => p.visible).sort((a, b) => a.layer - b.layer))
    cmds.push({ op: 'photo', src: o.src, iw: o.iw, ih: o.ih, slot: { x: o.x, y: o.y, w: o.w, h: o.h }, img: photoRect(o), filterId: snap.filterId });
  cmds.push({ op: 'frame', prims: framePrims(getFrame(snap.frameId), L, ctx) });
  for (const o of snap.objects.filter(isSticker).filter((s) => s.visible).sort((a, b) => a.layer - b.layer))
    cmds.push({ op: 'sticker', stickerId: o.stickerId, cx: o.x + o.w / 2, cy: o.y + o.h / 2, w: o.w, h: o.h, rotation: o.rotation });
  return { width: Math.round(widthPx), height: Math.round(L.height * k), k, unitsW: L.width, unitsH: L.height, cmds };
}
