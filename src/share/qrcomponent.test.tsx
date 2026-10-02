// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import jsQR from 'jsqr';
import { QrCode } from '../components/QrCode';
import { newShareId } from './id';
import { qrMatrix } from './qr';
import { publicUrl } from './url';

/** Rasterises the SVG the screen really draws (viewBox, white square, merged-run path) and scans it. */
function scanMarkup(html: string, scale = 6): string | null {
  const vb = /viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(html)!, d = / d="([^"]+)"/.exec(html)![1];
  const [minX, minY, w] = [Number(vb[1]), Number(vb[2]), Number(vb[3])], px = w * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, len] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < len * scale; dx++) { const i = (((y - minY) * scale + dy) * px + (x - minX) * scale + dx) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
  }
  return jsQR(data, px, px)?.data ?? null;
}

describe('<QrCode/> markup', () => {
  it('draws an SVG whose pixels scan back to the URL, with an accessible label', () => {
    for (const file of ['photo.jpg', 'photo.gif'] as const) {
      const url = publicUrl('https://photos.example.com', newShareId(), file);
      const html = renderToStaticMarkup(<QrCode matrix={qrMatrix(url)} label="COLOR PHOTO QR code" />);
      expect(html).toContain('aria-label="COLOR PHOTO QR code"');
      expect(scanMarkup(html)).toBe(url);
    }
  });
});
