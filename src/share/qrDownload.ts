import { drawQr, qrScale } from './qr';

/** The QR alone (quiet zone included, nothing else) as a square PNG, at least `minPx` wide, on whole-pixel modules. */
export function qrPngBlob(matrix: boolean[][], minPx = 1024, makeCanvas: (w: number, h: number) => HTMLCanvasElement = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h })): Promise<Blob> {
  const side = (matrix.length + 8) * qrScale(matrix, minPx), c = makeCanvas(side, side), g = c.getContext('2d');
  if (!g) return Promise.reject(new Error('no-canvas'));
  drawQr(g, matrix, 0, 0, side);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
}

/** Browser "save as": downloads the QR PNG. Resolves false (never throws) if the browser could not make the file. */
export async function downloadQrPng(matrix: boolean[][], id: string): Promise<boolean> {
  try {
    const url = URL.createObjectURL(await qrPngBlob(matrix));
    const a = Object.assign(document.createElement('a'), { href: url, download: `photobooth-qr-${id}.png` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch { return false; }
}
