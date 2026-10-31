/**
 * Object URLs for stored artwork, shared by the event layout registry (eventRuntime.ts). One URL per picture; the picture is decoded in
 * the background so the editor, preview and print find it ready (no flash). Best effort: nothing here ever throws or rejects.
 * Pure browser plumbing: no storage, no React, imports nothing. (runtime.ts keeps its own copy of the same few lines until it is switched over.)
 */
const warm = new Map<string, Promise<void>>();

function warmUp(url: string): void {
  if (warm.has(url) || typeof Image === 'undefined') return;
  warm.set(url, new Promise<void>((res) => { try { const im = new Image(); im.src = url; (im.decode ? im.decode() : Promise.resolve()).then(() => res(), () => res()); } catch { res(); } }));
}

/** One object URL for the blob, or null when the browser cannot make one (the picture is then simply not offered). */
export function createArtUrl(blob: Blob): string | null {
  try { const u = URL.createObjectURL(blob); warmUp(u); return u; } catch { return null; }
}

/** Free the URL. Safe to call with anything, twice, or for a URL that never existed. */
export function revokeArtUrl(url: string | null | undefined): void {
  if (!url) return;
  try { warm.delete(url); URL.revokeObjectURL(url); } catch { /* ignore */ }
}

/** Resolves when every given URL is decoded. Resolves at once for unknown URLs and an empty list. */
export function artReady(urls: readonly (string | null | undefined)[]): Promise<void> {
  return Promise.all(urls.map((u) => (u ? warm.get(u) ?? Promise.resolve() : Promise.resolve()))).then(() => undefined);
}
