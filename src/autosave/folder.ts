/**
 * Auto-save folder access (Chrome File System Access API, works in an installed PWA). The administrator picks a base folder with a click;
 * the handle is kept in IndexedDB so it survives refresh/restart. Permission is checked before each save and never prompted per shot:
 * a save that lacks permission simply reports 'permission' (ADMIN shows RE-GRANT). Nothing here ever throws to a caller.
 */
type Perm = 'granted' | 'denied' | 'prompt';
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(d: { mode: 'readwrite' }): Promise<Perm>;
  requestPermission(d: { mode: 'readwrite' }): Promise<Perm>;
}
export type FolderStatus =
  | { s: 'unsupported' }              // browser has no showDirectoryPicker (or not a secure context)
  | { s: 'none' }                     // supported, no folder chosen yet
  | { s: 'ready'; name: string }      // chosen and writable
  | { s: 'permission'; name: string } // chosen, Chrome needs the admin to re-grant access
  | { s: 'error'; name: string; message: string };

export const SUBFOLDERS = { image: 'Images', gif: 'GIFs', video: 'Videos' } as const;
export type OutputKind = keyof typeof SUBFOLDERS;
const EXT = { image: 'jpg', gif: 'gif', video: 'mp4' } as const;
const DB = 'memorys-autosave', STORE = 'handles', KEY = 'base';

export const folderSupported = () => typeof window !== 'undefined' && window.isSecureContext !== false && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

const openDb = () => new Promise<IDBDatabase | null>((res) => {
  try {
    if (typeof indexedDB === 'undefined') return res(null);
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  } catch { res(null); }
});
const idb = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T | null> => {
  const db = await openDb(); if (!db) return null;
  return new Promise<T | null>((res) => {
    try { const q = f(db.transaction(STORE, mode).objectStore(STORE)); q.onsuccess = () => { res((q.result as T) ?? null); db.close(); }; q.onerror = () => { res(null); db.close(); }; } catch { res(null); db.close(); }
  });
};

let cached: DirHandle | null = null;
const loadHandle = async (): Promise<DirHandle | null> => cached ?? (cached = await idb<DirHandle>('readonly', (s) => s.get(KEY)));

/** Is the stored handle writable now? `ask` = try to renew (only succeeds inside a user click; elsewhere Chrome refuses and we report 'prompt'). */
async function permission(h: DirHandle, ask: boolean): Promise<Perm> {
  try {
    const q = await h.queryPermission({ mode: 'readwrite' });
    if (q === 'granted' || !ask) return q;
    return await h.requestPermission({ mode: 'readwrite' });
  } catch { return 'prompt'; }
}

export async function folderStatus(ask = false): Promise<FolderStatus> {
  if (!folderSupported()) return { s: 'unsupported' };
  const h = await loadHandle(); if (!h) return { s: 'none' };
  const p = await permission(h, ask);
  return p === 'granted' ? { s: 'ready', name: h.name } : { s: 'permission', name: h.name };
}

/** Admin click: choose the base folder, create MEMORYS/Images, MEMORYS/GIFs and MEMORYS/Videos inside it, remember it. */
export async function chooseFolder(): Promise<FolderStatus> {
  if (!folderSupported()) return { s: 'unsupported' };
  try {
    const picked = await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ id: 'memorys-autosave', mode: 'readwrite' });
    if ((await permission(picked, true)) !== 'granted') return { s: 'permission', name: picked.name };
    const root = await picked.getDirectoryHandle('MEMORYS', { create: true });
    await root.getDirectoryHandle(SUBFOLDERS.image, { create: true });
    await root.getDirectoryHandle(SUBFOLDERS.gif, { create: true });
    await root.getDirectoryHandle(SUBFOLDERS.video, { create: true });
    cached = picked;
    const stored = await idb('readwrite', (s) => s.put(picked, KEY));
    return stored === null && !(await loadHandle()) ? { s: 'error', name: picked.name, message: 'FOLDER CHOSEN BUT COULD NOT BE REMEMBERED (BROWSER STORAGE UNAVAILABLE)' } : { s: 'ready', name: picked.name };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return folderStatus();
    return { s: 'error', name: (await loadHandle())?.name ?? '', message: (e as Error)?.message || 'COULD NOT USE THAT FOLDER' };
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Name stem (no extension): local timestamp + random suffix. One customer's photo, GIF and video share one stem. */
export const makeStem = (d = new Date(), rnd = Math.random) =>
  `MEMORYS-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.floor(rnd() * 46656).toString(36).padStart(3, '0')}`;
/** Unique name: `stem` (optional, shared per session) or a fresh timestamp + random suffix, plus the kind's extension. */
export const uniqueName = (kind: OutputKind, d = new Date(), rnd = Math.random, stem?: string) => `${stem ?? makeStem(d, rnd)}.${EXT[kind]}`;

/** Writes bytes into MEMORYS/<Images|GIFs|Videos>/. Tries the shared `stem` first; a name clash never overwrites, it retries with a new suffix (the stem actually used is returned). */
export async function writeOutput(kind: OutputKind, bytes: Uint8Array, stem?: string): Promise<{ ok: true; name: string; stem: string } | { ok: false; reason: 'unsupported' | 'none' | 'permission' | 'empty' | 'error' }> {
  if (!bytes || bytes.length === 0) return { ok: false, reason: 'empty' };
  if (!folderSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const h = await loadHandle(); if (!h) return { ok: false, reason: 'none' };
    if ((await permission(h, true)) !== 'granted') return { ok: false, reason: 'permission' };
    const dir = await (await h.getDirectoryHandle('MEMORYS', { create: true })).getDirectoryHandle(SUBFOLDERS[kind], { create: true });
    for (let i = 0; i < 5; i++) {
      const name = uniqueName(kind, undefined, undefined, i === 0 ? stem : undefined);
      try { await dir.getFileHandle(name); continue; } catch { /* not found: free to use */ }
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      try { await w.write(bytes as BufferSource); await w.close(); } catch (e) { try { await w.abort(); } catch { /* ignore */ } throw e; }
      return { ok: true, name, stem: name.slice(0, name.lastIndexOf('.')) };
    }
    return { ok: false, reason: 'error' };
  } catch { return { ok: false, reason: 'error' }; }
}
