/** Decorative barcode: deterministic bars from a seed string (not a scannable code). */
export function Barcode({ seed, height = 44 }: { seed: string; height?: number }) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (let i = 0; i < 38; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const w = 1 + (Math.abs(h) % 4);
    bars.push({ x, w });
    x += w + 1 + (Math.abs(h >> 5) % 3);
  }
  return (
    <svg className="barcode" viewBox={`0 0 ${x} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="currentColor" />)}
    </svg>
  );
}
