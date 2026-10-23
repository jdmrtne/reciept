import type { Block, FrameCtx, FrameDef, PathCmd, Prim } from './types';
import type { Rect as Rect0 } from '../layouts/types';
import { ornament, sketchRect, tornRect } from './art';
import { wantedPrims } from './wanted';
import type { ResolvedLayout } from '../layouts/types';
import { DEFAULT_THANK_YOU, type EventProfile } from '../config/events';
import { lineOverride, type FrameTextOverrides, type LinePart } from './frameText';

const REF = 384;
const CHAR_W = 0.6; // monospace glyph width / font size

/**
 * The session stamp: date, time and serial from ONE moment, in the booth device's local time zone (no zone is forced, so a booth shows
 * the venue's own clock). An invalid Date is replaced by "now" instead of printing "NaN". `info` = the final active event profile.
 */
export function makeCtx(event: string, d: Date = new Date(), info?: EventProfile, frameText?: FrameTextOverrides): FrameCtx {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  let h = 7;
  for (const c of date + time + event) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { event, date, time, year: String(d.getFullYear()), serial: String(h % 1000000).padStart(6, '0'), ...(info ? { info } : {}), ...(frameText && Object.keys(frameText).length ? { frameText } : {}) };
}

/** The stamp for a customer: the FINAL active event profile (from `getActiveEvent`) supplies the name and the receipt info. */
export const makeEventCtx = (profile: EventProfile, d: Date = new Date(), frameText?: FrameTextOverrides): FrameCtx => makeCtx(profile.name, d, profile, frameText);

/** One pass, so a value that itself contains braces (an event named "{DATE}") is never expanded again. Unsupported {tokens} are removed. */
const fill = (t: string, c: FrameCtx) => {
  const v: Record<string, string> = { EVENT: c.event, DATE: c.date, TIME: c.time, YEAR: c.year, SERIAL: c.serial, THANKS: c.info ? c.info.thankYou : DEFAULT_THANK_YOU }; // THANKS: the profile's thank-you; the old fixed text when no profile is attached
  return t.replace(/\{([^{}]*)\}/g, (_m, k: string) => (Object.hasOwn(v, k) ? v[k] : ''));
};

const MIN_TEXT = 9; // smallest readable text (reference dots @58mm): owner text shrinks to this, then is ellipsized
const advance = (n: number, size: number, ls: number) => n * (CHAR_W * size + ls);

/** Fits owner text into `avail` dots: shrink size + spacing together, never below the minimum size, then tighten spacing, then ellipsize. */
function fitOwner(text: string, size0: number, ls0: number, avail: number, min: number) {
  let size = size0, ls = ls0;
  const w = advance(text.length, size, ls);
  if (w <= avail) return { text, size, ls };
  const f = avail / w;
  if (size0 * f >= min) return { text, size: size0 * f, ls: ls0 * f };
  size = Math.min(min, size0);
  ls = Math.min(ls0, avail / text.length - CHAR_W * size);
  if (ls >= 0) return { text, size, ls };
  ls = 0;
  const max = Math.floor(avail / (CHAR_W * size));
  return { text: max < 1 ? '' : text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '\u2026', size, ls };
}

export function barcodeRects(seed: string, x: number, y: number, w: number, h: number): Prim[] {
  let hs = 2166136261;
  for (const ch of seed) hs = Math.imul(hs ^ ch.charCodeAt(0), 16777619);
  const bars: { x: number; w: number }[] = [];
  let cx = 0;
  for (let i = 0; i < 42; i++) {
    hs = Math.imul(hs ^ (hs >>> 13), 1274126177);
    const bw = 1 + (Math.abs(hs) % 4);
    bars.push({ x: cx, w: bw });
    cx += bw + 1 + (Math.abs(hs >> 5) % 3);
  }
  const s = w / cx;
  return bars.map((b) => ({ k: 'rect', x: x + b.x * s, y, w: Math.max(1, b.w * s), h, fill: '#000' }));
}

const star = (cx: number, cy: number, r: number, sw: number): Prim => ({
  k: 'path', stroke: '#000', sw, // outlined 5-point star (ink line, not a solid blob)
  cmds: [...Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    return [i ? 'L' : 'M', cx + rr * Math.cos(a), cy + rr * Math.sin(a)] as PathCmd;
  }), ['Z'] as PathCmd]
});

const dashOf = (k: number) => `${8 * k} ${6 * k}`;

function rule(y: number, x: number, w: number, style: 'dashed' | 'solid' | 'double', k: number): Prim[] {
  const one = (yy: number, sw: number, dash?: string): Prim => ({ k: 'line', x1: x, x2: x + w, y1: yy, y2: yy, sw, dash });
  if (style === 'double') return [one(y - 2 * k, 2 * k), one(y + 2 * k, 1 * k)];
  return [one(y, 2 * k, style === 'dashed' ? dashOf(k) : undefined)];
}

function block(b: Block, r: Rect0, ctx: FrameCtx, k: number, out: Prim[], frameId: string, part: LinePart) {
  const items = b.lines.flatMap((l, i) => {
    const ov = lineOverride(ctx, frameId, part, i); // owner text (ADMIN > Frame text); '' = hidden
    const text = fill(ov ?? l.text, ctx);
    return text.trim() ? [{ l, text, ov: ov !== undefined, size: l.size * k, ls: (l.ls ?? 0) * k }] : []; // an owner who cleared the thank-you leaves no empty text behind
  });
  type Item = (typeof items)[number];
  const gap = 8 * k, min = MIN_TEXT * k;
  const fits = new Map<Item, { text: string; size: number; ls: number }>();
  const partnerOf = (a: Item) => (a.l.align === 'left' || a.l.align === 'right' ? items.find((c) => c.l.align === (a.l.align === 'left' ? 'right' : 'left') && c.l.y === a.l.y) : undefined);
  for (const it of items) {
    if (fits.has(it)) continue;
    const mate = partnerOf(it);
    if (it.ov || mate?.ov) { // label + value on one row must not overlap: share the band width
      const want = [it, mate].filter((x): x is Item => !!x), nat = want.map((x) => advance(x.text.length, x.size, x.ls));
      const total = r.w - (mate ? gap : 0), sum = nat.reduce((a, c) => a + c, 0);
      want.forEach((x, i) => fits.set(x, fitOwner(x.text, x.size, x.ls, sum <= total ? Math.max(nat[i], 0) : total * (nat[i] / sum), min)));
      continue;
    }
    let { size, ls } = it;
    const width = advance(it.text.length, size, ls);
    if (width > r.w) { const f = r.w / width; size *= f; ls *= f; } // long event names shrink to fit
    fits.set(it, { text: it.text, size, ls });
  }
  for (const it of items) {
    const { text, size, ls } = fits.get(it)!;
    if (!text) continue;
    const align = it.l.align ?? 'center';
    out.push({
      k: 'text', text, size, ls, weight: it.l.weight ?? 400,
      x: align === 'left' ? r.x : align === 'right' ? r.x + r.w : r.x + r.w / 2,
      y: r.y + it.l.y * r.h + size * 0.35,
      anchor: align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
    });
  }
  if (b.barcode) out.push(...barcodeRects(ctx.date + ctx.time + ctx.event, r.x + r.w * 0.08, r.y + b.barcode.y * r.h, r.w * 0.84, b.barcode.h * r.h));
}

export function framePrims(f: FrameDef, L: ResolvedLayout, ctx: FrameCtx): Prim[] {
  if (f.decor?.includes('wanted-poster')) return wantedPrims(L, ctx); // full-colour parchment drawn around the layout's slots
  const k = L.width / REF, out: Prim[] = [];
  const W = L.width, H = L.height, off = 8 * k;
  const { style, width, inset } = f.border;
  const sketchy = f.decor?.includes('sketch-border') || style === 'solid' || style === 'double';
  if (f.decor?.includes('torn')) out.push({ k: 'path', cmds: tornRect(3.5 * k, 3.5 * k, W - 7 * k, H - 7 * k, 9 * k, 2.2 * k, 7), stroke: '#000', sw: 2 * k });
  if (style !== 'none') {
    const rc = (i: number, sw: number, n: number): Prim => sketchy && style !== 'dashed'
      ? { k: 'path', cmds: sketchRect(i, i, W - 2 * i, H - 2 * i, 8 * k, 0.9 * k, n), stroke: '#000', sw }
      : { k: 'rect', x: i, y: i, w: W - 2 * i, h: H - 2 * i, stroke: '#000', sw, dash: style === 'dashed' ? dashOf(k) : undefined };
    out.push(rc(inset * k, width * k, 1));
    if (style === 'double') out.push(rc((inset + width * 3) * k, 1 * k, 2));
  }
  if (f.decor?.includes('nails')) for (const [nx, ny] of [[11, 11], [W / k - 11, 11], [11, H / k - 11], [W / k - 11, H / k - 11]])
    out.push({ k: 'circle', cx: nx * k, cy: ny * k, r: 2.4 * k, fill: '#fff', stroke: '#000', sw: 1.3 * k });
  if (L.header) {
    block(f.header, L.header, ctx, k, out, f.id, 'header');
    if (f.header.rule) out.push(...rule(L.header.y + L.header.h + off, L.header.x, L.header.w, f.header.rule, k));
    if (f.decor?.includes('stars')) [-2, -1, 0, 1, 2].forEach((i) => out.push(star(W / 2 + i * 26 * k, L.header!.y + L.header!.h * 0.9, 6 * k, 1.3 * k)));
  }
  if (L.footer) {
    block(f.footer, L.footer, ctx, k, out, f.id, 'footer');
    if (f.footer.rule) out.push(...rule(L.footer.y - off, L.footer.x, L.footer.w, f.footer.rule, k));
    if (f.decor?.includes('notches')) {
      const y = L.footer.y - off;
      out.push({ k: 'circle', cx: 0, cy: y, r: 9 * k, fill: '#fff', stroke: '#000', sw: 2 * k }, { k: 'circle', cx: W, cy: y, r: 9 * k, fill: '#fff', stroke: '#000', sw: 2 * k });
    }
  }
  if (f.decor?.includes('corners')) {
    const s = 14 * k, m = 12 * k;
    for (const [cx, cy, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]])
      out.push({ k: 'line', x1: cx, y1: cy, x2: cx + dx * s, y2: cy, sw: 2 * k }, { k: 'line', x1: cx, y1: cy, x2: cx, y2: cy + dy * s, sw: 2 * k });
  }
  for (const o of f.ornaments ?? []) {
    const r = o.at === 'header' ? L.header : L.footer;
    if (!r) continue;
    const size = o.size * k, cy = r.y + o.y * r.h, m = size / 2 + 12 * k;
    if (o.left) out.push(...ornament(o.left, r.x + m, cy, size, 2 * k, -8));
    if (o.right) out.push(...ornament(o.right, r.x + r.w - m, cy, size, 2 * k, 8));
  }
  for (const [name, offs] of [['slot-border', [4]], ['slot-border-double', [4, 7]]] as const)
    if (f.decor?.includes(name)) for (const s of L.slots) for (const o of offs)
      out.push({ k: 'rect', x: s.x - o * k, y: s.y - o * k, w: s.w + 2 * o * k, h: s.h + 2 * o * k, stroke: '#000', sw: (o === 4 ? 2 : 1) * k });
  return out;
}
