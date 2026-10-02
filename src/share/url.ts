export type ShareFile = 'photo.jpg' | 'photo.gif';

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?)$/i;

/** Normalises the owner's PUBLIC address. Returns null when it can't work for a customer's phone (empty, not http(s), or loopback). */
export function normalizePublicBase(raw: string): string | null {
  const t = raw.trim().replace(/\/+$/, '');
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (LOOPBACK.test(u.hostname)) return null; // a phone would open ITS OWN localhost
    if (u.search || u.hash) return null;
    return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, ''));
  } catch { return null; }
}

/** The link a customer's phone opens (also what the QR encodes). */
export const publicUrl = (base: string, id: string, file: ShareFile) => `${base}/s/${id}/${file}`;
/** Where the booth uploads to (the bridge; a local address is fine here). */
export const uploadUrl = (bridgeUrl: string, id: string, file: ShareFile) => `${bridgeUrl.trim().replace(/\/+$/, '')}/share/${id}/${file}`;

/* ---------- the digital result page (what the ONE QR code opens) ---------- */

/** Route of the customer-facing page. Same path on both backends: the SPA serves it (Supabase) or the bridge's share server does. */
export const pagePath = (id: string) => `/p/${id}`;
/** The ONE address a photo session's QR code encodes. It carries only the id, never an image. */
export const pageUrl = (base: string, id: string) => `${base}${pagePath(id)}`;

/**
 * `/p/<id>` (also under a sub-path, with or without a trailing slash) → the raw id segment; any other path → null.
 * The id is NOT validated here: a mangled QR must still reach the page so the customer sees "not found" instead of the kiosk.
 */
export function photoPageId(pathname: string): string | null {
  const m = /(?:^|\/)p\/([^/]*)\/?$/.exec(pathname);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return ''; }
}

/**
 * The host the QR points at. An address the owner typed in ADMIN always wins. Without one: Supabase mode (the booth app itself
 * serves /p/<id>) falls back to the site the booth is running on; bridge mode needs the bridge's public address, so null.
 */
export function resolvePageBase(o: { cloud: boolean; publicBaseUrl: string; origin: string }): string | null {
  return normalizePublicBase(o.publicBaseUrl) ?? (o.cloud ? normalizePublicBase(o.origin) : null);
}
