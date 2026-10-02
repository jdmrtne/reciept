import qrcode from 'qrcode-generator';

/** QR modules (true = dark). Error correction M; version auto-picked. Throws when the text can't be encoded. */
export function qrMatrix(text: string): boolean[][] {
  if (!text || text.length > 300) throw new Error('qr-length');
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

/** SVG path (one rect per dark run, merged per row) over a `size × size` module grid; add a 4-module quiet zone via the viewBox. */
export function qrPath(m: boolean[][]): string {
  let d = '';
  m.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) { x++; continue; }
      let e = x; while (e < row.length && row[e]) e++;
      d += `M${x} ${y}h${e - x}v1h-${e - x}z`;
      x = e;
    }
  });
  return d;
}
export const QUIET = 4;

/** Smallest whole-module scale whose side (modules + quiet zone) reaches `minPx`: crisp edges, no blur from fractional modules. */
export const qrScale = (matrix: boolean[][], minPx = 1024) => Math.max(1, Math.ceil(minPx / (matrix.length + QUIET * 2)));

/**
 * Draws the QR (with its quiet zone) as a `size × size` square at (x, y) on any 2D canvas: white square, black modules.
 * The ONE drawing routine: the PNG download uses it now and Phase 2's printable-frame composer can call it on the frame canvas.
 */
export function drawQr(g: Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>, matrix: boolean[][], x: number, y: number, size: number): void {
  const m = size / (matrix.length + QUIET * 2);
  g.fillStyle = '#fff'; g.fillRect(x, y, size, size);
  g.fillStyle = '#000';
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) { c++; continue; }
      let e = c; while (e < row.length && row[e]) e++;
      g.fillRect(x + (c + QUIET) * m, y + (r + QUIET) * m, (e - c) * m, m);
      c = e;
    }
  });
}
