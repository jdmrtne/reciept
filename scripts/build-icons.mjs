// Builds the whole icon set from ONE source logo (square PNG >= 512px, or SVG).
// usage: npm run build-icons -- <logo.png|logo.svg> [--bg "#000000"] [--name "Receipt Photobooth"]
//   --small <file> = simplified mark for 16/32/48 px tab icons + favicon.svg (default: same as the logo)
//   current logo: npm run build-icons -- design-src/logo/logo.svg --small design-src/logo/logo-small.svg --bg "#ffffff"
// --bg is the solid colour behind the logo for the icons that cannot be transparent (iPhone home screen, maskable, social card).
// Writes: public/favicon.svg, favicon.ico (16/32/48), favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png (180),
//         icons/icon-192.png, icons/icon-512.png, icons/icon-maskable-512.png (logo inside the 80% safe zone), og-image.png (1200x630)
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const bg = opt('--bg', '#000000'), name = opt('--name', 'Receipt Photobooth'), smallPath = opt('--small', null);
const srcPath = args[0] ?? 'public/favicon.svg';
const isSvg = extname(srcPath).toLowerCase() === '.svg';
const img = await loadImage(srcPath), tiny = smallPath ? await loadImage(smallPath) : img; // tiny = simplified mark for tab-sized icons
if (!isSvg && Math.min(img.width, img.height) < 512) console.warn(`warning: source is ${img.width}x${img.height}; 512x512 or larger recommended`);

/** Logo drawn "contain" into a size x size canvas; `inner` = fraction of the canvas the logo may use; `solid` paints bg first. */
function icon(size, { inner = 1, solid = false, src = img } = {}) {
  const c = createCanvas(size, size), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  if (solid) { g.fillStyle = bg; g.fillRect(0, 0, size, size); }
  const box = size * inner, s = Math.min(box / src.width, box / src.height), w = src.width * s, h = src.height * s;
  g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return c;
}
const png = (c) => c.toBuffer('image/png');
const out = (p, buf) => { writeFileSync(p, buf); console.log(p); };

// tab icons
out('public/favicon-16x16.png', png(icon(16, { src: tiny })));
out('public/favicon-32x32.png', png(icon(32, { src: tiny })));
const ico = [16, 32, 48].map((n) => png(icon(n, { src: tiny })));
const head = Buffer.alloc(6 + 16 * ico.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(ico.length, 4);
let off = head.length;
ico.forEach((b, i) => { const o = 6 + i * 16, n = [16, 32, 48][i]; head[o] = n; head[o + 1] = n; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(b.length, o + 8); head.writeUInt32LE(off, o + 12); off += b.length; });
out('public/favicon.ico', Buffer.concat([head, ...ico]));
const tinyIsSvg = extname(smallPath ?? srcPath).toLowerCase() === '.svg';
if (tinyIsSvg) out('public/favicon.svg', readFileSync(smallPath ?? srcPath));
else out('public/favicon.svg', Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 256 256"><image width="256" height="256" xlink:href="data:image/png;base64,${png(icon(256, { src: tiny })).toString('base64')}"/></svg>\n`));
// home screen / install icons
out('public/apple-touch-icon.png', png(icon(180, { solid: true, inner: 0.9 })));
out('public/icons/icon-192.png', png(icon(192, { solid: true, inner: 0.94 })));
out('public/icons/icon-512.png', png(icon(512, { solid: true, inner: 0.94 })));
out('public/icons/icon-maskable-512.png', png(icon(512, { solid: true, inner: 0.7 })));
// social share card
const og = createCanvas(1200, 630), g = og.getContext('2d');
g.fillStyle = bg; g.fillRect(0, 0, 1200, 630); g.drawImage(icon(300, { solid: false }), 120, 165, 300, 300);
const light = (() => { const n = parseInt(bg.replace('#', '').padEnd(6, '0').slice(0, 6), 16); return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140; })();
g.fillStyle = light ? '#111' : '#fff'; g.font = 'bold 66px "Courier New", monospace'; g.textBaseline = 'middle'; g.fillText(name.toUpperCase(), 470, 285, 680);
g.globalAlpha = 0.7; g.font = '34px "Courier New", monospace'; g.fillText('SELF-SERVICE PHOTO STATION', 470, 365, 680);
out('public/og-image.png', png(og));
