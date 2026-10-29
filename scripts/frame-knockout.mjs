// Turns a flat frame design (opaque white photo window) into a transparent-window PNG.
// usage: node scripts/frame-knockout.mjs <in.png> <out.png> [seedX,seedY] [tolerance=18]
// Flood-fills from the seed (default: image centre) through near-white pixels and makes them fully transparent.
// Run it on your own artwork BEFORE adding it to src/assets/frames. It never touches the input file.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';

const [inp, outp, seedArg, tolArg] = process.argv.slice(2);
if (!inp || !outp) { console.error('usage: node scripts/frame-knockout.mjs <in.png> <out.png> [x,y] [tolerance]'); process.exit(1); }
const img = await loadImage(inp), W = img.width, H = img.height, tol = Number(tolArg ?? 18);
const c = createCanvas(W, H), g = c.getContext('2d');
g.drawImage(img, 0, 0);
const data = g.getImageData(0, 0, W, H), d = data.data;
const [sx, sy] = (seedArg ?? `${W >> 1},${H >> 1}`).split(',').map(Number);
const white = (i) => d[i] >= 255 - tol && d[i + 1] >= 255 - tol && d[i + 2] >= 255 - tol;
if (!white((sy * W + sx) * 4)) { console.error(`seed ${sx},${sy} is not near-white; pass a seed inside the photo window`); process.exit(1); }
const seen = new Uint8Array(W * H), stack = [sy * W + sx];
seen[stack[0]] = 1;
let cleared = 0;
while (stack.length) {
  const p = stack.pop(), x = p % W, y = (p / W) | 0;
  d[p * 4 + 3] = 0; cleared++;
  for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const q = ny * W + nx;
    if (!seen[q] && white(q * 4)) { seen[q] = 1; stack.push(q); }
  }
}
// Half-transparent 1px halo so the cut edge isn't jagged / doesn't leave a white fringe.
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const p = y * W + x;
  if (d[p * 4 + 3] === 0) continue;
  if ((x > 0 && d[(p - 1) * 4 + 3] === 0) || (x < W - 1 && d[(p + 1) * 4 + 3] === 0) || (y > 0 && d[(p - W) * 4 + 3] === 0) || (y < H - 1 && d[(p + W) * 4 + 3] === 0))
    if (white(p * 4)) d[p * 4 + 3] = 0;
}
g.putImageData(data, 0, 0);
writeFileSync(outp, c.toBuffer('image/png'));
console.log(`${outp}: ${W}x${H}, cleared ${cleared} px (${((cleared / (W * H)) * 100).toFixed(1)}%)`);
