import type { Orn, PathCmd, Prim } from './types';

/**
 * Hand-drawn line ornaments. Each is a few strokes in a 100×100 box (absolute M/L/Q/C/Z only),
 * stroked in black with round joins: no fills except white knock-outs, no gradients, prints cleanly in 1-bit.
 */
const ART: Record<Orn, string[]> = {
  star: ['M50 8 L61 38 L92 39 L67 58 L76 90 L50 71 L24 90 L33 58 L8 39 L39 38 Z'],
  heart: ['M50 88 C6 58 4 24 28 18 C40 15 48 22 50 32 C52 22 60 15 72 18 C96 24 94 58 50 88 Z', 'M24 32 Q27 26 34 25'],
  balloon: ['M50 8 C22 8 18 42 34 60 C40 67 46 70 50 72 C54 70 60 67 66 60 C82 42 78 8 50 8 Z', 'M46 72 L50 80 L54 72', 'M50 80 Q40 88 50 96', 'M34 24 Q37 16 44 14'],
  'party-hat': ['M50 10 L84 90 L16 90 Z', 'M34 52 L66 52', 'M26 72 L74 72', 'M50 10 L46 2 M50 10 L56 3 M50 10 L60 8'],
  cap: ['M50 22 L94 40 L50 58 L6 40 Z', 'M26 50 L26 72 Q50 86 74 72 L74 50', 'M94 40 L94 66', 'M94 66 L90 76 M94 66 L98 76'],
  smile: ['M50 6 C76 6 94 26 94 50 C94 76 74 94 50 94 C26 94 6 76 6 50 C6 26 24 6 50 6 Z', 'M34 38 L34 46', 'M66 38 L66 46', 'M28 62 Q50 84 72 62'],
  bones: ['M18 82 L82 18', 'M18 18 L82 82', 'M10 88 C4 84 8 76 14 78 M22 92 C18 86 24 80 28 84', 'M78 12 C84 8 92 14 86 20 M90 24 C94 18 88 12 82 12', 'M10 12 C4 16 8 24 14 22 M22 8 C18 14 24 20 28 16', 'M78 88 C84 92 92 86 86 80 M90 76 C94 82 88 88 82 88'],
  sparkle: ['M50 6 Q56 44 94 50 Q56 56 50 94 Q44 56 6 50 Q44 44 50 6 Z'],
  anchor: ['M50 16 L50 88', 'M32 34 L68 34', 'M14 62 Q18 88 50 88 Q82 88 86 62', 'M14 62 L8 74 M14 62 L24 68 M86 62 L92 74 M86 62 L76 68']
};

const parse = (d: string): PathCmd[] => {
  const t = d.match(/[MLQCZ]|-?\d+(?:\.\d+)?/g) ?? [], out: PathCmd[] = [], N = { M: 2, L: 2, Q: 4, C: 6, Z: 0 } as const;
  for (let i = 0; i < t.length;) {
    const c = t[i++] as keyof typeof N, n = N[c];
    const a = t.slice(i, i + n).map(Number); i += n;
    out.push([c, ...a] as unknown as PathCmd);
  }
  return out;
};

/** Ornament centred at (cx, cy), `size` units wide, optionally rotated (degrees). Stroke width in units. */
export function ornament(id: Orn, cx: number, cy: number, size: number, sw: number, rot = 0): Prim[] {
  const s = size / 100, a = (rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const tr = (x: number, y: number): [number, number] => {
    const px = (x - 50) * s, py = (y - 50) * s;
    return [cx + px * ca - py * sa, cy + px * sa + py * ca];
  };
  return ART[id].map((d) => ({
    k: 'path' as const, stroke: '#000', sw,
    cmds: parse(d).map((c) => {
      if (c[0] === 'Z') return c;
      const out: number[] = [];
      for (let i = 1; i < c.length; i += 2) out.push(...tr(c[i] as number, c[i + 1] as number));
      return [c[0], ...out] as unknown as PathCmd;
    })
  }));
}

/** Deterministic pseudo-random in [-1, 1] so a frame looks identical in editor, preview and print. */
const rnd = (seed: number) => { let h = Math.imul(seed ^ 0x9e3779b9, 2654435761); h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return ((h >>> 0) / 4294967295) * 2 - 1; };

/** A rounded rectangle whose sides wander a little, like it was drawn with a pen. */
export function sketchRect(x: number, y: number, w: number, h: number, r: number, amp: number, seed: number): PathCmd[] {
  const j = (n: number) => rnd(seed * 31 + n) * amp;
  const out: PathCmd[] = [['M', x + r, y + j(0)]];
  const side = (x1: number, y1: number, x2: number, y2: number, n: number) => {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, horiz = y1 === y2;
    out.push(['Q', horiz ? mx : mx + j(n), horiz ? my + j(n) : my, x2, y2]);
  };
  side(x + r, y, x + w - r, y, 1);
  out.push(['Q', x + w + j(2), y + j(3), x + w, y + r]);
  side(x + w, y + r, x + w, y + h - r, 4);
  out.push(['Q', x + w + j(5), y + h + j(6), x + w - r, y + h]);
  side(x + w - r, y + h, x + r, y + h, 7);
  out.push(['Q', x + j(8), y + h + j(9), x, y + h - r]);
  side(x, y + h - r, x, y + r, 10);
  out.push(['Q', x + j(11), y + j(12), x + r, y], ['Z']);
  return out;
}

/** Ragged torn-paper outline for the wanted poster. */
export function tornRect(x: number, y: number, w: number, h: number, step: number, amp: number, seed: number): PathCmd[] {
  const out: PathCmd[] = [['M', x, y]];
  const run = (x1: number, y1: number, x2: number, y2: number, nx: number, ny: number, n0: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(2, Math.round(len / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n, o = i === n ? 0 : rnd(seed * 17 + n0 + i) * amp;
      out.push(['L', x1 + (x2 - x1) * t + nx * o, y1 + (y2 - y1) * t + ny * o]);
    }
  };
  run(x, y, x + w, y, 0, 1, 0); run(x + w, y, x + w, y + h, 1, 0, 100); run(x + w, y + h, x, y + h, 0, 1, 200); run(x, y + h, x, y, 1, 0, 300);
  out.push(['Z']);
  return out;
}
