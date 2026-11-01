import type { FrameCtx, FramePrints, Prim } from '../frames/types';
import type { Rect } from '../layouts/types';
import { DEFAULT_BRANDING_TEXT, DEFAULT_EVENT_NAME, EVENT_LIMITS, finalText } from '../config/events';

/**
 * RECEIPT INFO BLOCK (EP-2). PURE: no DOM, no canvas. One block of owner-configured text that sits BELOW the finished frame, so it works
 * the same for every vector frame and every PNG frame (which have no text of their own) and never touches their artwork.
 *
 * What it prints (top to bottom, an item is skipped when it is empty or when the DRAWN frame already prints it, see FramePrints):
 *   event name, header, up to 3 detail lines, "date  time" (session stamp), thank-you, branding.
 * Without `ctx.info` nothing is printed and the plan is exactly what it was before EP-2.
 *
 * Text rules (documented in docs/PRINTING.md):
 *  - All text goes through `finalText` again (EP-1 sanitiser), so a character the bundled Latin font cannot draw (emoji, CJK, control,
 *    zero-width) never reaches the canvas, even if a caller hands in an unsanitised profile. Removed, not substituted.
 *  - A line is never wrapped. It shrinks (size and letter spacing together) to fit the safe width, never below INFO_MIN_SIZE reference
 *    dots (the project's thermal-legibility floor). EP-1 caps every line at 40 characters, which fits at that floor on a 384-unit paper,
 *    so truncation ("...") is only a last resort for hand-built input.
 *  - Units are the editor's 384-unit space (reference dots at 58 mm); the renderer scales them like everything else.
 */

/** Smallest text size (reference dots @58mm) the block may use. Same floor the project set for thermal text (docs/PHASES.md EP-2). */
export const INFO_MIN_SIZE = 9;
/** Empty paper kept left and right of the text (units). */
export const INFO_INSET = 12;
/** Empty paper left under the last line when the paper ends there (no QR strip; the strip brings its own padding) (units). */
export const INFO_PAD_BOTTOM = 8;
/** Empty paper between the bottom of the design (frame, or a sticker hanging below it) and the first line (units). */
export const INFO_GAP_TOP = 10;
/**
 * Glyph width / font size assumed when fitting. Courier Prime advances 0.6 em; the QR occupancy check (qr/placement.ts) assumes 0.62, and the
 * block fits against the larger value so the occupancy rectangle of every line is also inside the safe width.
 */
const GLYPH = 0.62;

export type InfoKind = 'event' | 'header' | 'detail' | 'datetime' | 'thanks' | 'brand';
export interface InfoItem { kind: InfoKind; text: string }
/** One laid-out line: the text actually drawn (after fitting) and the style it is drawn with. */
export interface InfoLine extends InfoItem { size: number; ls: number; weight: 400 | 700; y: number }
export interface InfoBlock { rect: Rect; prims: Prim[]; lines: InfoLine[] }

/** Base style per kind: size (reference dots), weight, letter spacing. Fitting may shrink size and spacing, never below INFO_MIN_SIZE. */
const STYLE: Record<InfoKind, { size: number; weight: 400 | 700; ls: number }> = {
  event: { size: 16, weight: 700, ls: 2 },
  header: { size: 13, weight: 700, ls: 1 },
  detail: { size: 11, weight: 400, ls: 1 },
  datetime: { size: 11, weight: 400, ls: 2 },
  thanks: { size: 12, weight: 700, ls: 2 },
  brand: { size: 10, weight: 400, ls: 1 }
};
/** Lines in the same group sit close together, groups are separated a little more. */
const GROUP: Record<InfoKind, number> = { event: 0, header: 0, detail: 1, datetime: 2, thanks: 3, brand: 4 };

const DATE_RE = /^\d{4}\.\d{2}\.\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * WHAT to print. `prints` = what the drawn frame already supplies (FramePrints); those items are left out here, which is the one place
 * duplicate prevention happens. A stamp field that is not a real date/time (a damaged legacy value) is skipped instead of printing garbage.
 */
/**
 * Master switch for the receipt info block (event name, date/time, thank-you, branding line) printed BELOW every frame.
 * OFF: no frame gets text under it any more (what a frame draws inside its own design is unchanged, and the frame-locked NCL
 * passes never had a block). Set `infoBlock.on = true` (or change the default above) to bring the block back; tests that exercise the block flip it; info.ts, the event profiles and their ADMIN fields are untouched.
 */
export const infoBlock = { on: false };

export function infoItems(ctx: FrameCtx, prints: FramePrints = {}): InfoItem[] {
  const p = ctx.info;
  if (!p) return [];
  const out: InfoItem[] = [];
  const add = (kind: InfoKind, raw: unknown) => { const text = finalText(raw); if (text) out.push({ kind, text }); };
  if (!prints.event) add('event', p.name || DEFAULT_EVENT_NAME);
  add('header', p.header);
  for (const d of (Array.isArray(p.details) ? p.details : []).slice(0, EVENT_LIMITS.detailLines)) add('detail', d);
  const stamp = [!prints.date && DATE_RE.test(ctx.date) ? ctx.date : '', !prints.time && TIME_RE.test(ctx.time) ? ctx.time : ''].filter(Boolean).join('  ');
  if (stamp) out.push({ kind: 'datetime', text: stamp });
  if (!prints.thankYou) add('thanks', p.thankYou);
  if (p.brandingEnabled) add('brand', p.brandingText || DEFAULT_BRANDING_TEXT);
  return out;
}

const textWidth = (n: number, size: number, ls: number) => n * (GLYPH * size + ls);

/** Shrink to fit `avail` units (never below INFO_MIN_SIZE); as a last resort truncate with "...". */
export function fitLine(text: string, base: { size: number; ls: number }, avail: number): { text: string; size: number; ls: number } {
  const n = [...text].length;
  let size = base.size, ls = base.ls;
  if (textWidth(n, size, ls) <= avail) return { text, size, ls };
  const f = avail / textWidth(n, size, ls);
  size = Math.max(INFO_MIN_SIZE, size * f); ls *= f;
  if (textWidth(n, size, ls) > avail) ls = 0;
  if (textWidth(n, size, ls) <= avail) return { text, size, ls };
  const chars = [...text], keep = Math.max(1, Math.floor(avail / (GLYPH * size)) - 3);
  return { text: chars.slice(0, keep).join('').trimEnd() + '...', size, ls: 0 };
}

/**
 * WHERE to print it: centered lines from `top` (units) down, inside `unitsW`. Each line owns the same vertical box the QR occupancy check
 * measures for text (from 0.9 size above the baseline to 0.3 size below), so the block's own geometry equals what placement sees.
 * Returns null when there is nothing to print.
 */
export function layoutInfo(items: InfoItem[], unitsW: number, top: number): InfoBlock | null {
  if (!items.length) return null;
  const avail = Math.max(1, unitsW - 2 * INFO_INSET);
  const lines: InfoLine[] = [], prims: Prim[] = [];
  let y = top + INFO_GAP_TOP, prev: InfoKind | null = null;
  for (const it of items) {
    const st = STYLE[it.kind], fit = fitLine(it.text, st, avail);
    if (prev) y += GROUP[prev] === GROUP[it.kind] ? 3 : 7;
    const baseline = y + 0.9 * fit.size;
    lines.push({ kind: it.kind, text: fit.text, size: fit.size, ls: fit.ls, weight: st.weight, y: baseline });
    prims.push({ k: 'text', x: unitsW / 2, y: baseline, text: fit.text, size: fit.size, weight: st.weight, anchor: 'middle', ls: fit.ls });
    y += 1.2 * fit.size;
    prev = it.kind;
  }
  return { rect: { x: 0, y: top, w: unitsW, h: y - top }, prims, lines };
}
