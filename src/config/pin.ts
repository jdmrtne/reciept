/**
 * Owner PIN for the hidden ADMIN screen. Pure + DOM-free except `loadAdmin/saveAdmin` (localStorage, guarded).
 * Kept OUT of BoothSettings so it never travels with the tuning values. This is a kiosk door lock, not bank
 * security: the PIN is salted+hashed (SHA-256) so it is not readable in storage, and wrong guesses lock the
 * screen for a while. Forgotten PIN = clear the site's data in the browser (settings are lost too).
 */

export interface PinRecord { salt: string; hash: string }
export interface LockState { fails: number; lockedUntil: number }
export interface AdminState { pin: PinRecord | null; lock: LockState }

export const PIN_MIN = 4;
export const PIN_MAX = 8;
export const MAX_FAILS = 5;
export const LOCK_MS = 60_000;

export const isValidPin = (pin: string) => new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);

/** Small non-crypto fallback for insecure contexts where crypto.subtle is missing (the booth needs HTTPS anyway). */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'f' + h.toString(16).padStart(8, '0');
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const text = `${salt}:${pin}`;
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) return fnv(text);
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const randomSalt = () => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) return [...c.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
};

export async function createPinRecord(pin: string, salt: string = randomSalt()): Promise<PinRecord> {
  if (!isValidPin(pin)) throw new Error('invalid pin');
  return { salt, hash: await hashPin(pin, salt) };
}

export async function verifyPin(record: PinRecord | null, pin: string): Promise<boolean> {
  if (!record || !isValidPin(pin)) return false;
  return (await hashPin(pin, record.salt)) === record.hash;
}

export const NO_LOCK: LockState = { fails: 0, lockedUntil: 0 };
export const isLocked = (l: LockState, now: number) => now < l.lockedUntil;
export const lockRemainingMs = (l: LockState, now: number) => Math.max(0, l.lockedUntil - now);

/** Pure lockout bookkeeping: success clears everything; MAX_FAILS wrong PINs lock for LOCK_MS. */
export function registerAttempt(l: LockState, ok: boolean, now: number): LockState {
  if (ok) return NO_LOCK;
  const fails = l.fails + 1;
  return fails >= MAX_FAILS ? { fails: 0, lockedUntil: now + LOCK_MS } : { fails, lockedUntil: l.lockedUntil };
}

const KEY = 'booth.admin.v1';

/** Repairs anything malformed (hand edits, older versions) into a safe state. */
export function normalizeAdmin(raw: unknown): AdminState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AdminState>;
  const p = r.pin;
  const pin = p && typeof p === 'object' && typeof p.salt === 'string' && typeof p.hash === 'string' && p.salt && p.hash ? { salt: p.salt, hash: p.hash } : null;
  const l = r.lock;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return { pin, lock: { fails: Math.min(MAX_FAILS - 1, Math.floor(num(l?.fails))), lockedUntil: num(l?.lockedUntil) } };
}

export function loadAdmin(): AdminState {
  try { const raw = localStorage.getItem(KEY); return normalizeAdmin(raw ? JSON.parse(raw) : null); }
  catch { return normalizeAdmin(null); }
}

export function saveAdmin(a: AdminState): void {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* storage unavailable: booth keeps working, admin just can't remember a PIN */ }
}
