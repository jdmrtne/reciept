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
