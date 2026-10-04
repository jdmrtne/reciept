// "Manga Panel" frame generator: procedural vintage-manga page art (cream paper, hand-inked wobbly panel borders, tilted/irregular
// panel windows, speed lines, halftone, impact burst + speech bubble). Output is a normal RGBA overlay per layout (photo windows
// transparent), so the editor, picker thumbnail, print and share/export pipelines use it like any other image frame.
// The layout engine still owns the rectangular photo SLOTS; each irregular panel is cut INSIDE its slot and opaque paper covers
// only the slot corners/gutters OUTSIDE the panel, so photos are cropped to the panel shape (never distorted).
// The WHOLE panel interior is transparent (alpha 0): speed lines, halftone and borders are ink drawn ON TOP of the photo - no paper fill inside a panel. Needs a CJK font at build time only
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

/** Reference-style focus lines: dense tapered ink wedges rooted on the panel border and converging on the clear photo window. */
function speedRing(g, q, win, rnd, k, count = 420) {
  const c = [win.reduce((s, p) => s + p[0], 0) / win.length, win.reduce((s, p) => s + p[1], 0) / win.length], ph = rnd() * 6.3;
  g.save(); polyPath(g, q); g.clip(); g.fillStyle = INK;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * 6.2832 + (rnd() - 0.5) * 0.016, d = [Math.cos(ang), Math.sin(ang)], R = rayHit(c, d, q), Rw = rayHit(c, d, win);
    if (!isFinite(R) || !isFinite(Rw) || R <= Rw) continue;
    const thick = i % 3 !== 0, depth = R - Rw, clump = 0.78 + 0.22 * Math.sin(ang * 9 + ph);
    const s1 = thick ? Rw + depth * Math.min(0.9, (0.04 + rnd() * 0.6) * (2 - clump)) : Rw + depth * (0.0 + rnd() * 0.18);
    const hw = (thick ? 1.6 + rnd() * 4.6 : 0.5 + rnd() * 1.1) * k, s0 = R + 10, nx = -d[1], ny = d[0];
    g.beginPath(); g.moveTo(c[0] + d[0] * s0 + nx * hw, c[1] + d[1] * s0 + ny * hw); g.lineTo(c[0] + d[0] * s1, c[1] + d[1] * s1); g.lineTo(c[0] + d[0] * s0 - nx * hw, c[1] + d[1] * s0 - ny * hw); g.closePath(); g.fill();
  }
  g.restore();
}
/** Soft rounded-rectangle outline with a little hand wobble (the clear centre the photo shows through). */
function blob(r, rnd, wob = 5) {
  const rad = Math.min(r.w, r.h) * 0.26, pts = [], ph = [rnd() * 6.3, rnd() * 6.3];
  const arcs = [[r.x + r.w - rad, r.y + rad, -1.5708], [r.x + r.w - rad, r.y + r.h - rad, 0], [r.x + rad, r.y + r.h - rad, 1.5708], [r.x + rad, r.y + rad, 3.1416]];
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  for (const [ax, ay, a0] of arcs) for (let i = 0; i <= 14; i++) { const a = a0 + (i / 14) * 1.5708, x = ax + Math.cos(a) * rad, y = ay + Math.sin(a) * rad, t = Math.atan2(y - cy, x - cx);
    const o = wob * (Math.sin(t * 5 + ph[0]) * 0.6 + Math.sin(t * 11 + ph[1]) * 0.4); pts.push([x + Math.cos(t) * o, y + Math.sin(t) * o]); }
  return pts;
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
function sfx(g, text, x, y, size, rot, skew, font = 'MangaBlack', fill = INK) {
  g.save(); g.translate(x, y); g.rotate(rot); g.transform(1, 0, skew, 1, 0, 0); g.font = `${size}px "${font}", "Noto Sans CJK JP", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = size * 0.16; g.strokeStyle = INK; g.strokeText(text, 0, 0); g.fillStyle = fill; g.fillText(text, 0, 0);
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

/** Returns draw(g, W, H, slots, B, layoutId) for scripts/build-frames.mjs. Page structure follows the reference sheets:
 *  panels alternate between "focus-line" panels (dense radial lines around the photo) and plain panels with halftone corners;
 *  ドン!! burst, 最高! bubble and ゴゴゴ… lettering overlap panel corners. */
export async function manga() {
  return (g, W, H, slots, B, layoutId = 'x') => {
    const rnd = mulberry(hash(layoutId)), n = slots.length;
    const u = Math.max(0.5, Math.min(1, slots[0].w / 880));
    paper(g, W, H, rnd);
    const lines = slots.map((_, i) => n === 1 || (n === 2 ? i === 0 : i === 0 || i === n - 1));
    const tilt = [[[0, 10], [14, 0], [0, 12], [10, 0]], [[10, 0], [0, 12], [14, 0], [0, 10]], [[0, 14], [8, 0], [0, 6], [12, 0]], [[12, 0], [0, 8], [10, 0], [0, 14]]];
    const clear = [], quads = [];
    slots.forEach((s, i) => {
      const k = Math.max(0.6, Math.min(1.2, Math.min(s.w, s.h) / 600));
      if (lines[i]) {
        const ring = 0.13 * Math.min(s.w, s.h), ext = 0, t = tilt[i % 4];
        clear.push(blob({ x: s.x + ring, y: s.y + ring, w: s.w - 2 * ring, h: s.h - 2 * ring }, rnd, 5 * k)); // where the focus lines stop (NOT a paper boundary)
        quads.push([[s.x - ext + t[0][0], s.y - ext + t[0][1]], [s.x + s.w + ext - t[1][0], s.y - ext + t[1][1]], [s.x + s.w + ext - t[2][0], s.y + s.h + ext - t[2][1] * 0.6], [s.x - ext + t[3][0], s.y + s.h + ext - t[3][1] * 0.6]]);
      } else {
        const t = tilt[i % 4], m = 22 * k, b = 5; // border (10.5px) inner edge lands on the window edge: no paper sliver between photo and ink
        const w = [[s.x + t[0][0] * k * 1.4, s.y + t[0][1] * k * 1.4], [s.x + s.w - t[1][0] * k * 1.4, s.y + t[1][1] * k * 1.4], [s.x + s.w - t[2][0] * k * 1.4, s.y + s.h - t[2][1] * k * 1.4], [s.x + t[3][0] * k * 1.4, s.y + s.h - t[3][1] * k * 1.4]];
        clear.push(w); quads.push(w.map((p, j) => [p[0] + (j === 0 || j === 3 ? -b : b), p[1] + (j < 2 ? -b : b)]));
        void m;
      }
    });
    // 1) the whole panel interior becomes real alpha-0 transparency (photo shows through everywhere inside the panel, speed-line zones included)
    g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; quads.forEach((q) => { polyPath(g, q); g.fill(); }); g.restore();
    // 2) focus lines are ink only, drawn on top of the (transparent) panel - never on a paper fill
    quads.forEach((q, i) => { if (lines[i]) speedRing(g, q, clear[i], rnd, Math.max(0.6, Math.min(1.2, slots[i].w / 700)), n === 1 ? 460 : 400); });
    // thick inked borders, overshooting corners
    quads.forEach((q, i) => { for (let e = 0; e < 4; e++) inkLine(g, q[e], q[(e + 1) % 4], rnd, lines[i] ? 14 : 10.5); });
    const clipTo = (q) => (c) => { polyPath(c, q); c.clip(); };
    const bi = n > 1 ? 1 : 0, ci = n > 2 ? 2 : n - 1;
    // halftone corners (over the photo edge, as in the references)
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!lines[bi]) tone(g, quads[bi][1][0], quads[bi][1][1], 300 * u, 15 * u + 3, 7 * u + 1.5, clipTo(quads[bi]));
    if (n > 2 && !lines[ci]) tone(g, quads[ci][3][0], quads[ci][3][1], 280 * u, 15 * u + 3, 7 * u + 1.5, clipTo(quads[ci]));
    else if (n === 2) tone(g, quads[0][3][0], quads[0][3][1], 230 * u, 13 * u + 2, 4.5 * u + 1, clipTo(quads[0]));
    if (n > 1 && n !== 2) { const L = quads[n - 1]; tone(g, L[3][0], L[3][1], 300 * u, 15 * u + 3, 7 * u + 1.5, clipTo(L)); }
    if (n === 1) { const L = quads[0]; tone(g, L[3][0], L[3][1], 330 * u, 14, 5.5, clipTo(L)); }
    void mid;
    // ドン!! burst on the top-right corner of the burst panel
    { const q = quads[bi], rx = 170 * u, ry = 105 * u, bx = Math.min(W - rx * 1.2 - 6, q[1][0] - rx * 0.62), by = q[1][1] + ry * 0.55, pts = burst(g, bx, by, rx, ry, rnd, 12);
      g.save(); g.lineJoin = 'miter'; polyPath(g, pts); g.fillStyle = INK; g.save(); g.translate(8, 8); g.fill(); g.restore();
      g.fillStyle = PAPER_CSS; g.fill(); g.lineWidth = 7; g.strokeStyle = INK; g.stroke(); g.restore();
      tone(g, bx + rx * 0.5, by + ry * 0.6, rx * 1.0, 11, 3.4, (c) => { polyPath(c, pts); c.clip(); });
      sfx(g, 'ドン!!', bx - 4, by, 92 * u, -0.2, -0.12, 'MangaBlack', '#3a3836'); }
    // 最高! bubble, top-left corner of the bubble panel
    { const q = quads[ci === bi && n > 1 ? bi : ci], bu = 112 * u;
      const bx = q[0][0] + bu * 1.05 + 10, by = q[0][1] + (ci === bi ? 0.62 * H / Math.max(n, 2) * 0.5 : 40 * u) + bu * 0.45;
      const cy = n === 1 ? slots[0].y + slots[0].h - bu * 0.7 : by;
      bubble(g, bx, cy, bu, bu * 0.58, [bu * 0.5, bu * 1.0], '最高!', 62 * u, -0.06, rnd); }
    // ゴゴゴ… on the last panel's halftone corner
    { const q = quads[n - 1]; sfx(g, 'ゴゴゴ…', q[3][0] + 215 * u + 24, q[3][1] - 70 * u - 14, 84 * u, -0.14, -0.28); }
    // ink nicks
    g.fillStyle = PAPER_CSS;
    quads.forEach((q) => { for (let e = 0; e < 4; e++) { const a = q[e], b = q[(e + 1) % 4], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let i = 0; i < l / 45; i++) { const t = rnd(), x = a[0] + (b[0] - a[0]) * t + (rnd() - 0.5) * 6, y = a[1] + (b[1] - a[1]) * t + (rnd() - 0.5) * 6; g.beginPath(); g.arc(x, y, 0.8 + rnd() * 1.2, 0, 6.2832); g.fill(); } } });
  };
}
