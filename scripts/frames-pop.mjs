// "Pop Stickers" frame: the supplied sticker-collage design, rebuilt around each layout's real photo slots.
// The stickers are the ORIGINAL artwork (cut out of the reference with scripts/extract-pop-stickers.py, 2x resolution, in design-src/pop-stickers/),
// never stretched: they are only moved, scaled uniformly and (on tall layouts) repeated flipped / slightly rotated. The black-and-white
// diagonal-stripe sticker board, the thin window outline and the black rounded border are redrawn procedurally to match the reference.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';

const DIR = 'design-src/pop-stickers';
const S = 1152 / 900;          // reference design (cropped to its black border, 900 px wide) -> artwork width
const OX = 20, OY = 50;         // crop offset of the black border inside the reference image
const REF_H = 1570;             // cropped reference height
const OVERHANG = 26;            // a sticker may cover at most this many px of a photo edge
const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };

export async function pop() {
  const info = JSON.parse(readFileSync(`${DIR}/info.json`, 'utf8'));
  const spr = {};
  for (const k of Object.keys(info)) { const img = await loadImage(`${DIR}/${k}.png`); spr[k] = { img, ...info[k] }; } // w,h = reference px (sprite is 2x)
  const draw = (g, k, x, y, sc, o = {}) => { // x,y = top-left of the UNROTATED sprite in artwork px, sc = artwork px per reference px
    const s = spr[k], w = s.w * sc, h = s.h * sc;
    g.save(); g.translate(x + w / 2, y + h / 2); if (o.rot) g.rotate((o.rot * Math.PI) / 180); if (o.flip) g.scale(-1, 1);
    g.drawImage(s.img, -w / 2, -h / 2, w, h); g.restore();
  };
  const refTop = (k) => ({ x: (spr[k].x - OX) * S, y: (spr[k].y - OY) * S });

  /** Black-and-white diagonal stripes with the reference's bright-blue accent bands. */
  function board(g, W, H) {
    g.save(); rr(g, 0, 0, W, H, 52); g.clip();
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.translate(0, H); g.rotate((-55 * Math.PI) / 180);
    const reach = Math.hypot(W, H) + 400, P = 112;
    for (let n = -Math.ceil(reach / P); n < Math.ceil(reach / P) + 4; n++) {
      const y = n * P;
      g.fillStyle = '#0b0b0b'; g.fillRect(-reach, y, reach * 3, 58);
      if (((n % 3) + 3) % 3 !== 1) { g.fillStyle = 'rgb(38,162,236)'; g.fillRect(-reach, y + 58, reach * 3, ((n % 2) + 2) % 2 ? 20 : 12); }
    }
    g.restore();
  }
  function sparkle(g, cx, cy, r) { // small four-point sparkle: yellow body, thick black ink, white sticker halo
    const path = () => { g.beginPath(); g.moveTo(cx, cy - r); g.quadraticCurveTo(cx, cy, cx + r * 0.62, cy); g.quadraticCurveTo(cx, cy, cx, cy + r); g.quadraticCurveTo(cx, cy, cx - r * 0.62, cy); g.quadraticCurveTo(cx, cy, cx, cy - r); g.closePath(); };
    g.save(); g.lineJoin = 'round'; path(); g.strokeStyle = '#aaa'; g.lineWidth = r * 0.9 + 6; g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = r * 0.9 + 3; g.stroke();
    path(); g.fillStyle = '#ffd21f'; g.fill(); g.strokeStyle = '#111'; g.lineWidth = Math.max(4, r * 0.2); g.stroke(); g.restore();
  }
  /** Fill [y0,y1] of one side column with whole stickers (pool order, then repeats flipped/rotated), spacing the leftover evenly. */
  function column(g, pool, side, y0, y1, W, padPx) {
    const span = y1 - y0, lim = padPx + OVERHANG - 2, items = [];
    let total = 0;
    for (let i = 0; i < 40; i++) {
      const k = pool[i % pool.length], s = spr[k], sc = Math.min(S, lim / s.w), h = s.h * sc;
      if (items.length && total + h - 8 * items.length > span) break;
      items.push({ k, sc, h, cyc: Math.floor(i / pool.length), i }); total += h;
    }
    if (items.length === 1 && items[0].h > span) { items[0].sc *= span / items[0].h; items[0].h = span; total = span; }
    const gap = Math.min(90, (span - total) / (items.length + 1));
    let y = y0 + Math.max(0, (span - total - gap * (items.length - 1)) / 2);
    for (const it of items) {
      const s = spr[it.k], w = s.w * it.sc, flip = it.cyc % 2 === 1, rot = it.cyc ? (it.i % 2 ? 6 : -6) : 0;
      const x = side === 'L' ? Math.max(2, (padPx - w) / 2 + (it.i % 2 ? 4 : -4)) : Math.min(W - 2 - w, W - padPx + (padPx - w) / 2 + (it.i % 2 ? -4 : 4));
      draw(g, it.k, x, y, it.sc, { flip, rot }); y += it.h + gap;
    }
  }

  return (g, W, H, slots, B) => {
    const padPx = B.minX, e = 12;
    board(g, W, H);
    g.save(); g.lineJoin = 'round'; g.strokeStyle = '#0b0b0b'; g.lineWidth = 18; rr(g, 9, 9, W - 18, H - 18, 46); g.stroke(); g.restore();
    // photo windows: white paper with a thin black outline (like the reference), then the real slots cut out
    g.fillStyle = '#fff'; g.strokeStyle = '#0b0b0b'; g.lineWidth = 5;
    rr(g, B.minX - e, B.minY - e, B.maxX - B.minX + 2 * e, B.maxY - B.minY + 2 * e, 6); g.fill(); g.stroke();
    g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; for (const s of slots) g.fillRect(s.x, s.y, s.w, s.h); g.restore();
    g.strokeStyle = '#0b0b0b'; g.lineWidth = 5; for (const s of slots) { g.strokeRect(s.x - 2.5, s.y - 2.5, s.w + 5, s.h + 5); }

    // ---- top row (same composition on every layout, at the reference's own positions)
    const dy = (k, sc = S) => ({ ...refTop(k), sc });
    const topShift = -2; // keep the daisy inside the canvas
    draw(g, 'star_tl', refTop('star_tl').x, refTop('star_tl').y, S);
    draw(g, 'star_tl', (110 - OX) * S, (265 - OY) * S, S * 0.42, { rot: -10 }); draw(g, 'star_tl', (133 - OX) * S, (318 - OY) * S, S * 0.34, { rot: 12 });
    sparkle(g, (437 - OX) * S, (240 - OY) * S, 21); sparkle(g, (622 - OX) * S, (225 - OY) * S, 24);
    draw(g, 'smiley', refTop('smiley').x, refTop('smiley').y, S);
    draw(g, 'heart', refTop('heart').x, refTop('heart').y, S);
    const dsc = S * 0.92; draw(g, 'daisy', W - 3 - spr.daisy.w * dsc, 4, dsc);

    // ---- bottom row (anchored to the bottom edge, like the reference)
    const fromBottom = (k, sc, yOff = 0) => H - (REF_H - (spr[k].y + spr[k].h - OY)) * S - yOff;
    const l2 = Math.min(S, (padPx + OVERHANG) / spr.light2.w); draw(g, 'light2', 2, H - 24 - spr.light2.h * l2, l2);
    draw(g, 'kawaii', (spr.kawaii.x - OX) * S, fromBottom('kawaii') - spr.kawaii.h * S, S);
    const cs = S * 0.9; draw(g, 'cassette', (spr.cassette.x - OX) * S + (spr.cassette.w * S - spr.cassette.w * cs), fromBottom('cassette') - spr.cassette.h * cs, cs, { rot: 0 });
    draw(g, 'star_tl', W - 150, H - 150, S * 0.5, { rot: 14 });

    // ---- side columns (stickers move / repeat; they are never stretched)
    const l2Top = H - 24 - spr.light2.h * l2, s2 = Math.min(S * 0.875, (padPx + OVERHANG) / spr.straw2.w), s2h = spr.straw2.h * s2;
    const s2y = B.maxY + 20 - s2h;
    draw(g, 'straw2', W - 2 - spr.straw2.w * s2, s2y, s2);
    column(g, ['light1', 'flower', 'butterfly', 'blackstar'], 'L', B.minY + 70, Math.min(l2Top + 30, B.maxY - 40), W, padPx);
    column(g, ['star_r', 'pinkflower', 'rainbow', 'straw1'], 'R', 400 - 20, s2y + 12, W, padPx);
  };
}
