// "Slice & tile" frame builder for designs whose borders are scenery/patterns that can't be rebuilt from flat colours
// (pets, halloween, summer, neon…). The ORIGINAL pixels are kept 1:1:
//   top band (everything above cutA) + bottom band (everything below cutB) are copied untouched, and the side borders in between
//   are re-assembled from the plain stretch [cutA, cutB] (forward / mirrored / forward…) so any layout height works without distortion.
// The photo window is knocked out of the design (flood fill of its white paper), then each layout's real slots are cut into the paper behind it.
import { createCanvas } from '@napi-rs/canvas';

export const S = 3, UNITS = 384, GAP = 16;

export function knockout(img, o) {
  const W = img.width, H = img.height, c = createCanvas(W, H), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, W, H), d = data.data;
  const lo = (p) => Math.min(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]);
  const chroma = (p) => Math.max(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]) - lo(p);
  const ok = (p) => lo(p) >= o.thr && chroma(p) <= o.sat;
  const hole = new Uint8Array(W * H), seed = (o.seed ? o.seed[1] * W + o.seed[0] : (H >> 1) * W + (W >> 1));
  if (!ok(seed)) throw new Error('knockout seed is not window paper');
  const st = [seed]; hole[seed] = 1;
  while (st.length) {
    const p = st.pop(), x = p % W;
    for (const q of [p - W, p + W, x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1]) if (q >= 0 && q < W * H && !hole[q] && ok(q)) { hole[q] = 1; st.push(q); }
  }
  const nb = (p) => { const x = p % W; return [p - W, p + W, x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1].filter((q) => q >= 0 && q < W * H); };
  for (let it = 0; it < (o.fringe ?? 2); it++) { // eat the light anti-alias halo along the window edge
    const add = []; for (let p = 0; p < W * H; p++) if (!hole[p] && lo(p) >= 205 && chroma(p) <= o.sat + 10 && nb(p).some((q) => hole[q])) add.push(p);
    for (const p of add) hole[p] = 1;
  }
  for (let it = 0; it < (o.erode ?? 0); it++) { // shrink the hole → keeps a ring of the original paper (torn edge)
    const del = []; for (let p = 0; p < W * H; p++) if (hole[p] && nb(p).some((q) => !hole[q])) del.push(p);
    for (const p of del) hole[p] = 0;
  }
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let p = 0; p < W * H; p++) if (hole[p]) { d[p * 4 + 3] = 0; const x = p % W, y = (p / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  g.putImageData(data, 0, 0);
  return { canvas: c, w: W, h: H, hole: { x0, y0, x1: x1 + 1, y1: y1 + 1 } };
}

/** Bands (reference dots) that put the design's window exactly under the layout's slots: pad ≤ every margin, so slots always cover the window. */
export function suggestBands(k) {
  const sc = (UNITS * S) / k.w, u = sc / S, { hole } = k;
  const L = hole.x0 * u, R = (k.w - hole.x1) * u, T = hole.y0 * u, B = (k.h - hole.y1) * u;
  const padding = Math.floor(Math.min(L, R, T, B));
  const head = Math.floor(T) - padding - GAP, foot = Math.floor(B) - padding - GAP;
  return { padding, headerHeight: head > 0 ? head : 0, footerHeight: foot > 0 ? foot : 0 };
}

const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };

export function drawSliced(k, cfg, L, slotsPx, B) {
  const W = UNITS * S, H = L.h * S, sc = W / k.w, { hole } = k;
  const out = createCanvas(W, H), g = out.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const topH = cfg.cutA * sc, botH = (k.h - cfg.cutB) * sc, G = H - topH - botH;
  if (G < 4) throw new Error(`${cfg.id}: layout too short for the design's bands (${G.toFixed(0)}px of filler)`);
  const hx0 = hole.x0 * sc, hx1 = hole.x1 * sc, hy0 = hole.y0 * sc, hy1 = H - (k.h - hole.y1) * sc;
  // 1. paper behind the window, 2. real slots cut out of it
  g.fillStyle = cfg.paper; g.fillRect(Math.min(hx0, B.minX) - 4, Math.min(hy0, B.minY) - 4, Math.max(hx1, B.maxX) - Math.min(hx0, B.minX) + 8, Math.max(hy1, B.maxY) - Math.min(hy0, B.minY) + 8);
  g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
  for (const s of slotsPx) { rr(g, s.x, s.y, s.w, s.h, cfg.r ?? 0); g.fill(); }
  g.restore();
  // 3. divider lines only where two photos meet (the design's own window outline covers the outer edges)
  if (slotsPx.length > 1 && cfg.stroke) {
    g.strokeStyle = cfg.stroke.color; g.lineWidth = cfg.stroke.w;
    const near = (a, b, ax, ay) => (ax ? Math.abs(a.x - (b.x + b.w)) < 60 && a.y < b.y + b.h && b.y < a.y + a.h : Math.abs(a.y - (b.y + b.h)) < 60 && a.x < b.x + b.w && b.x < a.x + a.w);
    for (const s of slotsPx) {
      const hasL = slotsPx.some((o) => o !== s && near(s, o, true, false)), hasT = slotsPx.some((o) => o !== s && near(s, o, false, true));
      const hasR = slotsPx.some((o) => o !== s && near(o, s, true, false)), hasB = slotsPx.some((o) => o !== s && near(o, s, false, true));
      const hw = cfg.stroke.w / 2;
      g.beginPath();
      if (hasT) { g.moveTo(s.x - hw, s.y - hw); g.lineTo(s.x + s.w + hw, s.y - hw); }
      if (hasB) { g.moveTo(s.x - hw, s.y + s.h + hw); g.lineTo(s.x + s.w + hw, s.y + s.h + hw); }
      if (hasL) { g.moveTo(s.x - hw, s.y - hw); g.lineTo(s.x - hw, s.y + s.h + hw); }
      if (hasR) { g.moveTo(s.x + s.w + hw, s.y - hw); g.lineTo(s.x + s.w + hw, s.y + s.h + hw); }
      g.stroke();
    }
  }
  // 4. side borders re-assembled from the plain stretch (forward, mirrored, forward … ending exactly on cutB)
  const seg = (cfg.cutB - cfg.cutA) * sc;
  let m = 1; for (let n = 1; n < 400; n += 2) if (Math.abs(G / (n * seg) - 1) < Math.abs(G / (m * seg) - 1)) m = n;
  const vs = G / (m * seg), inset = cfg.inset ?? 8;
  const strips = [[0, 0, hole.x0 + inset], [k.w - (k.w - hole.x1 + inset), W - (k.w - hole.x1 + inset) * sc, k.w - hole.x1 + inset]]; // [srcX, dstX, srcW]
  for (const [sx, dx, sw] of strips) for (let j = 0; j < m; j++) {
    const dy = topH + j * seg * vs, dh = seg * vs + 1.5; // +1.5px overlap hides the resampling seam between pieces
    g.save();
    if (j % 2) { g.translate(0, dy + dh); g.scale(1, -1); g.drawImage(k.canvas, sx, cfg.cutA, sw, cfg.cutB - cfg.cutA, dx, 0, sw * sc, dh); }
    else g.drawImage(k.canvas, sx, cfg.cutA, sw, cfg.cutB - cfg.cutA, dx, dy, sw * sc, dh);
    g.restore();
  }
  // 5. original top and bottom bands, untouched
  g.drawImage(k.canvas, 0, 0, k.w, cfg.cutA, 0, 0, W, topH);
  g.drawImage(k.canvas, 0, cfg.cutB, k.w, k.h - cfg.cutB, 0, H - botH, W, botH);
  return out;
}
