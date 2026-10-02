import type { Prim } from '../frames/types';
import type { FrameCtx } from '../frames/types';
import type { Rect } from '../layouts/types';
import type { Snapshot } from '../editor/types';
import { isPhoto, isSticker } from '../editor/types';
import { getFrame, resolveFramed, vectorFrameOf } from '../frames/registry';
import { getFrameAsset, type AssetFit } from '../frames/assets';
import { framePrims } from '../frames/prims';
import { photoRect } from '../editor/model';
import { occupiedRegions, placeQr, qrAreaFor, collisions, within, QrPlacementError, type Occupied, type OccupancyInput, type QrOptions } from '../qr/placement';

/** Editor/layout units: everything in a Snapshot lives on a 384-unit-wide canvas (58mm @203dpi). */
export const UNITS_W = 384;

export type Cmd =
  | { op: 'photo'; src: string; iw: number; ih: number; slot: Rect; img: Rect; filterId: string; noBorder?: true }
  | { op: 'frame'; prims: Prim[] }
  | { op: 'image-frame'; src: string; fit: AssetFit; w: number; h: number } // PNG overlay over the whole canvas (units); transparent windows show the photos
  | { op: 'sticker'; stickerId: string; cx: number; cy: number; w: number; h: number; rotation: number }
  // The page QR. ALWAYS the last command, and only present when the caller asked for one. `slots` = every photo slot (kept so the plan can be
  // re-verified on its own); `rect` was chosen by qr/placement.ts so it touches nothing (see verifyPlanQr).
  | { op: 'qr'; matrix: boolean[][]; rect: Rect; margin: number; mode: 'corner' | 'safe-area' | 'strip'; slots: Rect[]; /** height of the design alone, before any strip */ designHeight: number };

/**
 * PURE description of the final image: no DOM, no canvas. The canvas executor (render.ts) just runs it.
 * Order = the editor's draw order: white paper → photos (filter applies HERE only) → frame → stickers.
 * Editor-only overlays (selection outline, handle, swap highlight) never appear in a plan.
 */
export interface RenderPlan { width: number; height: number; k: number; unitsW: number; unitsH: number; cmds: Cmd[] }

/** Ask for a QR on the composition. Omit it and the plan is exactly what it always was. */
export interface PlanQr { matrix: boolean[][]; /** dots across the real paper; makes preview and print choose the same spot. Default 384. */ paperDots?: number; /** default true: reserve an empty strip below the design when the frame declares no safe area */ allowStrip?: boolean; options?: Partial<QrOptions> }

/**
 * With `qr`: throws QrPlacementError when no empty space exists (the export is blocked, the QR is never forced onto the design).
 * The design itself (photos, frame, stickers) is built exactly as without a QR; only the canvas may grow below it.
 */
export function buildPlan(snap: Snapshot, ctx: FrameCtx, widthPx: number, qr?: PlanQr): RenderPlan {
  const L = resolveFramed(snap.layoutId, snap.frameId); // 384-unit geometry, same as the editor
  const k = widthPx / UNITS_W;
  const cmds: Cmd[] = [];
  const frame = getFrame(snap.frameId), asset = getFrameAsset(frame, snap.layoutId); // same lookup the editor + thumbnails use
  for (const o of snap.objects.filter(isPhoto).filter((p) => p.visible).sort((a, b) => a.layer - b.layer))
    cmds.push({ op: 'photo', src: o.src, iw: o.iw, ih: o.ih, slot: { x: o.x, y: o.y, w: o.w, h: o.h }, img: photoRect(o), filterId: snap.filterId, ...(asset ? { noBorder: true as const } : {}) });
  if (asset) cmds.push({ op: 'image-frame', src: asset.src, fit: asset.fit, w: L.width, h: L.height }); // artwork supplies the window edge
  else cmds.push({ op: 'frame', prims: framePrims(vectorFrameOf(frame), L, ctx) });
  for (const o of snap.objects.filter(isSticker).filter((s) => s.visible).sort((a, b) => a.layer - b.layer))
    cmds.push({ op: 'sticker', stickerId: o.stickerId, cx: o.x + o.w / 2, cy: o.y + o.h / 2, w: o.w, h: o.h, rotation: o.rotation });
  let unitsH = L.height;
  if (qr) {
    const placed = placeQr({ modules: qr.matrix.length, occ: occupancy(L.width, L.height, L.slots, cmds, !!asset), area: qrAreaFor(frame, snap.layoutId), allowStrip: qr.allowStrip, options: qr.options, paperDots: qr.paperDots });
    if (!placed.ok) throw new QrPlacementError(placed.reason, placed.message, placed.hits);
    cmds.push({ op: 'qr', matrix: qr.matrix, rect: placed.rect, margin: placed.margin, mode: placed.mode, slots: L.slots, designHeight: L.height });
    unitsH = placed.canvasHeight;
  }
  return { width: Math.round(widthPx), height: Math.round(unitsH * k), k, unitsW: L.width, unitsH, cmds };
}

/** What is on the paper, read straight from the plan's own commands (so the check cannot drift from what is drawn). */
function occupancy(width: number, height: number, slots: Rect[], cmds: Cmd[], artwork: boolean): OccupancyInput {
  return {
    width, height, slots, artwork,
    stickers: cmds.flatMap((c) => (c.op === 'sticker' ? [{ x: c.cx - c.w / 2, y: c.cy - c.h / 2, w: c.w, h: c.h, rotation: c.rotation }] : [])),
    prims: cmds.flatMap((c) => (c.op === 'frame' ? c.prims : []))
  };
}

/**
 * Final collision check on a FINISHED plan (the export gate). Independent of how the QR was placed: it re-reads the photo slots,
 * stickers and frame primitives from the plan and requires the QR box, grown by its margin, to touch none of them and to lie on the canvas.
 * Plans without a QR pass trivially.
 */
export function verifyPlanQr(plan: RenderPlan): { ok: true } | { ok: false; hits: Occupied[] } {
  const q = plan.cmds.find((c): c is Extract<Cmd, { op: 'qr' }> => c.op === 'qr');
  if (!q) return { ok: true };
  const img = plan.cmds.some((c) => c.op === 'image-frame');
  const occ = occupancy(plan.unitsW, q.designHeight, q.slots, plan.cmds, img);
  if (!within(q.rect, { x: 0, y: 0, w: plan.unitsW, h: plan.unitsH })) return { ok: false, hits: [] };
  const all = occupiedRegions(occ), hits = collisions(q.rect, q.mode === 'corner' ? all.filter((r) => r.kind === 'photo' || r.kind === 'sticker' || r.kind === 'text') : all, q.margin);
  return hits.length ? { ok: false, hits } : { ok: true };
}
