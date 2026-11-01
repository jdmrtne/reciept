/**
 * Where installed booths look for the latest published version. A URL to a version.json (see scripts/version-plugin.mjs).
 * Default: this site's own /version.json, which is what gets deployed together with the app. Overridable per device
 * (ADMIN > Updates > Update source) or for every device at build time with VITE_UPDATE_URL.
 * Stored on its own key so the main booth settings (config/settings.ts) are not touched.
 */
export const SOURCE_KEY = 'booth.update.source.v1';
export const DEFAULT_SOURCE = '/version.json';

export interface KeyValue { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const safeStore = (): KeyValue | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export const buildDefaultSource = (): string => {
  const v = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_UPDATE_URL : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : DEFAULT_SOURCE;
};

export function readSource(store: KeyValue | null = safeStore(), fallback = buildDefaultSource()): string {
  try { const v = store?.getItem(SOURCE_KEY); return v && v.trim() ? v.trim() : fallback; } catch { return fallback; }
}

export const isDefaultSource = (src: string, fallback = buildDefaultSource()): boolean => src === fallback;

/** Accepts a path on this site ("/version.json") or a full https:// address. http:// only when this page is itself served over http (LAN / dev). */
export function validateSource(input: string, pageProtocol: string = typeof location !== 'undefined' ? location.protocol : 'https:'): { ok: true; value: string } | { ok: false; error: string } {
  const v = input.trim();
  if (!v) return { ok: false, error: 'TYPE AN ADDRESS, OR USE THE DEFAULT' };
  if (/\s/.test(v)) return { ok: false, error: 'THE ADDRESS CANNOT CONTAIN SPACES' };
  if (v.startsWith('/') && !v.startsWith('//')) return { ok: true, value: v };
  let u: URL;
  try { u = new URL(v); } catch { return { ok: false, error: 'NOT A VALID ADDRESS. USE A PATH LIKE /version.json OR A FULL https:// ADDRESS' }; }
  if (u.protocol === 'https:') return { ok: true, value: v };
  if (u.protocol === 'http:' && pageProtocol === 'http:') return { ok: true, value: v };
  return { ok: false, error: u.protocol === 'http:' ? 'THIS SITE IS HTTPS, SO THE BROWSER BLOCKS AN http:// SOURCE. USE https://' : 'THE ADDRESS MUST START WITH https://' };
}

/** Saves (or, for the default, clears) the source. Returns false when the device refused the write. */
export function writeSource(value: string, store: KeyValue | null = safeStore(), fallback = buildDefaultSource()): boolean {
  if (!store) return false;
  try {
    if (value === fallback) store.removeItem(SOURCE_KEY); else store.setItem(SOURCE_KEY, value);
    return true;
  } catch { return false; }
}

/** True when the source is on another site: the check works, but INSTALL can only ever update the site this app was loaded from. */
export function isForeignSource(src: string, origin: string = typeof location !== 'undefined' ? location.origin : ''): boolean {
  try { return new URL(src, origin).origin !== origin; } catch { return false; }
}
