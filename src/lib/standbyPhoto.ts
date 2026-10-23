/**
 * Owner-chosen standby photo. The image bytes live OUTSIDE BoothSettings (localStorage is ~5 MB and already holds the settings):
 * a resized JPEG Blob goes into IndexedDB, with a small data-URL fallback in localStorage when IndexedDB is unavailable.
 * Every function fails safe: a missing, corrupt or blocked store means "no photo", never an exception.
 */

export type PhotoFailure = 'unsupported' | 'unreadable' | 'too-large' | 'storage';
export type StoreResult = { ok: true } | { ok: false; reason: PhotoFailure };

export const PHOTO_MAX_EDGE = 1920;
export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
/** localStorage fallback ceiling (a data URL is ~1.37x the bytes, and the settings blob shares the same ~5 MB). */
export const PHOTO_FALLBACK_MAX_BYTES = 1.5 * 1024 * 1024;
/** Tried in order until the result fits PHOTO_MAX_BYTES. */
export const PHOTO_STEPS: { edge: number; quality: number }[] = [{ edge: PHOTO_MAX_EDGE, quality: 0.85 }, { edge: 1600, quality: 0.7 }, { edge: 1280, quality: 0.6 }];

const DB = 'booth.standby';
const STORE = 'photo';
const IDB_KEY = 'current';
const LS_KEY = 'booth.standbyPhoto.v1';

/** Scale (w,h) down so the long edge is at most `max`. Never upscales. Always >= 1px per side. */
export function fitSize(w: number, h: number, max: number): { w: number; h: number } {
  const long = Math.max(w, h);
  if (!(long > max)) return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Decode (honouring EXIF orientation), shrink and re-encode as JPEG. Reports why it failed instead of throwing. */
export async function resizePhoto(file: Blob): Promise<{ ok: true; blob: Blob } | { ok: false; reason: PhotoFailure }> {
  if (!file.type.startsWith('image/')) return { ok: false, reason: 'unsupported' };
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  try {
    for (const step of PHOTO_STEPS) {
      const { w, h } = fitSize(bmp.width, bmp.height, step.edge);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const g = canvas.getContext('2d');
      if (!g) return { ok: false, reason: 'unreadable' };
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); // flatten transparency (PNG) onto white instead of black
      g.drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', step.quality));
      if (!blob) return { ok: false, reason: 'unreadable' };
      if (blob.size <= PHOTO_MAX_BYTES) return { ok: true, blob };
    }
    return { ok: false, reason: 'too-large' };
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    bmp.close?.();
  }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      if (typeof indexedDB === 'undefined') return res(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
      req.onblocked = () => res(null);
    } catch {
      res(null);
    }
  });
}

/** One IndexedDB request on the photo store; resolves `undefined` on any failure. */
async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<{ value: T } | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((res) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      let value: T;
      req.onsuccess = () => { value = req.result; };
      tx.oncomplete = () => { db.close(); res({ value }); };
      tx.onerror = tx.onabort = () => { db.close(); res(null); };
    } catch {
      try { db.close(); } catch { /* already closed */ }
      res(null);
    }
  });
}

const blobToDataUrl = (b: Blob) => new Promise<string | null>((res) => {
  const r = new FileReader();
  r.onload = () => res(typeof r.result === 'string' ? r.result : null);
  r.onerror = () => res(null);
  r.readAsDataURL(b);
});

function dataUrlToBlob(url: string): Blob | null {
  try {
    const m = /^data:([^;,]+);base64,(.*)$/.exec(url);
    if (!m) return null;
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  } catch {
    return null;
  }
}

/** Resize and persist. Replaces any earlier photo. */
export async function storeStandbyPhoto(file: Blob): Promise<StoreResult> {
  const r = await resizePhoto(file);
  if (!r.ok) return r;
  const saved = await idb('readwrite', (s) => s.put(r.blob, IDB_KEY));
  if (saved) { try { localStorage.removeItem(LS_KEY); } catch { /* best effort */ } return { ok: true }; }
  // IndexedDB unavailable: small localStorage fallback.
  if (r.blob.size > PHOTO_FALLBACK_MAX_BYTES) return { ok: false, reason: 'storage' };
  const url = await blobToDataUrl(r.blob);
  if (!url) return { ok: false, reason: 'storage' };
  try { localStorage.setItem(LS_KEY, url); return { ok: true }; } catch { return { ok: false, reason: 'storage' }; }
}

/** The stored photo, or null when there is none or it cannot be read. */
export async function loadStandbyPhoto(): Promise<Blob | null> {
  const got = await idb<unknown>('readonly', (s) => s.get(IDB_KEY));
  if (got && got.value instanceof Blob && got.value.size > 0) return got.value;
  try {
    const url = localStorage.getItem(LS_KEY);
    return url ? dataUrlToBlob(url) : null;
  } catch {
    return null;
  }
}

export async function removeStandbyPhoto(): Promise<void> {
  await idb('readwrite', (s) => s.delete(IDB_KEY));
  try { localStorage.removeItem(LS_KEY); } catch { /* best effort */ }
}
