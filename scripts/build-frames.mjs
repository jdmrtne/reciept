// Builds the per-layout frame PNGs (transparent photo windows) from the flat designs in design-src/.
// usage: npm run build-frames        (reads docs/frame-layouts.json → run `npm run frame-specs` first if bands/layouts changed)
// The ARTWORK (cats, hearts, tape, script lettering, film rails…) is cut out of your designs; only the plain
// background, border lines and window cut-outs are rebuilt around the real photo slots of each layout.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { knockout, drawSliced } from './frames-slice.mjs';
import { SLICED } from './frames-config.mjs';
import { manga } from './frames-manga.mjs';

const S = 3, UNITS = 384;
const layouts = JSON.parse(readFileSync('docs/frame-layouts.json', 'utf8'));
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ramp = (v, lo, hi) => clamp01((v - lo) / (hi - lo));

function crop(img, [x0, y0, x1, y1]) {
  const c = createCanvas(x1 - x0, y1 - y0), g = c.getContext('2d');
  g.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
  return { c, g, w: x1 - x0, h: y1 - y0, d: g.getImageData(0, 0, x1 - x0, y1 - y0) };
}
/** Alpha from distance to the flat background colour; colours are un-premultiplied so the sprite looks identical on that background. */
function keyed(img, box, bg, lo, hi) {
  const { c, g, w, h, d } = crop(img, box), px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const dist = Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]), a = ramp(dist, lo, hi);
    for (let k = 0; k < 3; k++) px[i + k] = a > 0 ? Math.max(0, Math.min(255, bg[k] + (px[i + k] - bg[k]) / a)) : px[i + k];
    px[i + 3] = Math.round(a * 255);
  }
  g.putImageData(d, 0, 0);
  return c;
}
/** Tape: alpha from "tanness" (r − b), which separates it from cream paper, white window and grey outline. */
function tape(img, box) {
  const { c, g, d } = crop(img, box), px = d.data;
  for (let i = 0; i < px.length; i += 4) px[i + 3] = Math.round(ramp(px[i] - px[i + 2], 40, 80) * 255);
  g.putImageData(d, 0, 0);
  return c;
}
/** Sticker-style cut-out for the kawaii art: flood-removes blue paper / white window / dark-blue window line from the crop border, keeps the largest piece, and re-draws the white sticker halo. */
function sticker(img, box, halo) {
  const { w, h, d } = crop(img, box), px = d.data;
  const removable = (i) => { const r = px[i], g = px[i + 1], b = px[i + 2];
    return Math.hypot(r - 150, g - 224, b - 254) < 75 || Math.min(r, g, b) > 232 || Math.hypot(r - 16, g - 84, b - 160) < 75; };
  const gone = new Uint8Array(w * h), st = [];
  const push = (x, y) => { const p = y * w + x; if (!gone[p] && removable(p * 4)) { gone[p] = 1; st.push(p); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (st.length) { const p = st.pop(), x = p % w, y = (p / w) | 0; if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1); }
  // keep every real piece (a paw's toes are separate from its pad) but drop slivers of the old window line
  const lab = new Int32Array(w * h), sizes = [0]; let L = 0;
  for (let s = 0; s < w * h; s++) if (!gone[s] && !lab[s]) {
    L++; let n = 0; const q = [s]; lab[s] = L;
    while (q.length) { const p = q.pop(), x = p % w, y = (p / w) | 0; n++;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (nx >= 0 && ny >= 0 && nx < w && ny < h) { const t = ny * w + nx; if (!gone[t] && !lab[t]) { lab[t] = L; q.push(t); } } }
    sizes[L] = n;
  }
  const minKeep = Math.max(...sizes) * 0.1;
  const body = createCanvas(w, h), bg = body.getContext('2d'), out = bg.createImageData(w, h);
  for (let p = 0; p < w * h; p++) if (lab[p] && sizes[lab[p]] >= minKeep) { out.data.set(px.subarray(p * 4, p * 4 + 3), p * 4); out.data[p * 4 + 3] = 255; }
  bg.putImageData(out, 0, 0);
  const R = halo, sil = createCanvas(w, h), sg = sil.getContext('2d');
  sg.drawImage(body, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#fff'; sg.fillRect(0, 0, w, h);
  const res = createCanvas(w + 2 * R, h + 2 * R), g = res.getContext('2d');
  for (let a = 0; a < 32; a++) for (const rr of [R, R * 0.6]) g.drawImage(sil, R + Math.cos((a / 32) * 6.283) * rr, R + Math.sin((a / 32) * 6.283) * rr);
  g.drawImage(sil, R, R); g.drawImage(body, R, R);
  return res;
}

const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
const put = (g, spr, x, y, sc = 1) => g.drawImage(spr, Math.round(x), Math.round(y), Math.round(spr.width * sc), Math.round(spr.height * sc));
const cut = (g, slots) => { g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; for (const s of slots) g.fillRect(s.x, s.y, s.w, s.h); g.restore(); };

// ---------------------------------------------------------------- Kawaii
async function kawaii() {
  const img = await loadImage('design-src/kawaii.png'), BG = [150, 224, 254];
  const spr = {
    catTL: sticker(img, [40, 5, 400, 385], 9), catBR: sticker(img, [695, 990, 1115, 1345], 9), heart: sticker(img, [35, 1145, 270, 1350], 9),
    big: [[920, 55, 1105, 225], [20, 520, 160, 650], [970, 478, 1125, 618], [28, 838, 170, 970], [980, 835, 1118, 968]].map((b) => sticker(img, b, 8)),
    small: keyed(img, [436, 52, 492, 104], BG, 14, 40)
  };
  return (g, W, H, slots, B) => {
    g.fillStyle = 'rgb(150,224,254)'; rr(g, 0, 0, W, H, 40); g.fill();
    g.strokeStyle = 'rgb(56,160,230)'; g.lineWidth = 10; rr(g, 5, 5, W - 10, H - 10, 36); g.stroke();
    g.strokeStyle = 'rgb(16,84,160)'; g.lineWidth = 8;
    for (const s of slots) { rr(g, s.x - 4, s.y - 4, s.w + 8, s.h + 8, 22); g.stroke(); }
    // side decorations (small + big paws) down the margins, clear of the corner pieces
    const mw = B.minX, top = B.minY + 70, bot = B.maxY - 70, big = Math.min(0.8, (mw * 0.86) / 150);
    let n = 0;
    for (let y = top; y < bot; y += 230, n++) {
      const left = n % 2 === 0, b = spr.big[(n % 4) + 1];
      put(g, b, left ? mw / 2 - (b.width * big) / 2 : W - mw / 2 - (b.width * big) / 2, y, big);
      const sm = spr.small, sx = left ? W - mw / 2 - sm.width / 2 : mw / 2 - sm.width / 2;
      if (y + 115 < bot) put(g, sm, sx, y + 115, 0.95);
      if (y + 40 < bot && n % 2) put(g, sm, left ? mw / 2 : W - mw / 2 - sm.width, y + 160, 0.8);
    }
    cut(g, slots);
    // corner pieces last: the cat's paw / ear rests over the photo edge, like the original
    const c1 = Math.min(0.8, (B.minY - 14) / spr.catTL.height); put(g, spr.catTL, B.minX - 20, Math.max(6, B.minY - spr.catTL.height * c1 + 22), c1);
    const bh = H - B.maxY, c2 = Math.min(0.8, (bh - 14) / spr.catBR.height); put(g, spr.catBR, W - spr.catBR.width * c2 - 12, B.maxY - 22, c2);
    const c3 = Math.min(0.62, (bh - 20) / spr.heart.height); put(g, spr.heart, 14, H - spr.heart.height * c3 - 12, c3);
    const p0 = spr.big[0], c4 = Math.min(0.7, (B.minY - 20) / p0.height); put(g, p0, W - p0.width * c4 - 14, 10, c4);
  };
}

// ---------------------------------------------------------------- Better Together
async function betterTogether() {
  const img = await loadImage('design-src/better-together.png'), BG = [252, 246, 231];
  const spr = { hearts: keyed(img, [40, 50, 255, 205], BG, 150, 260), tape: tape(img, [790, 10, 1125, 240]), caption: keyed(img, [190, 1110, 895, 1295], BG, 14, 70), smiley: keyed(img, [940, 1200, 1065, 1315], BG, 14, 70) };
  return (g, W, H, slots, B) => {
    g.fillStyle = 'rgb(252,246,231)'; rr(g, 0, 0, W, H, 44); g.fill();
    g.strokeStyle = 'rgb(178,162,148)'; g.lineWidth = 6; rr(g, 3, 3, W - 6, H - 6, 42); g.stroke();
    g.lineWidth = 5; g.strokeStyle = 'rgb(172,158,146)';
    for (const s of slots) { rr(g, s.x - 3, s.y - 3, s.w + 6, s.h + 6, 12); g.stroke(); }
    cut(g, slots);
    put(g, spr.hearts, 36, Math.max(10, (B.minY - spr.hearts.height) / 2 - 8));
    const ay = B.minY, ax = B.maxX - 24; // tape corner lands on the first photo's top-right corner
    put(g, spr.tape, ax - 245, ay - 168);
    const bh = H - B.maxY, capY = B.maxY + (bh - spr.caption.height) / 2 + 4;
    put(g, spr.caption, W * 0.475 - spr.caption.width / 2, capY);
    put(g, spr.smiley, B.maxX - spr.smiley.width, B.maxY + (bh - spr.smiley.height) / 2 + 22);
  };
}

// ---------------------------------------------------------------- Retro film
async function retro() {
  const img = await loadImage('design-src/retro-film.png'), BG = [10, 10, 10];
  const k = (b) => keyed(img, b, BG, 16, 90);
  const spr = { title: k([245, 35, 880, 195]), camera: k([50, 1095, 385, 1310]), capture: k([555, 1095, 1110, 1320]), railL: k([14, 130, 56, 680]), railR: k([1100, 130, 1144, 680]) };
  return (g, W, H, slots, B) => {
    g.fillStyle = 'rgb(10,10,10)'; rr(g, 0, 0, W, H, 40); g.fill();
    g.strokeStyle = 'rgb(205,205,210)'; g.lineWidth = 6; rr(g, 3, 3, W - 6, H - 6, 38); g.stroke();
    // sprocket holes + edge lettering, only alongside the photos (the title/caption zones stay clear, as in the design)
    g.save(); g.beginPath(); g.rect(0, 0, W, B.maxY); g.clip();
    const hw = 70, hh = 64;
    for (let y = 62; y + hh <= B.maxY; y += 130) for (const x of [50, W - 50 - hw]) { g.fillStyle = 'rgb(242,242,242)'; rr(g, x, y, hw, hh, 12); g.fill(); }
    for (let y = 130; y < B.maxY; y += 610) { put(g, spr.railL, 4, y); put(g, spr.railR, W - 4 - spr.railR.width, y); }
    g.restore();
    cut(g, slots);
    put(g, spr.title, W / 2 - spr.title.width / 2, Math.max(14, (B.minY - spr.title.height) / 2 + 4));
    const bh = H - B.maxY, sc = 0.9, y0 = B.maxY + (bh - spr.capture.height * sc) / 2 + 4;
    put(g, spr.camera, B.minX - 12, B.maxY + (bh - spr.camera.height * sc) / 2 + 4, sc);
    put(g, spr.capture, B.maxX + 24 - spr.capture.width * sc, y0, sc);
  };
}

// ---------------------------------------------------------------- Just Us (black doodle frame; heart-shaped window when there is a single photo)
async function justUs() {
  const img = await loadImage('design-src/just-us.png'), BG = [18, 18, 18];
  const k = (b) => keyed(img, b, BG, 40, 150);
  const spr = { title: k([60, 30, 390, 305]), arc: k([570, 80, 930, 325]), heartTR: k([940, 105, 1125, 300]), sparkTL: k([95, 255, 175, 340]), sparkBig: k([55, 910, 185, 1055]), sparkBL: k([330, 1150, 425, 1255]),
    sparkR: k([1000, 875, 1105, 995]), heartBL: k([120, 1075, 310, 1260]), heartBR: k([925, 1045, 1090, 1205]), waves: k([650, 1140, 1120, 1300]), sparkTM: k([465, 85, 555, 190]), sparkTR: k([1055, 300, 1120, 380]) };
  return (g, W, H, slots, B) => {
    g.fillStyle = 'rgb(18,18,18)'; rr(g, 0, 0, W, H, 40); g.fill();
    g.strokeStyle = 'rgb(214,214,214)'; g.lineWidth = 5; rr(g, 4, 4, W - 8, H - 8, 36); g.stroke();
    if (slots.length === 1) { // heart window, fitted to the slot (the design's whole point)
      const s = slots[0], hw = s.w, hh = hw * 0.93, hx = s.x, hy = s.y + (s.h - hh) / 2;
      g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.beginPath();
      const P = (x, y) => [hx + x * hw, hy + y * hh];
      g.moveTo(...P(0.5, 0.97));
      g.bezierCurveTo(...P(0.16, 0.74), ...P(0.0, 0.52), ...P(0.0, 0.31)); g.bezierCurveTo(...P(0.0, 0.1), ...P(0.15, 0.0), ...P(0.28, 0.0));
      g.bezierCurveTo(...P(0.4, 0.0), ...P(0.47, 0.07), ...P(0.5, 0.16)); g.bezierCurveTo(...P(0.53, 0.07), ...P(0.6, 0.0), ...P(0.72, 0.0));
      g.bezierCurveTo(...P(0.85, 0.0), ...P(1.0, 0.1), ...P(1.0, 0.31)); g.bezierCurveTo(...P(1.0, 0.52), ...P(0.84, 0.74), ...P(0.5, 0.97));
      g.closePath(); g.fill(); g.restore();
      put(g, spr.sparkBig, s.x + 4, s.y + s.h - spr.sparkBig.height - 4, 0.9); put(g, spr.sparkR, s.x + s.w - spr.sparkR.width - 6, s.y + s.h - spr.sparkR.height - 20, 0.9);
    } else {
      g.strokeStyle = 'rgb(236,236,236)'; g.lineWidth = 5;
      for (const s of slots) { rr(g, s.x - 3, s.y - 3, s.w + 6, s.h + 6, 10); g.stroke(); }
      cut(g, slots);
    }
    const topH = B.minY, botH = H - B.maxY;
    const t = Math.min(0.85, (topH - 24) / spr.title.height); put(g, spr.title, 34, 14, t);
    put(g, spr.sparkTL, 34 + 35 * t, 14 + 225 * t, t); // same spot relative to the lettering as in the design
    const a = Math.min(0.7, (topH - 24) / spr.arc.height); put(g, spr.arc, W * 0.40, 12, a);
    put(g, spr.heartTR, W - spr.heartTR.width * a - 40, 16, a); put(g, spr.sparkTM, W * 0.33, 14, 0.5);
    const b = Math.min(0.75, (botH - 24) / spr.heartBL.height);
    put(g, spr.heartBL, 38, B.maxY + 14, b); put(g, spr.sparkBL, 38 + spr.heartBL.width * b + 14, B.maxY + botH * 0.45, 0.6);
    put(g, spr.waves, W - spr.waves.width * 0.62 - 150, B.maxY + botH * 0.35, 0.62); put(g, spr.heartBR, W - spr.heartBR.width * b - 40, B.maxY + 12, b);
  };
}

const FRAMES = { kawaii: ['kawaii', kawaii], 'retro-film': ['retro', retro], 'better-together': ['better-together', betterTogether], 'just-us': ['just-us', justUs], 'manga-panel': ['manga', manga] };
const only = process.argv.slice(2);
// WebP (q92, alpha kept) is ~10x smaller than PNG, which keeps the offline cache small; hand-made PNGs in the same folders still work.
const done = (dir, layoutId, c) => { rmSync(`src/assets/frames/${dir}/${layoutId}.png`, { force: true }); writeFileSync(`src/assets/frames/${dir}/${layoutId}.webp`, c.toBuffer('image/webp', 92)); console.log(`${dir}/${layoutId}.webp  ${c.width}x${c.height}`); };
const geom = (L) => { const slots = L.slots.map(([x, y, w, h]) => ({ x: x * S, y: y * S, w: w * S, h: h * S })); return { slots, B: { minX: Math.min(...slots.map((s) => s.x)), maxX: Math.max(...slots.map((s) => s.x + s.w)), minY: Math.min(...slots.map((s) => s.y)), maxY: Math.max(...slots.map((s) => s.y + s.h)) } }; };

for (const [id, [dir, make]] of Object.entries(FRAMES)) {
  if (only.length && !only.includes(id)) continue;
  const draw = await make();
  mkdirSync(`src/assets/frames/${dir}`, { recursive: true });
  for (const [layoutId, L] of Object.entries(layouts[id])) {
    const c = createCanvas(UNITS * S, L.h * S), g = c.getContext('2d'), { slots, B } = geom(L);
    g.imageSmoothingQuality = 'high';
    draw(g, c.width, c.height, slots, B, layoutId);
    done(dir, layoutId, c);
  }
}
for (const [id, cfg] of Object.entries(SLICED)) {
  if (only.length && !only.includes(id)) continue;
  const k = knockout(await loadImage(`design-src/${id}.png`), cfg);
  mkdirSync(`src/assets/frames/${cfg.dir}`, { recursive: true });
  for (const [layoutId, L] of Object.entries(layouts[id])) { const { slots, B } = geom(L); const c = drawSliced(k, { ...cfg, id }, L, slots, B), sc = c.width / k.w; done(cfg.dir, layoutId, cfg.post ? cfg.post(c, slots, { hx0: k.hole.x0 * sc, hx1: k.hole.x1 * sc, topH: cfg.cutA * sc, botH: (k.h - cfg.cutB) * sc }) : c); }
}
