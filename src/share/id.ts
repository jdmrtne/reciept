/** 128-bit random token (32 hex chars), one per photo session. Unguessable, and never reused, so an old QR can only open its own session. */
export function newShareId(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(rand(16), (b) => b.toString(16).padStart(2, '0')).join('');
}
export const SHARE_ID_RE = /^[a-f0-9]{32}$/;
