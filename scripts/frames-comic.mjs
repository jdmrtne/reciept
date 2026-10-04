// "Manga Comic" panel step (used by the SLICED builder via frames-config.mjs `post`).
// The reference page has ONE tilted, hand-inked panel as its photo window. For every layout the real photo slots are rectangles, so
// each slot gets the same irregular panel shape (fractions of the slot, measured from the reference) with a thick hand-inked edge;
// white page covers the slot corners outside the panel, so photos are cropped to the panel (never distorted).
import { createCanvas } from '@napi-rs/canvas';

// Panel outline as fractions of the photo slot (x, y), measured on design-src/manga-comic.png: tilted top edge, slanted bottom-left.
const PANEL = [[0, 0.139], [0.9, 0.0], [0.925, 0.88], [0.18, 0.99], [0, 0.88]];
const INK = '#111010';
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Hand-inked edge: wobbling, slightly swelling stroke between two points. */
function inkEdge(g, a, b, rnd, w0) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len, n = Math.max(6, Math.ceil(len / 16));
  const ph = [rnd() * 6.3, rnd() * 6.3], L = [], R = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, off = 1.3 * (Math.sin(t * len / 70 + ph[0]) * 0.6 + Math.sin(t * len / 27 + ph[1]) * 0.4), w = (w0 * (0.88 + 0.22 * Math.sin(t * len / 120 + ph[0]))) / 2;
    const cx = a[0] + dx * t + nx * off, cy = a[1] + dy * t + ny * off;
    L.push([cx + nx * w, cy + ny * w]); R.push([cx - nx * w, cy - ny * w]);
  }
  g.beginPath(); L.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); R.reverse().forEach((q) => g.lineTo(q[0], q[1])); g.closePath(); g.fillStyle = INK; g.fill();
}

/** Draws on the finished layout canvas `c` (3× units). Slots are the real photo rectangles in canvas px. */
export function comicPanels(c, slots, geo) {
  const g = c.getContext('2d'), rnd = mulberry(20260404);
  // Only the part of each slot that is really visible: inside the design's window columns and between its top/bottom art bands.
  const x0 = geo.hx0, x1 = geo.hx1, y0 = geo.topH, y1 = c.height - geo.botH;
  for (const s0 of slots) {
    const s = { x: Math.max(s0.x, x0), y: Math.max(s0.y, y0) };
    s.w = Math.min(s0.x + s0.w, x1) - s.x; s.h = Math.min(s0.y + s0.h, y1) - s.y;
    const pts = PANEL.map(([fx, fy]) => [s.x + fx * s.w, s.y + fy * s.h]);
    // white page over the slot corners outside the panel (even-odd: slot rectangle minus panel)
    const m = 3; g.save(); g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.beginPath(); // behind the art: only the transparent cut-out outside the panel turns white
    g.rect(s.x - m, s.y - m, s.w + 2 * m, s.h + 2 * m);
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill('evenodd'); g.restore();
    const lw = Math.max(10, Math.min(s.w, s.h) * 0.022);
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; inkEdge(g, a, b, rnd, lw); }
    g.fillStyle = INK; for (const [x, y] of pts) { g.beginPath(); g.arc(x, y, lw * 0.55, 0, 6.283); g.fill(); } // round off the corners
  }
  return c;
}
