import { QUIET, qrPath } from '../share/qr';

/** Crisp vector QR: black modules on a white square with the 4-module quiet zone scanners need. */
export function QrCode({ matrix, label }: { matrix: boolean[][]; label: string }) {
  const n = matrix.length, span = n + QUIET * 2;
  return (
    <svg className="qr" viewBox={`${-QUIET} ${-QUIET} ${span} ${span}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-QUIET} y={-QUIET} width={span} height={span} fill="#fff" />
      <path d={qrPath(matrix)} fill="#000" />
    </svg>
  );
}
