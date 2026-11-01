/**
 * Owner-chosen ORDER of layouts and frames (ADMIN > Layouts / Frames, drag to rearrange). PURE: no DOM, no storage.
 * The setting stores ids in the order the owner wants. Anything not listed (a layout or frame added later, an event frame)
 * keeps its normal relative order and goes AFTER the listed ones, so nothing ever goes missing because of the order.
 * Display only: ids, frame locking, rendering and printing never read it.
 */

/** Repairs a stored value: non-array -> [], non-strings and duplicates dropped (first wins), capped so a hand-edited blob cannot grow forever. */
export function normalizeOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) if (typeof v === 'string' && v !== '' && !out.includes(v)) out.push(v);
  return out.slice(0, 500);
}

/** `items` sorted by `order` (listed ids first, in that order); unlisted items follow in their original order. Never drops or duplicates an item. */
export function applyOrder<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  if (order.length === 0) return [...items];
  const rank = new Map<string, number>();
  order.forEach((id, i) => { if (!rank.has(id)) rank.set(id, i); });
  const listed = items.filter((x) => rank.has(x.id)).sort((a, b) => (rank.get(a.id) as number) - (rank.get(b.id) as number));
  const rest = items.filter((x) => !rank.has(x.id));
  return [...listed, ...rest];
}

/** Moves the id at `from` to `to` (both clamped). Returns a new array; the same contents when nothing moves. */
export function moveId(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  if (from < 0 || from >= next.length) return next;
  const t = Math.max(0, Math.min(next.length - 1, to));
  if (t === from) return next;
  const [x] = next.splice(from, 1);
  next.splice(t, 0, x);
  return next;
}

/**
 * The new FULL order after the owner rearranged ONE sub-list (e.g. only the RECEIPT STYLES tiles). `fullIds` is the current full
 * order, `groupIds` the ids of the sub-list in their NEW order. The sub-list's items take over exactly the positions the
 * sub-list held before, so the other items (and the way the two lists interleave) do not move.
 */
export function mergeGroupOrder(fullIds: readonly string[], groupIds: readonly string[]): string[] {
  const inGroup = new Set(groupIds);
  const queue = [...groupIds];
  return fullIds.map((id) => (inGroup.has(id) ? (queue.shift() as string) : id));
}
