/**
 * Object URLs for stored artwork, shared by both runtime registries (runtime.ts for own frames, eventRuntime.ts for event layouts).
 * One URL per picture; the picture is decoded in the background so the editor, preview and print find it ready (no flash).
 * If that decode FAILS, the registry can ask for one recovery: re-read the saved copy from storage and swap in a fresh URL (recoverArtUrl).
 * Best effort: nothing here ever throws or rejects. Pure browser plumbing: no storage, no React, imports nothing.
 */
const warm = new Map<string, Promise<void>>();

/** true when the browser can decode the picture behind this URL. true as well when there is no Image (tests, workers): nothing to check. */
export function imageDecodes(url: string): Promise<boolean> {
  if (typeof Image === 'undefined') return Promise.resolve(true);
  return new Promise<boolean>((res) => {
    try {
      const im = new Image(); im.src = url;
      if (im.decode) im.decode().then(() => res(true), () => res(false));
      else { im.onload = () => res(true); im.onerror = () => res(false); }
    } catch { res(true); }
  });
}

/** Decode in the background. When it fails, `onFail(url)` runs ONCE (it may swap the URL); `artReady` waits for it too. */
function warmUp(url: string, onFail?: (url: string) => Promise<void>): void {
  if (warm.has(url) || typeof Image === 'undefined') return;
  warm.set(url, imageDecodes(url).then((ok) => (ok || !onFail ? undefined : onFail(url))).catch(() => undefined));
}

/** One object URL for the blob, or null when the browser cannot make one (the picture is then simply not offered). */
export function createArtUrl(blob: Blob, onFail?: (url: string) => Promise<void>): string | null {
  try { const u = URL.createObjectURL(blob); warmUp(u, onFail); return u; } catch { return null; }
}

/** Free the URL. Safe to call with anything, twice, or for a URL that never existed. */
export function revokeArtUrl(url: string | null | undefined): void {
  if (!url) return;
  try { warm.delete(url); URL.revokeObjectURL(url); } catch { /* ignore */ }
}

/**
 * One recovery attempt for a picture that would not decode: `readBlob` re-reads the SAVED copy (a fresh Blob from storage, independent of
 * the one in memory), a new URL is made and decoded, and only a URL that really decodes is handed to `swap`. `isCurrent` must say whether
 * the failed URL is still the live one (the picture may have been replaced or deleted meanwhile; then nothing is swapped). When anything
 * fails the old URL stays exactly as it was. Never throws; returns whether a new URL was swapped in.
 */
export async function recoverArtUrl(readBlob: () => Promise<Blob | null>, isCurrent: () => boolean, swap: (url: string) => void): Promise<boolean> {
  let url: string | null = null;
  try {
    const blob = await readBlob();
    if (!blob || !isCurrent()) return false;
    url = URL.createObjectURL(blob);
    if (!(await imageDecodes(url)) || !isCurrent()) { URL.revokeObjectURL(url); return false; }
    warm.set(url, Promise.resolve());
    swap(url);
    return true;
  } catch { try { if (url) URL.revokeObjectURL(url); } catch { /* ignore */ } return false; }
}

/** Resolves when every given URL is decoded (and its one recovery, if it needed one, is done). Resolves at once for unknown URLs and an empty list. */
export function artReady(urls: readonly (string | null | undefined)[]): Promise<void> {
  return Promise.all(urls.map((u) => (u ? warm.get(u) ?? Promise.resolve() : Promise.resolve()))).then(() => undefined);
}
