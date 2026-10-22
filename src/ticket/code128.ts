/**
 * Code 128 encoder (set B for text, set C for digit pairs). PURE, no dependencies: the project only had a decorative barcode, and a real
 * scannable one is ~60 lines, so no library is added. Output = module widths (bar, space, bar, ...) starting with a bar.
 * Validated in ticket.test.ts (every pattern sums to 11 modules, checksum, and an independent decoder reads the rendered bitmap).
 */
const PATTERNS = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
  '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
  '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
  '114131 311141 411131 211412 211214 211232 2331112'
).split(' ');
export const CODE128_PATTERNS = PATTERNS;
const START_B = 104, START_C = 105, STOP = 106;

/** Printable ASCII only (code set B). Anything else is dropped so the encoder never throws on odd owner input. */
export const cleanBarcodeValue = (s: string) => [...String(s ?? '')].filter((c) => c >= ' ' && c <= '~').join('').slice(0, 24);

/** Symbol values (start, data, checksum, stop). All-digit, even-length values use set C (half the width); everything else set B. */
export function code128Symbols(value: string): number[] {
  const v = cleanBarcodeValue(value);
  if (!v) throw new Error('barcode-empty');
  const out: number[] = [];
  if (/^\d+$/.test(v) && v.length % 2 === 0) { out.push(START_C); for (let i = 0; i < v.length; i += 2) out.push(Number(v.slice(i, i + 2))); }
  else { out.push(START_B); for (const c of v) out.push(c.charCodeAt(0) - 32); }
  const sum = out.reduce((a, s, i) => a + s * (i === 0 ? 1 : i), 0);
  out.push(sum % 103, STOP);
  return out;
}

/** Run widths in modules: bar, space, bar, space... (the stop symbol ends with a 2-module bar). */
export const code128Runs = (value: string): number[] => code128Symbols(value).flatMap((s) => [...PATTERNS[s]].map(Number));
/** Total width in modules WITHOUT the quiet zones. */
export const code128Modules = (value: string): number => code128Runs(value).reduce((a, b) => a + b, 0);
export const CODE128_QUIET = 10; // modules of empty paper required each side

/** Decode runs back to the text (independent of the encoder's data path; used by tests). Returns null when the structure is invalid. */
export function decodeCode128Runs(runs: number[]): string | null {
  const syms: number[] = [];
  for (let i = 0; i + 6 <= runs.length; i += 6) {
    const idx = PATTERNS.findIndex((p, s) => s !== STOP && p === runs.slice(i, i + 6).join(''));
    if (idx < 0) break;
    syms.push(idx);
  }
  if (syms.length < 3 || ![103, 104, 105].includes(syms[0])) return null;
  if (runs.slice(syms.length * 6).join('') !== PATTERNS[STOP]) return null;
  const data = syms.slice(1, -1), check = syms[syms.length - 1];
  if ((syms[0] + data.reduce((a, s, i) => a + s * (i + 1), 0)) % 103 !== check) return null;
  if (syms[0] === START_C) return data.map((s) => String(s).padStart(2, '0')).join('');
  if (syms[0] === START_B) return data.map((s) => String.fromCharCode(s + 32)).join('');
  return null;
}
