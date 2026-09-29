/** 128-bit random token (32 hex chars), one per photo session. Unguessable, and never reused, so an old QR can only open its own session. */
export function newShareId(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(rand(16), (b) => b.toString(16).padStart(2, '0')).join('');
}
export const SHARE_ID_RE = /^[a-f0-9]{32}$/;

/**
 * Supabase session id: `YYYYMMDD-HHMMSS-<20 hex>` (local time + 80 random bits), e.g. `20260929-103045-a8f32c0d19e4b7a65f10`.
 * The time prefix sorts by date (easy cleanup); the random part keeps the public URL unguessable and prevents collisions.
 */
export function newSessionId(now: Date = new Date(), rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = `${p(now.getFullYear(), 4)}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${stamp}-${Array.from(rand(10), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
export const SESSION_ID_RE = /^\d{8}-\d{6}-[a-f0-9]{20}$/;
