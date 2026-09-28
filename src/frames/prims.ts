import type { Block, FrameCtx, FrameDef, Prim } from './types';
import type { Rect as Rect0 } from '../layouts/types';
import type { ResolvedLayout } from '../layouts/types';

const REF = 384;
const CHAR_W = 0.6; // monospace glyph width / font size

export function makeCtx(event: string, d = new Date()): FrameCtx {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  let h = 7;
  for (const c of date + time + event) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { event, date, time, year: String(d.getFullYear()), serial: String(h % 1000000).padStart(6, '0') };
}

const fill = (t: string, c: FrameCtx) =>
  t.replace('{EVENT}', c.event).replace('{DATE}', c.date).replace('{TIME}', c.time).replace('{YEAR}', c.year).replace('{SERIAL}', c.serial);

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

const star = (cx: number, cy: number, r: number): Prim => ({
  k: 'poly', fill: '#000',
  pts: Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)] as [number, number];
  })
});

const dashOf = (k: number) => `${8 * k} ${6 * k}`;

function rule(y: number, x: number, w: number, style: 'dashed' | 'solid' | 'double', k: number): Prim[] {
  const one = (yy: number, sw: number, dash?: string): Prim => ({ k: 'line', x1: x, x2: x + w, y1: yy, y2: yy, sw, dash });
  if (style === 'double') return [one(y - 2 * k, 2 * k), one(y + 2 * k, 1 * k)];
  return [one(y, 2 * k, style === 'dashed' ? dashOf(k) : undefined)];
}

function block(b: Block, r: Rect0, ctx: FrameCtx, k: number, out: Prim[]) {
  for (const l of b.lines) {
    const text = fill(l.text, ctx);
    let size = l.size * k, ls = (l.ls ?? 0) * k;
    const width = text.length * (CHAR_W * size + ls);
    if (width > r.w) { const f = r.w / width; size *= f; ls *= f; } // long event names shrink to fit
    const align = l.align ?? 'center';
    out.push({
      k: 'text', text, size, ls, weight: l.weight ?? 400,
      x: align === 'left' ? r.x : align === 'right' ? r.x + r.w : r.x + r.w / 2,
      y: r.y + l.y * r.h + size * 0.35,
      anchor: align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
    });
  }
  if (b.barcode) out.push(...barcodeRects(ctx.date + ctx.time + ctx.event, r.x + r.w * 0.08, r.y + b.barcode.y * r.h, r.w * 0.84, b.barcode.h * r.h));
}

export function framePrims(f: FrameDef, L: ResolvedLayout, ctx: FrameCtx): Prim[] {
  const k = L.width / REF, out: Prim[] = [];
  const W = L.width, H = L.height, off = 8 * k;
  const { style, width, inset } = f.border;
  if (style !== 'none') {
    const rc = (i: number, sw: number): Prim => ({ k: 'rect', x: i, y: i, w: W - 2 * i, h: H - 2 * i, stroke: '#000', sw, dash: style === 'dashed' ? dashOf(k) : undefined });
    out.push(rc(inset * k, width * k));
    if (style === 'double') out.push(rc((inset + width * 3) * k, 1 * k));
  }
  if (L.header) {
    block(f.header, L.header, ctx, k, out);
    if (f.header.rule) out.push(...rule(L.header.y + L.header.h + off, L.header.x, L.header.w, f.header.rule, k));
    if (f.decor?.includes('stars')) [-2, -1, 0, 1, 2].forEach((i) => out.push(star(W / 2 + i * 26 * k, L.header!.y + L.header!.h * 0.9, 5 * k)));
  }
  if (L.footer) {
    block(f.footer, L.footer, ctx, k, out);
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
  for (const [name, offs] of [['slot-border', [4]], ['slot-border-double', [4, 7]]] as const)
    if (f.decor?.includes(name)) for (const s of L.slots) for (const o of offs)
      out.push({ k: 'rect', x: s.x - o * k, y: s.y - o * k, w: s.w + 2 * o * k, h: s.h + 2 * o * k, stroke: '#000', sw: (o === 4 ? 2 : 1) * k });
  return out;
}
