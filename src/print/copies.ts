/**
 * Multiple copies of ONE receipt. Pure helpers plus the copy loop, so the rules are testable without a screen or a printer.
 * The photo and QR are the same on every copy (the caller renders ONE bitmap and sends it N times).
 */
export const COPIES_MIN = 1;
export const MAX_COPIES_DEFAULT = 10;
/** Hard ceiling for the owner's "max copies" setting (ADMIN). */
export const MAX_COPIES_LIMIT = 30;
/** Pause between two copies so the printer's cutter and buffer finish the first one. */
export const COPY_GAP_MS = 400;

/** Owner setting, repaired: a whole number from 1 to MAX_COPIES_LIMIT, default 10. */
export function normalizeMaxCopies(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_COPIES_LIMIT, Math.max(COPIES_MIN, Math.round(v))) : MAX_COPIES_DEFAULT;
}

/** Copies this guest may still print: the owner's maximum minus what already came out in this session. Never negative. */
export const copiesLeft = (max: number, printedTotal: number): number => Math.max(0, normalizeMaxCopies(max) - Math.max(0, Math.floor(printedTotal) || 0));

/** The number the guest asks for, kept between 1 and what is left (0 left means 0: nothing can be printed). */
export function clampCopies(wanted: number, max: number, printedTotal: number): number {
  const left = copiesLeft(max, printedTotal);
  if (left === 0) return 0;
  const n = Number.isFinite(wanted) ? Math.round(wanted) : COPIES_MIN;
  return Math.min(left, Math.max(COPIES_MIN, n));
}

export interface CopyRun {
  /** Copies wanted in this run. */
  total: number;
  /** Copies of this run that already came out (a retry continues after them). */
  alreadyPrinted: number;
  /** Print ONE copy; `index` is 1-based. Reject on failure. */
  printOne: (index: number) => Promise<void>;
  /** Called after each copy came out, with the number printed so far in this run. */
  onCopyDone?: (printed: number) => void;
  /** Called before each copy starts, with its 1-based index. */
  onCopyStart?: (index: number) => void;
  /** Return true to stop quietly (the screen was left). */
  cancelled?: () => boolean;
  gapMs?: number;
  wait?: (ms: number) => Promise<void>;
}
export type CopyResult = { ok: true; printed: number } | { ok: false; printed: number; error: unknown } | { ok: false; printed: number; cancelled: true };

/** Prints the remaining copies one after another. Stops at the first failure and says how many came out, so a retry never repeats them. */
export async function runCopies(r: CopyRun): Promise<CopyResult> {
  const wait = r.wait ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  let printed = Math.max(0, Math.min(r.total, Math.floor(r.alreadyPrinted) || 0));
  while (printed < r.total) {
    if (r.cancelled?.()) return { ok: false, printed, cancelled: true };
    const index = printed + 1;
    r.onCopyStart?.(index);
    try { await r.printOne(index); } catch (error) { return { ok: false, printed, error }; }
    printed = index;
    r.onCopyDone?.(printed);
    if (printed < r.total) await wait(r.gapMs ?? COPY_GAP_MS);
  }
  return { ok: true, printed };
}
