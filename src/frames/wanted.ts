import type { PathCmd, Prim } from './types';
import type { FrameCtx, } from './types';
import type { Rect, ResolvedLayout } from '../layouts/types';
import { tornRect } from './art';

/**
 * "STRAW HAT WANTED": a full-colour parchment poster drawn AROUND whatever photo slots the selected layout resolved.
 * The parchment is one even-odd path (poster outline minus one hole per slot), so nothing is baked in behind the photos:
 * they stay full colour and the crop/zoom/filter/sticker/GIF/export paths need no special case.
 * Everything is deterministic (no Math.random) so editor, preview and print match.
 */
const REF = 384;
const PAPER = '#e8d3a4', EDGE = '#7a5530', INK = '#3b2114';

const rnd = (n: number) => { let h = Math.imul(n ^ 0x9e3779b9, 2654435761); h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return (h >>> 0) / 4294967295; };

const rectCmds = (x: number, y: number, w: number, h: number): PathCmd[] =>
  [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];

/** Distance from a point to the nearest slot edge (0 when inside a slot). */
const distToSlots = (slots: Rect[], x: number, y: number) =>
  Math.min(...slots.map((s) => Math.hypot(Math.max(s.x - x, 0, x - (s.x + s.w)), Math.max(s.y - y, 0, y - (s.y + s.h)))), 1e9);

/** Vertical curly scroll in a 40×100 box, mapped onto (x0,y0,w,h); mirrored for the right side. */
function scroll(x0: number, y0: number, w: number, h: number, mirror: boolean, sw: number): Prim[] {
  const P = (x: number, y: number): [number, number] => [x0 + (mirror ? 40 - x : x) * (w / 40), y0 + y * (h / 100)];
  const C = (a: number[]): PathCmd => ['C', ...P(a[0], a[1]), ...P(a[2], a[3]), ...P(a[4], a[5])] as PathCmd;
  const M = (x: number, y: number): PathCmd => ['M', ...P(x, y)] as PathCmd;
  return [
    [M(26, 4), C([6, 14, 6, 40, 22, 52]), C([36, 64, 34, 84, 12, 96])],
    [M(26, 4), C([36, 0, 40, 14, 30, 16])],
    [M(12, 96), C([2, 100, 0, 88, 9, 86])],
    [M(22, 52), C([12, 50, 10, 40, 18, 38])]
  ].map((cmds) => ({ k: 'path', cmds, stroke: INK, sw }));
}

export function wantedPrims(L: ResolvedLayout, _ctx: FrameCtx): Prim[] {
  const k = L.width / REF, W = L.width, H = L.height, out: Prim[] = [];
  const slots = L.slots;
  const ex = 2.5 * k;
  const outline = tornRect(ex, ex, W - 2 * ex, H - 2 * ex, 8 * k, 2.4 * k, 11);

  // 1. Parchment sheet with a hole per photo slot.
  out.push({ k: 'path', cmds: [...outline, ...slots.flatMap((s) => rectCmds(s.x, s.y, s.w, s.h))], fill: PAPER, stroke: 'none', eo: true });

  // 2. Aged edges: two stepped darker rings hugging the torn outline (never reach the slots: layout padding ≥ 24).
  for (const [inset, a] of [[10, 0.09], [5, 0.12]] as const) {
    const i = inset * k;
    out.push({ k: 'path', cmds: [...outline, ...rectCmds(i, i, W - 2 * i, H - 2 * i)], fill: `rgba(120,80,30,${a})`, stroke: 'none', eo: true });
  }

  // 3. Mottling and stains, kept clear of the photos.
  for (let i = 0; i < 70; i++) {
    const r = (5 + rnd(i * 7 + 3) * 16) * k;
    const x = r + 6 * k + rnd(i * 7 + 1) * (W - 2 * r - 12 * k), y = r + 6 * k + rnd(i * 7 + 2) * (H - 2 * r - 12 * k);
    if (distToSlots(slots, x, y) < r + 3 * k) continue;
    out.push({ k: 'circle', cx: x, cy: y, r, fill: i % 3 ? 'rgba(140,95,40,0.06)' : 'rgba(255,244,214,0.14)' });
  }
  for (let i = 0; i < 80; i++) {
    const x = 8 * k + rnd(i * 5 + 501) * (W - 16 * k), y = 8 * k + rnd(i * 5 + 502) * (H - 16 * k), r = (0.5 + rnd(i * 5 + 503) * 1.1) * k;
    if (distToSlots(slots, x, y) < r + 2 * k) continue;
    out.push({ k: 'circle', cx: x, cy: y, r, fill: 'rgba(90,55,20,0.32)' });
  }
  out.push({ k: 'path', cmds: outline, stroke: EDGE, sw: 1.4 * k });

  // 4. Photo borders, inked over the layout's own 2-unit black slot line.
  for (const s of slots) {
    out.push({ k: 'rect', x: s.x, y: s.y, w: s.w, h: s.h, stroke: INK, sw: 3 * k });
    out.push({ k: 'rect', x: s.x - 6 * k, y: s.y - 6 * k, w: s.w + 12 * k, h: s.h + 12 * k, stroke: 'rgba(59,33,20,0.55)', sw: 1 * k });
  }

  const text = (t: string, x: number, cy: number, size: number, fit: number, font?: 'display', extra: Partial<Extract<Prim, { k: 'text' }>> = {}): Prim =>
    ({ k: 'text', text: t, x, y: cy + size * 0.35, size, weight: 400, anchor: 'start', ls: 0, c: INK, font, fit, ...extra });
  const speckle = (x: number, y: number, w: number, h: number, n: number, seed: number) => {
    for (let i = 0; i < n; i++)
      out.push({ k: 'circle', cx: x + rnd(seed + i * 3) * w, cy: y + rnd(seed + i * 3 + 1) * h, r: (0.4 + rnd(seed + i * 3 + 2) * 0.9) * k, fill: PAPER });
  };

  // 5. Header: WANTED
  const h = L.header;
  if (h) {
    const size = h.h * 0.8;
    out.push(text('WANTED', h.x, h.y + h.h * 0.5, size, h.w, 'display'));
    speckle(h.x, h.y + h.h * 0.1, h.w, h.h * 0.8, 70, 9001);
  }

  // 6. Footer: scrollwork, DEAD OR ALIVE, STRAW HAT CREW, bounty, small print, MARINE
  const f = L.footer;
  if (f) {
    const m = 24 * k, tx = f.x + m, tw = f.w - 2 * m, at = (fr: number) => f.y + f.h * fr;
    out.push(...scroll(f.x, f.y, 20 * k, f.h, false, 2 * k), ...scroll(f.x + f.w - 20 * k, f.y, 20 * k, f.h, true, 2 * k));
    out.push(text('DEAD OR ALIVE', tx, at(0.1), 21 * k, tw, 'display'));
    out.push(text('STRAW HAT CREW', tx, at(0.37), 50 * k, tw, 'display'));
    speckle(tx, at(0.02), tw, f.h * 0.5, 45, 7001);
    // bounty: berry mark (B struck through twice) + amount
    const by = at(0.65), bx = tx + 2 * k;
    out.push(text('B', bx, by, 26 * k, 17 * k, 'display'));
    for (const dx of [6, 11]) out.push({ k: 'line', x1: bx + dx * k, y1: by - 12 * k, x2: bx + dx * k, y2: by + 12 * k, sw: 1.5 * k, c: INK });
    out.push(text('300,000,000-', bx + 24 * k, by, 24 * k, tw - 26 * k, undefined, { weight: 400 }));
    // small print + MARINE
    const sp = (t: string, fr: number): Prim => text(t, tx, at(fr), 5 * k, 145 * k);
    out.push(sp('THIS IS A WORK OF FICTION. ANY RESEMBLANCE', 0.85), sp('TO REAL PEOPLE OR GROUPS IS COINCIDENCE.', 0.92));
    out.push(text('MARINE', tx + tw - 100 * k, at(0.87), 30 * k, 100 * k, 'display'));
  }
  return out;
}
