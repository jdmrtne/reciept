// "Manga Panel" frame generator: procedural vintage-manga page art (cream paper, hand-inked wobbly panel borders, tilted/irregular
// panel windows, speed lines, halftone, impact burst + speech bubble). Output is a normal RGBA overlay per layout (photo windows
// transparent), so the editor, picker thumbnail, print and share/export pipelines use it like any other image frame.
// The layout engine still owns the rectangular photo SLOTS; each irregular panel window is cut INSIDE its slot and opaque paper covers
// the rest of the slot, so photos are cropped to the panel shape (never distorted). Needs a CJK font at build time only
// (Noto Sans CJK JP; the shipped WebP files contain the rendered lettering).
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';

const FONT_DIR = '/usr/share/fonts/opentype/noto/';
let fontsOk = false;
for (const [file, fam] of [['NotoSansCJK-Black.ttc', 'MangaBlack'], ['NotoSansCJK-Bold.ttc', 'MangaBold']])
  if (existsSync(FONT_DIR + file)) { GlobalFonts.registerFromPath(FONT_DIR + file, fam); fontsOk = true; }
if (!fontsOk) console.warn('manga: Noto Sans CJK not found – Japanese lettering will use a fallback font');

const PAPER = [243, 234, 213], INK = '#111010', PAPER_CSS = `rgb(${PAPER.join(',')})`;
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

// corner insets (px @ k=1) for TL, TR, BR, BL: [dx, dy]. Each preset drops/raises different corners → tilted, unequal panels.
const PRESETS = [
  [[10, 8], [6, 26], [10, 6], [30, 12]],
  [[8, 30], [12, 8], [34, 10], [8, 6]],
  [[12, 10], [34, 6], [8, 28], [12, 8]],
  [[30, 12], [8, 8], [10, 10], [8, 32]]
];

function paper(g, W, H, rnd) {
  g.fillStyle = PAPER_CSS; g.fillRect(0, 0, W, H);
  // aged edges + uneven tone
  for (const [x0, y0, x1, y1] of [[0, 0, 150, 0], [W, 0, W - 150, 0], [0, 0, 0, 150], [0, H, 0, H - 150]]) {
    const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(150,115,60,0.20)'); gr.addColorStop(1, 'rgba(150,115,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < 14; i++) { const x = rnd() * W, y = rnd() * H, r = 80 + rnd() * 260, gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(170,135,80,${0.05 + rnd() * 0.05})`); gr.addColorStop(1, 'rgba(170,135,80,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  // fibres
  g.lineWidth = 1;
  for (let i = 0; i < Math.round((W * H) / 9000); i++) { const x = rnd() * W, y = rnd() * H, a = rnd() * 6.283, l = 6 + rnd() * 20;
    g.strokeStyle = rnd() < 0.5 ? 'rgba(120,90,50,0.10)' : 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  // grain
  const d = g.getImageData(0, 0, W, H), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const n = (rnd() - 0.5) * 9; p[i] += n; p[i + 1] += n; p[i + 2] += n * 1.1; }
  g.putImageData(d, 0, 0);
}

/** A hand-inked line: wobbly centre-line, swelling width, tapered ends, small overshoot past both corners. */
function inkLine(g, a, b, rnd, w0) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const o0 = 3 + rnd() * 10, o1 = 3 + rnd() * 10, tot = len + o0 + o1, n = Math.max(8, Math.ceil(tot / 14));
  const ph = [rnd() * 6.3, rnd() * 6.3, rnd() * 6.3], amp = 1.1 + rnd() * 1.1;
  const L = [], R = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = -o0 + t * tot, off = amp * (Math.sin(s / 85 + ph[0]) * 0.6 + Math.sin(s / 31 + ph[1]) * 0.4);
    const taper = 0.5 + 0.5 * Math.min(1, (t * tot) / 18, ((1 - t) * tot) / 18), w = (w0 * (0.84 + 0.26 * Math.sin(s / 140 + ph[2])) * taper) / 2;
    const cx = a[0] + ux * s + nx * off, cy = a[1] + uy * s + ny * off;
    L.push([cx + nx * w, cy + ny * w]); R.push([cx - nx * w, cy - ny * w]);
  }
  g.beginPath(); L.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); R.reverse().forEach((q) => g.lineTo(q[0], q[1])); g.closePath(); g.fillStyle = INK; g.fill();
}

const polyPath = (g, q) => { g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
function rayHit(c, d, q) { // distance from c along d to polygon boundary
  let best = Infinity;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length], ex = b[0] - a[0], ey = b[1] - a[1], den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - c[0]) * ey - (a[1] - c[1]) * ex) / den, u = ((a[0] - c[0]) * d[1] - (a[1] - c[1]) * d[0]) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}

/** Speed lines: tapered ink slivers converging on the panel centre, kept to the panel's rim so the photo stays clear. */
function speedIn(g, q, rnd, reach = 0.15, count = 150) {
  const c = [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4];
  g.save(); polyPath(g, q); g.clip(); g.fillStyle = INK;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * 6.2832 + (rnd() - 0.5) * 0.04, d = [Math.cos(ang), Math.sin(ang)], R = rayHit(c, d, q);
    if (!isFinite(R)) continue;
    const len = R * (reach * (0.35 + rnd() * 0.65)), wd = 0.004 + rnd() * 0.011, s0 = R + 6, s1 = R - len, nx = -d[1], ny = d[0];
    g.beginPath(); g.moveTo(c[0] + d[0] * s0 + nx * wd * R * 0.6, c[1] + d[1] * s0 + ny * wd * R * 0.6);
    g.lineTo(c[0] + d[0] * s1, c[1] + d[1] * s1); g.lineTo(c[0] + d[0] * s0 - nx * wd * R * 0.6, c[1] + d[1] * s0 - ny * wd * R * 0.6); g.closePath(); g.fill();
  }
  g.restore();
}
/** Short strokes radiating OUT of the panel into the gutter/margin (drawn before windows are cut, so neighbours erase any overlap). */
function speedOut(g, q, rnd, count = 70) {
  const c = [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4];
  g.fillStyle = INK;
  for (let i = 0; i < count; i++) {
    const ang = rnd() * 6.2832, d = [Math.cos(ang), Math.sin(ang)], R = rayHit(c, d, q); if (!isFinite(R)) continue;
    const s0 = R + 4, s1 = R + 12 + rnd() * 34, nx = -d[1], ny = d[0], wd = 1 + rnd() * 2.2;
    g.beginPath(); g.moveTo(c[0] + d[0] * s0 + nx * wd, c[1] + d[1] * s0 + ny * wd); g.lineTo(c[0] + d[0] * s1, c[1] + d[1] * s1); g.lineTo(c[0] + d[0] * s0 - nx * wd, c[1] + d[1] * s0 - ny * wd); g.fill();
  }
}

/** Screentone: 45° dot lattice whose dots shrink with distance from (cx,cy); optionally clipped. */
function tone(g, cx, cy, R, pitch, rmax, clipFn) {
  g.save(); if (clipFn) clipFn(g); g.fillStyle = INK; g.beginPath();
  const c45 = Math.SQRT1_2, n = Math.ceil(R / pitch) + 2;
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const u = i * pitch + (j & 1 ? pitch / 2 : 0), v = j * pitch * 0.5, x = cx + (u - v) * c45 * 1.0, y = cy + (u + v) * c45 * 1.0, dist = Math.hypot(x - cx, y - cy);
    if (dist > R) continue; const r = rmax * Math.pow(1 - dist / R, 0.9); if (r < 0.7) continue;
    g.moveTo(x + r, y); g.arc(x, y, r, 0, 6.2832);
  }
  g.fill(); g.restore();
}

function burst(g, cx, cy, rx, ry, rnd, spikes = 13) {
  const pts = []; for (let i = 0; i < spikes * 2; i++) { const a = (i / (spikes * 2)) * 6.2832 + 0.2, r = i % 2 ? 0.62 + rnd() * 0.08 : 0.98 + rnd() * 0.18; pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]); }
  return pts;
}
function sfx(g, text, x, y, size, rot, skew, font = 'MangaBlack') {
  g.save(); g.translate(x, y); g.rotate(rot); g.transform(1, 0, skew, 1, 0, 0); g.font = `${size}px "${font}", "Noto Sans CJK JP", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = size * 0.16; g.strokeStyle = INK; g.strokeText(text, 0, 0); g.fillStyle = INK; g.fillText(text, 0, 0);
  g.restore();
}
function bubble(g, cx, cy, rx, ry, tailTo, text, size, rot, rnd) {
  g.save(); g.translate(cx, cy); g.rotate(rot);
  const tx = tailTo[0], ty = tailTo[1];
  g.lineJoin = 'round'; g.strokeStyle = INK; g.lineWidth = 13;
  const tail = () => { g.beginPath(); g.moveTo(-rx * 0.45, ry * 0.55); g.lineTo(tx, ty); g.lineTo(-rx * 0.08, ry * 0.9); g.closePath(); };
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 6.2832); g.stroke(); tail(); g.stroke();
  g.fillStyle = PAPER_CSS; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 6.2832); g.fill(); tail(); g.fill();
  g.fillStyle = INK; g.font = `${size}px "MangaBlack", "Noto Sans CJK JP", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 0, 2);
  g.restore();
}

/** Returns draw(g, W, H, slots, B) for scripts/build-frames.mjs. */
export async function manga() {
  return (g, W, H, slots, B, layoutId = 'x') => {
    const rnd = mulberry(hash(layoutId)), n = slots.length;
    const u = Math.max(0.55, Math.min(1, slots[0].w / 880)); // scale of the lettering/effects for small (2x2) panels
    paper(g, W, H, rnd);
    // panel quads (irregular windows inside each rectangular slot)
    const quads = slots.map((s, i) => {
      const k = Math.max(0.6, Math.min(1.25, Math.min(s.w, s.h) / 540)), p = PRESETS[i % 4], wide = s.w > 600 ? 38 * k : 0;
      const exL = i % 4 === 1 ? wide : 0, exR = i % 4 === 3 ? wide : 0;
      return [[s.x + p[0][0] * k + exL, s.y + p[0][1] * k], [s.x + s.w - p[1][0] * k - exR, s.y + p[1][1] * k],
        [s.x + s.w - p[2][0] * k - exR, s.y + s.h - p[2][1] * k], [s.x + p[3][0] * k + exL, s.y + s.h - p[3][1] * k]];
    });
    const hero = (i) => n === 1 || (n === 4 && layoutId === 'grid-2x2' ? i === 0 || i === 3 : i % 2 === 0);
    // paper-side effects (under windows): outward speed strokes + margin screentone
    quads.forEach((q, i) => { if (hero(i)) speedOut(g, q, rnd, 80); });
    tone(g, W, H, 230 * u + 80, 13, 4.4, null);                                // bottom-right page corner
    tone(g, 0, 0, 170, 13, 4.0, null);                                           // top-left page corner
    if (n >= 3) slots.slice(0, -1).forEach((s, i) => tone(g, i % 2 ? 0 : W, s.y + s.h + 24, 200, 12, 4.4, null)); // gutter tone drifting in from alternating edges
    // cut photo windows
    g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    quads.forEach((q) => { polyPath(g, q); g.fill(); }); g.restore();
    // inked borders (thick, hand-drawn, overshooting corners)
    quads.forEach((q, i) => { for (let e = 0; e < 4; e++) inkLine(g, q[e], q[(e + 1) % 4], rnd, hero(i) ? 12.5 : 10.5); });
    // inside the panels: speed-line rims on hero panels, screentone corners on the others (drawn over the photo edge, like the reference)
    quads.forEach((q, i) => {
      if (hero(i)) speedIn(g, q, rnd, n === 1 ? 0.11 : 0.1, n === 1 ? 190 : 170);
      else { const corner = i % 4 === 1 ? q[3] : q[2]; const clip = (c) => { polyPath(c, q); c.clip(); }; tone(g, corner[0], corner[1], 190 * u + 50, 11, 4.4, clip); }
    });
    // impact burst (top-right of the first panel) with ドン!!
    { const q = quads[layoutId === 'grid-2x2' ? 1 : 0], rx = 165 * u, ry = 100 * u, bx = Math.min(q[1][0] - 60 * u, W - rx - 36), by = Math.max(ry + 34, q[1][1] - 6 * u), pts = burst(g, bx, by, rx, ry, rnd);
      g.save(); g.lineJoin = 'miter'; polyPath(g, pts); g.fillStyle = INK; g.save(); g.translate(7, 7); g.fill(); g.restore();
      g.fillStyle = PAPER_CSS; g.fill(); g.lineWidth = 7; g.strokeStyle = INK; g.stroke(); g.restore();
      tone(g, bx + rx * 0.2, by + ry * 0.4, rx * 0.8, 11, 3.6, (c) => { polyPath(c, pts); c.clip(); });
      sfx(g, 'ドン!!', bx - 6, by, 84 * u, -0.2, -0.12); }
    // footer: ゴゴゴ… on screentone, bubble 最高! tucked against the last panel
    { const last = quads[n - 1], fy = Math.min(H - 62, B.maxY + (H - B.maxY) * 0.5);
      tone(g, 20, H - 10, 250 * u + 40, 13, 4.4, null);
      sfx(g, 'ゴゴゴ…', 70 + 170 * u, fy, 70 * u, -0.07, -0.28);
      bubble(g, W - 150 * u - 60, last[2][1] + 40 * u + 30, 128 * u, 70 * u, [-70 * u, -112 * u], '最高!', 72 * u, 0.08, rnd); }
    // ink speckle: tiny paper-colour nicks in the lines so the ink reads as printed, not vector
    g.fillStyle = PAPER_CSS;
    quads.forEach((q) => { for (let e = 0; e < 4; e++) { const a = q[e], b = q[(e + 1) % 4], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let i = 0; i < l / 38; i++) { const t = rnd(), x = a[0] + (b[0] - a[0]) * t + (rnd() - 0.5) * 6, y = a[1] + (b[1] - a[1]) * t + (rnd() - 0.5) * 6; g.beginPath(); g.arc(x, y, 0.8 + rnd() * 1.3, 0, 6.2832); g.fill(); } } });
  };
}
