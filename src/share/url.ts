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
