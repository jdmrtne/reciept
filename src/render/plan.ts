import type { Prim } from '../frames/types';
import type { FrameCtx } from '../frames/types';
import type { Rect } from '../layouts/types';
import type { Snapshot } from '../editor/types';
import { isPhoto, isSticker } from '../editor/types';
import { getFrame, resolveFramed, vectorFrameOf } from '../frames/registry';
import { getFrameAsset, type AssetFit } from '../frames/assets';
import { framePrims } from '../frames/prims';
import { photoRect } from '../editor/model';
import { occupiedRegions, placeQr, qrAreaFor, collisions, within, cutBand, overlaps, inflate, rotatedBounds, CUT_SW, QrPlacementError, type Occupied, type OccupancyInput, type QrOptions } from '../qr/placement';
import { infoBlock, INFO_PAD_BOTTOM, infoItems, layoutInfo, type InfoLine } from './info';

/** Editor/layout units: everything in a Snapshot lives on a 384-unit-wide canvas (58mm @203dpi). */
export const UNITS_W = 384;

export type Cmd =
  | { op: 'photo'; src: string; iw: number; ih: number; slot: Rect; img: Rect; filterId: string; noBorder?: true }
  | { op: 'frame'; prims: Prim[] }
  | { op: 'image-frame'; src: string; fit: AssetFit; w: number; h: number } // PNG overlay over the whole canvas (units); transparent windows show the photos
  | { op: 'sticker'; stickerId: string; cx: number; cy: number; w: number; h: number; rotation: number }
  // EP-2 receipt info block: the owner's event text, BELOW the frame canvas (and below any sticker hanging past it), full paper width. Frame-independent:
  // every frame gets the same block, minus whatever that frame already prints (FramePrints). Built BEFORE the QR is placed, so the QR strip starts below it.
  | { op: 'info'; rect: Rect; prims: Prim[]; lines: InfoLine[] }
  // The page QR. ALWAYS the last command, and only present when the caller asked for one. `slots` = every photo slot (kept so the plan can be
  // re-verified on its own); `rect` was chosen by qr/placement.ts so it touches nothing (see verifyPlanQr).
  | { op: 'qr'; matrix: boolean[][]; rect: Rect; margin: number; mode: 'safe-area' | 'strip'; slots: Rect[]; /** height of the design alone (frame + info block when there is one), before any strip */ designHeight: number; /** present only with an info block: the frame canvas height the placement geometry was measured against */ frameHeight?: number; /** strip mode: y (units) of the dashed cut line between the design and the QR */ cutY?: number };

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
  // EP-2 info block: below the frame canvas and below any sticker that hangs past it, still BEFORE the QR so the design height is final when the QR is placed.
  const stickerBottom = Math.max(0, ...cmds.flatMap((c) => (c.op === 'sticker' ? [rotatedBounds({ x: c.cx - c.w / 2, y: c.cy - c.h / 2, w: c.w, h: c.h, rotation: c.rotation })] : [])).map((r) => r.y + r.h));
  const prints = asset ? undefined : vectorFrameOf(frame).prints; // an image frame prints no text; a vector fallback only counts while it is what is drawn
  const info = !infoBlock.on || (frame.noInfo && asset) ? null : layoutInfo(infoItems(ctx, prints), L.width, Math.max(L.height, stickerBottom)); // locked-family art carries its own text
  if (info) cmds.push({ op: 'info', rect: info.rect, prims: info.prims, lines: info.lines });
  const designHeight = info ? info.rect.y + info.rect.h : L.height;
  let unitsH = designHeight + (info ? INFO_PAD_BOTTOM : 0); // no QR: a little paper under the last line
  if (qr) {
    // Occupancy is measured against the FRAME canvas (L.height) exactly as before; the info text is part of `cmds`, so the QR also keeps clear of it.
    const placed = placeQr({ modules: qr.matrix.length, occ: occupancy(L.width, L.height, L.slots, cmds, !!asset), area: qrAreaFor(frame, snap.layoutId), allowStrip: qr.allowStrip, options: qr.options, paperDots: qr.paperDots });
    if (!placed.ok) throw new QrPlacementError(placed.reason, placed.message, placed.hits);
    cmds.push({ op: 'qr', matrix: qr.matrix, rect: placed.rect, margin: placed.margin, mode: placed.mode, slots: L.slots, designHeight, ...(info ? { frameHeight: L.height } : {}), ...(placed.cutY !== undefined ? { cutY: placed.cutY } : {}) });
    unitsH = Math.max(placed.canvasHeight, unitsH); // strip mode: the strip's own padding; safe-area mode: never shorter than the design incl. the info block
  }
  return { width: Math.round(widthPx), height: Math.round(unitsH * k), k, unitsW: L.width, unitsH, cmds };
}

/** What is on the paper, read straight from the plan's own commands (so the check cannot drift from what is drawn). */
function occupancy(width: number, height: number, slots: Rect[], cmds: Cmd[], artwork: boolean): OccupancyInput {
  return {
    width, height, slots, artwork,
    stickers: cmds.flatMap((c) => (c.op === 'sticker' ? [{ x: c.cx - c.w / 2, y: c.cy - c.h / 2, w: c.w, h: c.h, rotation: c.rotation }] : [])),
    prims: cmds.flatMap((c) => (c.op === 'frame' || c.op === 'info' ? c.prims : []))
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
  const occ = occupancy(plan.unitsW, q.frameHeight ?? q.designHeight, q.slots, plan.cmds, img);
  if (!within(q.rect, { x: 0, y: 0, w: plan.unitsW, h: plan.unitsH })) return { ok: false, hits: [] };
  const regions = occupiedRegions(occ);
  const hits = collisions(q.rect, regions, q.margin);
  if (q.cutY !== undefined) { // the cut line + scissors must sit on empty paper, and the QR must be clear of the line
    const band = cutBand(q.cutY, plan.unitsW);
    const line = { x: 0, y: q.cutY - CUT_SW / 2, w: plan.unitsW, h: CUT_SW };
    if (!within(band, { x: 0, y: 0, w: plan.unitsW, h: plan.unitsH })) return { ok: false, hits: [] };
    hits.push(...regions.filter((o) => overlaps(band, o.rect)));
    if (overlaps(inflate(q.rect, q.margin), line)) return { ok: false, hits };
  }
  return hits.length ? { ok: false, hits } : { ok: true };
}
