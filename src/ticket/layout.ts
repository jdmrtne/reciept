import type { Prim } from '../frames/types';
import type { Rect } from '../layouts/types';
import { BARCODE_MODULE, TICKET_MIN_TEXT, TICKET_STUB_FRAC, TICKET_UNITS_H, TICKET_UNITS_W, type TicketInfo } from './config';
import { CODE128_QUIET, cleanBarcodeValue, code128Modules, code128Runs } from './code128';

/**
 * ONE reusable ticket renderer for all four templates (PURE: units in, Prim[] out; the editor, preview and print draw the same list).
 * Geometry never depends on the wording: `slots` and `qrArea` are fixed per template + canvas, so the layout registry can read them
 * statically; text only fills fixed boxes (it wraps or shrinks to fit, never below TICKET_MIN_TEXT, and is dropped before it overlaps).
 * Units are the editor's 384-wide space; the renderer scales them (x1.5 on 80mm paper).
 */
export type TicketId = 'ticket-4' | 'ticket-1' | 'ticket-2' | 'ticket-3';
export interface TicketTemplate {
  id: TicketId; name: string; photos: number;
  /** Compact tickets: width of the left info column and the right verse/brand column (units), and the photo window height / width ratio. The barcode runs along the bottom of the left + photo area. */
  left?: number; right?: number; ratio?: number;
}
export const TICKET_TEMPLATES: TicketTemplate[] = [
  { id: 'ticket-4', name: 'Classic Boarding Pass — 4 Photos', photos: 4 },
  { id: 'ticket-1', name: 'Compact Ticket — 1 Photo', photos: 1, left: 66, right: 60, ratio: 1.45 },
  { id: 'ticket-2', name: 'Double Ticket — 2 Photos', photos: 2, left: 66, right: 58, ratio: 1.8 },
  { id: 'ticket-3', name: 'Triple Ticket — 3 Photos', photos: 3, left: 66, right: 56, ratio: 2.2 }
];
export const getTicketTemplate = (id: string | null | undefined) => TICKET_TEMPLATES.find((t) => t.id === id) ?? null;
export const isTicketLayoutId = (id: string | null | undefined) => !!getTicketTemplate(id);

const CW = 0.6; // Courier Prime advance / font size
const M = 8; // outer content margin
const INK = 2; // main rule thickness (units; 3 dots on 80mm)
const tw = (n: number, size: number, ls = 0) => n * (CW * size + ls);
const len = (s: string) => [...s].length;

const text = (t: string, x: number, y: number, size: number, o: { w?: 400 | 700; a?: 'start' | 'middle' | 'end'; ls?: number; fit?: number } = {}): Prim =>
  ({ k: 'text', x, y, text: t, size, weight: o.w ?? 700, anchor: o.a ?? 'start', ls: o.ls ?? 0, ...(o.fit ? { fit: o.fit } : {}) });
const hline = (x1: number, x2: number, y: number, sw = INK, dash?: string): Prim => ({ k: 'line', x1, x2, y1: y, y2: y, sw, dash });
const DASH = '5 4';

/** Largest size <= `size` whose single line fits `avail` (never below TICKET_MIN_TEXT). */
const fitSize = (t: string, size: number, avail: number, ls = 0) => Math.max(TICKET_MIN_TEXT, Math.min(size, size * avail / Math.max(1, tw(len(t), size, ls))));

/** Line pitch for a text size: the glyph box (1.2 x size) so consecutive lines never touch. */
const lh = (size: number) => Math.ceil(size * 1.2);
/** One line that must fit `avail`: shrinks to the floor, then truncates with "..." (never overflows, never goes below the floor). */
export function oneLine(t: string, size: number, avail: number, ls = 0): { t: string; size: number } {
  const s = fitSize(t, size, avail, ls);
  if (tw(len(t), s, ls) <= avail + 1e-6) return { t, size: s };
  const keep = Math.max(1, Math.floor(avail / (CW * s + ls)) - 3);
  return { t: [...t].slice(0, keep).join('').trimEnd() + '...', size: s };
}
const one = (t: string, x: number, y: number, size: number, avail: number, o: Parameters<typeof text>[4] = {}): Prim => { const f = oneLine(t, size, avail, o.ls ?? 0); return text(f.t, x, y, f.size, o); };

/** Greedy word wrap to at most `maxLines` lines inside `avail`; shrinks to the floor, then truncates with "...". */
export function wrapLines(t: string, avail: number, size: number, maxLines: number, ls = 0): { lines: string[]; size: number } {
  const per = (s: number) => Math.max(1, Math.floor((avail + ls) / (CW * s + ls)));
  const words = t.split(/\s+/).filter(Boolean);
  for (let s = size; s >= TICKET_MIN_TEXT - 1e-6; s -= 0.5) {
    const sz = Math.max(TICKET_MIN_TEXT, s), n = per(sz), lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if (len(w) > n) { cur = ''; lines.length = maxLines + 1; break; } // a single word that cannot fit this size
      if (!cur) cur = w; else if (len(cur) + 1 + len(w) <= n) cur += ' ' + w; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines) return { lines, size: sz };
    if (sz <= TICKET_MIN_TEXT) break;
  }
  const n = per(TICKET_MIN_TEXT), flat = words.join(' ');
  const out: string[] = []; let rest = flat;
  while (rest && out.length < maxLines) { out.push(rest.slice(0, n).trimEnd()); rest = rest.slice(n).trimStart(); }
  if (rest) out[out.length - 1] = out[out.length - 1].slice(0, Math.max(1, n - 3)) + '...';
  return { lines: out.length ? out : [''], size: TICKET_MIN_TEXT };
}

/** Airplane silhouette (nose to the right), filled ink, tilted a little like the reference. `s` = width in units. */
export function plane(cx: number, cy: number, s: number): Prim {
  const top: [number, number][] = [[97, 50], [90, 44], [66, 42], [44, 10], [33, 10], [40, 42], [18, 42], [8, 27], [2, 27], [6, 50]];
  const pts = [...top, ...[...top].reverse().slice(1, -1).map(([x, y]) => [x, 100 - y] as [number, number]), [90, 56]] as [number, number][];
  const a = -0.35, c = Math.cos(a), sn = Math.sin(a), k = s / 100;
  return { k: 'poly', fill: '#000', pts: pts.map(([x, y]) => { const dx = (x - 50) * k, dy = (y - 50) * k; return [cx + dx * c - dy * sn, cy + dx * sn + dy * c] as [number, number]; }) };
}

/** Code 128 bars: crisp rects on whole dots (module = 4/3 unit = 2 dots @80mm). Returns the prims and the box they cover. */
export function barcodePrims(value: string, x: number, y: number, h: number, maxW: number): { prims: Prim[]; w: number } | null {
  const v = cleanBarcodeValue(value);
  if (!v) return null;
  const modules = code128Modules(v);
  const mod = [BARCODE_MODULE * 1.5, BARCODE_MODULE, BARCODE_MODULE * 0.75].find((m) => modules * m <= maxW);
  if (!mod) return null; // does not fit at a scannable width: never draw an unreadable barcode
  const prims: Prim[] = [];
  let cx = x, bar = true;
  for (const r of code128Runs(v)) { if (bar) prims.push({ k: 'rect', x: cx, y, w: r * mod, h, fill: '#000' }); cx += r * mod; bar = !bar; }
  return { prims, w: modules * mod };
}

export interface TicketBuild { W: number; H: number; slots: Rect[]; /** empty rectangle reserved for the page QR (stub) */ qrArea: Rect; prims: Prim[] }

interface StubItem { prio: number; h: number; draw: (y: number) => Prim[] }

export function buildTicket(id: string, info: TicketInfo, W = TICKET_UNITS_W, H = TICKET_UNITS_H): TicketBuild {
  const T = getTicketTemplate(id);
  if (!T) return { W, H, slots: [], qrArea: { x: 0, y: 0, w: 0, h: 0 }, prims: [] };
  const prims: Prim[] = [];
  const stubW = Math.round(W * TICKET_STUB_FRAC), perfX = W - stubW;
  const mainL = M, mainR = perfX - 7, mainW = mainR - mainL;
  const stubL = perfX + 7, stubR = W - M, stubInner = stubR - stubL, stubCx = (stubL + stubR) / 2;

  // ---- ticket body: outline, perforation, notches ----
  prims.push({ k: 'rect', x: 2, y: 2, w: W - 4, h: H - 4, stroke: '#000', sw: INK });
  prims.push({ k: 'line', x1: perfX, x2: perfX, y1: 10, y2: H - 10, sw: INK, dash: '6 5' });
  for (const y of [0, H]) prims.push({ k: 'circle', cx: perfX, cy: y, r: 6, fill: '#fff', stroke: '#000', sw: INK });

  // ---- stub (shared by all four): items stack from the top, lowest priority dropped first; brand + QR are anchored to the bottom ----
  const tagL = wrapLines(info.tagline, stubInner, TICKET_MIN_TEXT, 3), TAG_LH = 11;
  const brandSize = fitSize(info.brand, 13, stubInner);
  const tagTop = H - M - 3 * TAG_LH, tagBase0 = tagTop + 8; // tagline always reserves 3 lines so the QR area never moves with the wording
  const brandBase = tagTop - 4;
  const QR_H = stubInner, qrY = Math.round(brandBase - brandSize - 5 - QR_H);
  const qrArea: Rect = { x: stubL, y: qrY, w: stubInner, h: QR_H };
  const sub = wrapLines(info.title, stubInner, 9, 2);
  const venue = wrapLines(info.venue, stubInner, 9, 2), verse = wrapLines(info.verse, stubInner, 9, 2);
  const codeS = fitSize(info.code, 15, stubInner);
  /** text lines whose first glyph box starts at `y`; each line `lh(size)` apart */
  const block = (ls: string[], y: number, size: number) => ls.map((l, i) => text(l, stubCx, y + 0.9 * size + i * lh(size), size, { a: 'middle' }));
  const items: StubItem[] = [
    { prio: 1, h: Math.ceil(1.2 * codeS), draw: (y) => [one(info.code, stubCx, y + 0.9 * codeS, codeS, stubInner, { a: 'middle' })] },
    { prio: 1, h: lh(sub.size) * sub.lines.length, draw: (y) => block(sub.lines, y, sub.size) },
    { prio: 4, h: 20, draw: (y) => [plane(stubCx, y + 10, 22)] },
    { prio: 2, h: 11, draw: (y) => [one(info.date, stubCx, y + 8.1, 9, stubInner, { a: 'middle' })] },
    { prio: 2, h: lh(venue.size) * venue.lines.length, draw: (y) => block(venue.lines, y, venue.size) },
    { prio: 3, h: lh(verse.size) * verse.lines.length + 11, draw: (y) => [...block(verse.lines, y, verse.size), one(info.secondary, stubCx, y + lh(verse.size) * verse.lines.length + 8.1, 9, stubInner, { a: 'middle' })] }
  ];
  const GAP = 5, top = M + 2, avail = qrY - 4 - top;
  const total = (l: StubItem[]) => l.reduce((a, i) => a + i.h, 0) + GAP * Math.max(0, l.length - 1);
  let kept = [...items];
  while (total(kept) > avail && kept.length > 2) { const worst = Math.max(...kept.map((i) => i.prio)); kept.splice(kept.map((i) => i.prio).lastIndexOf(worst), 1); }
  let y = top;
  kept.forEach((it, i) => { prims.push(...it.draw(y)); y += it.h + GAP; if (i < kept.length - 1) prims.push(hline(stubL + 6, stubR - 6, y - GAP / 2 + 0.5, 1.5, DASH)); });
  prims.push(one(info.brand, stubCx, brandBase, brandSize, stubInner, { a: 'middle' }));
  tagL.lines.forEach((l, i) => prims.push(text(l, stubCx, tagBase0 + i * TAG_LH, tagL.size, { a: 'middle', w: 700 })));

  const slots: Rect[] = [];
  const bc = (x: number, yBottom: number, h: number, maxW: number) => barcodePrims(info.barcode, x, yBottom - h, h, maxW);

  if (T.id === 'ticket-4') {
    // ---- A: header band, 4 photo windows, info row, barcode + brand. Slack height is shared between the gaps, so the rows never crowd. ----
    prims.push(plane(mainL + 12, M + 20, 24));
    const hx = mainL + 34, hw = oneLine(info.code, 26, 112);
    prims.push(text(hw.t, hx, M + 20, hw.size, { fit: Math.min(112, tw(len(hw.t), hw.size)) }));
    prims.push(one(info.title, hx, M + 38, 11, 112));
    prims.push(one(info.label, mainR, M + 12, 9, 124, { a: 'end', ls: 1 }));
    prims.push(hline(mainR - 124, mainR, M + 18, 1.5, DASH));
    const ruleY = M + 44;
    prims.push(hline(mainL, mainR, ruleY));
    const bottomH = 46, infoH = 28;
    const n = T.photos, g = 5, pw = Math.floor((mainW - g * (n - 1)) / n);
    const fixed = ruleY + 8 + 6 + 6 + infoH + 8 + bottomH + M;               // everything except the photo height and the flexible gaps
    const ph = Math.max(40, Math.min(Math.round(pw * 1.6), H - fixed));
    const sl = Math.max(0, (H - fixed - ph) / 4);                            // 4 flexible gaps share the slack
    const pTop = Math.round(ruleY + 8 + sl), dashY = Math.round(pTop + ph + 6 + sl), infoTop = Math.round(dashY + 6 + sl), bottomTop = H - M - bottomH;
    const x0 = mainL + Math.floor((mainW - (pw * n + g * (n - 1))) / 2);
    for (let i = 0; i < n; i++) slots.push({ x: x0 + i * (pw + g), y: pTop, w: pw, h: ph });
    prims.push(hline(mainL, mainR, dashY, 1.5, DASH));
    // info row: DATE | VENUE | VERSE + secondary, columns share the width by text length
    const cols = [{ l: 'DATE', v: info.date }, { l: 'VENUE', v: info.venue }, { l: info.verse, v: info.secondary }];
    const gapC = 13, nat = cols.map((c) => Math.max(len(c.l), len(c.v))), sum = nat.reduce((a, b) => a + b, 0);
    const size = Math.max(TICKET_MIN_TEXT, Math.min(10, (mainW - 2 * gapC) / (sum * CW)));
    let cx = mainL;
    cols.forEach((c, i) => {
      const cellW = (mainW - 2 * gapC) * nat[i] / sum, w = Math.min(nat[i] * CW * size, cellW);
      prims.push(one(c.l, cx, infoTop + 9, size, cellW), one(c.v, cx, infoTop + 9 + 12, size, cellW));
      if (i < cols.length - 1) prims.push({ k: 'line', x1: cx + w + gapC / 2, x2: cx + w + gapC / 2, y1: infoTop - 1, y2: infoTop + infoH - 2, sw: 1.5 });
      cx += w + gapC;
    });
    // bottom: barcode left, brand right
    const b = bc(mainL, H - M, 34, 150);
    if (b) prims.push(...b.prims);
    const bx = mainL + (b?.w ?? 0) + 18, bw = mainR - bx;
    const t2 = wrapLines(info.tagline, bw, 9, 2);
    prims.push(one(info.brand, mainR, bottomTop + 18, 20, bw, { a: 'end' }));
    t2.lines.forEach((l, i) => prims.push(text(l, mainR, bottomTop + 20 + 13 + i * 11, t2.size, { a: 'end' })));
  } else {
    // ---- B / C / D: [left: event info] [photos] [right: verse + brand], barcode along the bottom-left, then the stub ----
    const L = T.left!, R = T.right!, g = 6, STRIP = 42; // STRIP = height reserved at the bottom for the barcode
    const lx0 = mainL, lx1 = mainL + L, rx1 = mainR, rx0 = mainR - R;
    const px0 = lx1 + g, px1 = rx0 - g;
    // left column: heading, title, date, venue, spread over the free height
    const hw = oneLine(info.code, 14, L), ttl = wrapLines(info.title, L, 9, 2), v = wrapLines(info.venue, L, 9, 2);
    const blocks = [18 + 14, lh(ttl.size) * ttl.lines.length, 22, 11 + lh(v.size) * v.lines.length];
    const free = H - M - STRIP - 4 - M - blocks.reduce((a, b) => a + b, 0) - 14;
    const gy = Math.max(4, Math.min(16, free / 4));
    let y = M;
    prims.push(plane(lx0 + 7, y + 7, 14)); y += 18;
    prims.push(text(hw.t, lx0, y + 0.9 * hw.size, hw.size, { fit: Math.min(L, tw(len(hw.t), hw.size)) })); y += 14 + gy;
    ttl.lines.forEach((l, i) => prims.push(text(l, lx0, y + 0.9 * ttl.size + i * lh(ttl.size), ttl.size))); y += lh(ttl.size) * ttl.lines.length + gy / 2;
    prims.push(hline(lx0, lx1, y, 1.5, DASH)); y += gy / 2 + 4;
    prims.push(text('DATE', lx0, y + 8, 9), one(info.date, lx0, y + 19.5, 9, L)); y += 22 + gy;
    prims.push(text('VENUE', lx0, y + 8, 9));
    v.lines.forEach((l, i) => prims.push(text(l, lx0, y + 19.5 + i * lh(v.size), v.size)));
    // barcode: whole-dot bars along the bottom, under the left column and the photo area
    const b = bc(lx0, H - M, 32, px1 - lx0);
    if (b) prims.push(...b.prims);
    // right column: verse + secondary on top, plane, brand + tagline at the bottom
    const vs = wrapLines(info.verse, R, 9, 2);
    vs.lines.forEach((l, i) => prims.push(text(l, rx1, M + 8 + i * lh(vs.size), vs.size, { a: 'end' })));
    prims.push(one(info.secondary, rx1, M + 8 + vs.lines.length * lh(vs.size) + 4, 10, R, { a: 'end' }));
    prims.push(plane(rx0 + R / 2, Math.round(H * 0.42), 24));
    const tg = wrapLines(info.tagline, R, 9, 4);
    const tgTop = H - M - (tg.lines.length - 1) * 11, bBase = tgTop - 14;
    prims.push(one(info.brand, rx1, bBase, 13, R, { a: 'end' }));
    tg.lines.forEach((l, i) => prims.push(text(l, rx1, tgTop + i * 11, tg.size, { a: 'end' })));
    // photo area: a label strip, then the windows (all the same size, centered vertically above the barcode strip)
    prims.push(one(info.label, (px0 + px1) / 2, M + 9, 9, px1 - px0, { a: 'middle' }));
    prims.push(hline(px0, px1, M + 15, 1.5, DASH));
    const n = T.photos, gp = 5, pw = Math.floor((px1 - px0 - gp * (n - 1)) / n);
    const areaTop = M + 24, areaBot = H - M - STRIP - 2, ph = Math.min(areaBot - areaTop, Math.round(pw * T.ratio!));
    const py = areaTop + Math.floor((areaBot - areaTop - ph) / 2), x0 = px0 + Math.floor((px1 - px0 - (pw * n + gp * (n - 1))) / 2);
    for (let i = 0; i < n; i++) slots.push({ x: x0 + i * (pw + gp), y: py, w: pw, h: ph });
  }
  return { W, H, slots, qrArea, prims };
}
