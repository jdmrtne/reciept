/**
 * Photo rotation on placement, for layouts authored for a sideways ticket (LayoutDef.photoRotation). The captured photo URL is never touched:
 * a rotated COPY is drawn once into a canvas and kept as its own object URL (cached per source URL + angle), so switching layouts back and
 * forth re-uses it. The copy is what the editor/preview/print/GIF stills use, so crop math and rendering need no rotation support.
 * Every copy is revoked by `releaseRotated()` (session reset), like the captured photos themselves.
 */
export interface Rotated { src: string; iw: number; ih: number }

/** Pure: the size of an image after a quarter turn (90 swaps width and height). */
export const rotatedSize = (iw: number, ih: number, deg: 0 | 90): { iw: number; ih: number } => (deg === 90 ? { iw: ih, ih: iw } : { iw, ih });

const cache = new Map<string, Promise<Rotated>>();
const made: string[] = [];
/** rotated copy URL → the captured photo URL it was made from. The GIF needs it: footage is recorded under the CAPTURED photo's URL. */
const originals = new Map<string, string>();
export const originalSrcOf = (url: string): string => originals.get(url) ?? url;

/** Draws `img` rotated 90° clockwise. (x, y) of the source lands at (ih - y, x). */
export function drawRotated90(g: { translate(x: number, y: number): void; rotate(a: number): void; drawImage(i: never, x: number, y: number): void }, img: unknown, ih: number): void {
  g.translate(ih, 0); g.rotate(Math.PI / 2); g.drawImage(img as never, 0, 0);
}

export function rotatePhoto(src: string, deg: 0 | 90, iw: number, ih: number, img: CanvasImageSource): Promise<Rotated> {
  if (deg === 0) return Promise.resolve({ src, iw, ih });
  const key = `${src}|${deg}`, hit = cache.get(key);
  if (hit) return hit;
  const p = new Promise<Rotated>((res, rej) => {
    const c = document.createElement('canvas'), o = rotatedSize(iw, ih, deg);
    c.width = o.iw; c.height = o.ih;
    const g = c.getContext('2d');
    if (!g) return rej(new Error('canvas'));
    drawRotated90(g, img, ih);
    c.toBlob((b) => {
      if (!b) return rej(new Error('rotate'));
      const url = URL.createObjectURL(b); made.push(url); originals.set(url, src);
      res({ src: url, iw: o.iw, ih: o.ih });
    }, 'image/jpeg', 0.92);
  });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

/** Revokes every rotated copy (called when the customer's session is wiped). */
export function releaseRotated(): void {
  made.splice(0).forEach((u) => URL.revokeObjectURL(u));
  cache.clear();
  originals.clear();
}
