import { CUSTOM_FRAME_PREFIX, type CustomFrameDef, type CustomLayoutArt, type CustomLayoutId, type CustomQrArea } from './types';
import { EVENT_LAYOUT_PREFIX, isEventLayoutId, type EventLayoutDef } from './eventLayouts';

/**
 * IndexedDB store for custom frames (own tiny wrapper, no library). One object store, keyPath `id`, one record per frame:
 * the whole CustomFrameDef, so a frame and its PNG blobs are always written and removed together in ONE transaction.
 * Every function reports failure as a value with a readable message and never throws, so a blocked or missing IndexedDB
 * only disables the feature; the rest of the app is unaffected (same rule as lib/standbyPhoto.ts).
 */
export type StoreFailure = 'unavailable' | 'quota' | 'missing' | 'invalid' | 'storage';
export type StoreResult<T> = { ok: true; value: T } | { ok: false; reason: StoreFailure; message: string };

export const MESSAGES: Record<StoreFailure, string> = {
  unavailable: 'Custom frames are not available in this browser. Built-in frames still work.',
  quota: 'The device is out of storage space. Remove a custom frame or free some space, then try again.',
  missing: 'That frame no longer exists.',
  invalid: 'That frame could not be read from storage.',
  storage: 'The frame could not be saved. Please try again.'
};
const bad = (reason: StoreFailure, message = MESSAGES[reason]): { ok: false; reason: StoreFailure; message: string } => ({ ok: false, reason, message });
const ok = <T,>(value: T): StoreResult<T> => ({ ok: true, value });

export const NAME_MAX = 40;
export const DB_NAME = 'booth.customFrames';
/** Version 2 (EL-2) adds the `eventLayouts` object store. Version 1 databases are upgraded in place: the `frames` store is never touched. */
export const DB_VERSION = 2;
export const FRAMES_STORE = 'frames';
export const EVENT_STORE = 'eventLayouts';

const isQuota = (e: unknown) => {
  const n = (e as { name?: string } | null)?.name ?? '';
  return n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED';
};
class Fail extends Error { constructor(public reason: StoreFailure) { super(reason); } }
const toFail = (e: unknown): Fail => (e instanceof Fail ? e : new Fail(isQuota(e) ? 'quota' : 'storage'));

let dbp: Promise<IDBDatabase | null> | null = null;
/** Opens (once) and caches the connection. A failed open is NOT cached, so a later call can try again. */
function openDb(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  const p = new Promise<IDBDatabase | null>((res) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return res(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => { for (const n of [FRAMES_STORE, EVENT_STORE]) if (!req.result.objectStoreNames.contains(n)) req.result.createObjectStore(n, { keyPath: 'id' }); };
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => { db.close(); if (dbp === p) dbp = null; }; res(db); };
      req.onerror = () => res(null);
      req.onblocked = () => res(null);
    } catch { res(null); }
  });
  dbp = p;
  void p.then((db) => { if (!db && dbp === p) dbp = null; });
  return p;
}
/** Forget the cached connection (tests, or after the page is told the database changed). */
export function resetStore(): void { void dbp?.then((d) => d?.close()); dbp = null; }

/**
 * Run `work` inside one transaction. `work` calls `done(value)` from a request callback; the promise settles when the transaction has
 * COMMITTED (complete) so a resolved write is really on disk, and rejects on an error or abort (quota shows up as an abort).
 */
async function runIn<T>(storeName: string, msgs: Record<StoreFailure, string>, mode: IDBTransactionMode, work: (s: IDBObjectStore, done: (v: T) => void, fail: (r: StoreFailure) => void) => void): Promise<StoreResult<T>> {
  const db = await openDb();
  if (!db) return bad('unavailable', msgs.unavailable);
  return new Promise<StoreResult<T>>((res) => {
    let value: T | undefined, failure: StoreFailure | null = null, settled = false;
    const finish = (r: StoreResult<T>) => { if (!settled) { settled = true; res(r); } };
    try {
      const tx = db.transaction(storeName, mode);
      tx.oncomplete = () => finish(failure ? bad(failure, msgs[failure]) : ok(value as T));
      tx.onabort = () => { const f = failure ?? toFail(tx.error).reason; finish(bad(f, msgs[f])); };
      tx.onerror = () => { failure = failure ?? toFail(tx.error).reason; };
      work(tx.objectStore(storeName), (v) => { value = v; }, (r) => { failure = r; try { tx.abort(); } catch { /* already finished */ } });
    } catch (e) { const f = toFail(e).reason; finish(bad(f, msgs[f])); }
  });
}
const run = <T,>(mode: IDBTransactionMode, work: (s: IDBObjectStore, done: (v: T) => void, fail: (r: StoreFailure) => void) => void) => runIn(FRAMES_STORE, MESSAGES, mode, work);
const onErr = (req: IDBRequest, fail: (r: StoreFailure) => void) => { req.onerror = () => fail(isQuota(req.error) ? 'quota' : 'storage'); };

/** A record read back from disk is never trusted: wrong shape means it is skipped, not crashed on. */
export function isFrameRecord(v: unknown): v is CustomFrameDef {
  const f = v as CustomFrameDef | null;
  return !!f && typeof f === 'object' && typeof f.id === 'string' && f.id.startsWith(CUSTOM_FRAME_PREFIX) && typeof f.name === 'string' && !!f.layouts && typeof f.layouts === 'object';
}

export function cleanName(raw: string): string | null {
  const n = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return n || null;
}
const newRev = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export function newFrameId(): string {
  const r = (globalThis.crypto as Crypto | undefined)?.randomUUID?.().replace(/-/g, '').slice(0, 12) ?? Math.random().toString(36).slice(2, 14).padEnd(12, '0');
  return `${CUSTOM_FRAME_PREFIX}${r}`;
}

/** Ask the browser not to evict our data under storage pressure. null = the browser has no such API. Never throws. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    const s = (globalThis.navigator as Navigator | undefined)?.storage;
    if (!s?.persist) return null;
    if (s.persisted && (await s.persisted())) return true;
    return await s.persist();
  } catch { return null; }
}

export async function listFrames(): Promise<StoreResult<CustomFrameDef[]>> {
  const r = await run<unknown[]>('readonly', (s, done, fail) => { const q = s.getAll(); onErr(q, fail); q.onsuccess = () => done(q.result as unknown[]); });
  if (!r.ok) return r;
  return ok(r.value.filter(isFrameRecord).sort((a, b) => a.createdAt - b.createdAt));
}

export async function getFrameRecord(id: string): Promise<StoreResult<CustomFrameDef>> {
  const r = await run<unknown>('readonly', (s, done, fail) => { const q = s.get(id); onErr(q, fail); q.onsuccess = () => done(q.result); });
  if (!r.ok) return r;
  if (r.value === undefined) return bad('missing');
  return isFrameRecord(r.value) ? ok(r.value) : bad('invalid');
}

export async function createFrame(name: string, now: number = Date.now(), special = false, eventId?: string): Promise<StoreResult<CustomFrameDef>> {
  const clean = cleanName(name);
  if (!clean) return bad('invalid', 'Give the frame a name.');
  const def: CustomFrameDef = { id: newFrameId(), name: clean, createdAt: now, updatedAt: now, layouts: {}, ...(special ? { special: true } : {}), ...(special && eventId ? { eventId } : {}) };
  const r = await run<CustomFrameDef>('readwrite', (s, done, fail) => { const q = s.add(def); onErr(q, fail); q.onsuccess = () => done(def); });
  return r;
}

/** Read, change and write one frame inside a single transaction, so two quick edits cannot overwrite each other. */
export async function updateFrame(id: string, mutate: (f: CustomFrameDef) => CustomFrameDef, now: number = Date.now()): Promise<StoreResult<CustomFrameDef>> {
  return run<CustomFrameDef>('readwrite', (s, done, fail) => {
    const g = s.get(id); onErr(g, fail);
    g.onsuccess = () => {
      if (g.result === undefined) return fail('missing');
      if (!isFrameRecord(g.result)) return fail('invalid');
      const next = mutate(g.result);
      const out: CustomFrameDef = { ...next, id: g.result.id, createdAt: g.result.createdAt, updatedAt: now };
      const p = s.put(out); onErr(p, fail); p.onsuccess = () => done(out);
    };
  });
}

export const renameFrame = (id: string, name: string): Promise<StoreResult<CustomFrameDef>> => {
  const clean = cleanName(name);
  return clean ? updateFrame(id, (f) => ({ ...f, name: clean })) : Promise.resolve(bad('invalid', 'Give the frame a name.'));
};
/** The owner's ON/OFF switch for guests. The pictures are untouched. */
export const setEnabled = (id: string, enabled: boolean): Promise<StoreResult<CustomFrameDef>> => updateFrame(id, (f) => ({ ...f, enabled }));
/** Move a frame into an event group (or out of any group with null). The pictures are untouched. */
export const setEventId = (id: string, eventId: string | null): Promise<StoreResult<CustomFrameDef>> =>
  updateFrame(id, (f) => { const { eventId: _old, ...rest } = f; return eventId ? { ...rest, eventId } : rest; });
export const setLayoutArt = (id: string, layoutId: CustomLayoutId, art: CustomLayoutArt): Promise<StoreResult<CustomFrameDef>> =>
  updateFrame(id, (f) => ({ ...f, layouts: { ...f.layouts, [layoutId]: { ...art, rev: newRev() } } }));
/** Phase 5: set or clear (null) the QR spot of ONE layout. The picture, its `rev` and its blob stay exactly as stored, so nothing is re-decoded. A layout without art is `missing`. */
export const setLayoutQr = (id: string, layoutId: CustomLayoutId, qr: CustomQrArea | null): Promise<StoreResult<CustomFrameDef>> =>
  updateFrame(id, (f) => {
    const art = f.layouts[layoutId];
    if (!art) return f;
    const { qr: _old, ...rest } = art;
    return { ...f, layouts: { ...f.layouts, [layoutId]: qr ? { ...rest, qr: { x: qr.x, y: qr.y, w: qr.w, h: qr.h } } : rest } };
  });
export const removeLayoutArt = (id: string, layoutId: CustomLayoutId): Promise<StoreResult<CustomFrameDef>> =>
  updateFrame(id, (f) => { const { [layoutId]: _gone, ...rest } = f.layouts; return { ...f, layouts: rest }; });

export async function deleteFrame(id: string): Promise<StoreResult<true>> {
  return run<true>('readwrite', (s, done, fail) => { const q = s.delete(id); onErr(q, fail); q.onsuccess = () => done(true); });
}

// ---- Event layouts (EL-2): their own object store `eventLayouts` in the SAME database. ----
// Additive: version 2 only creates the new store. The `frames` store and its records are never touched, so no frame is lost on upgrade.

export const EVENT_LAYOUT_MESSAGES: Record<StoreFailure, string> = {
  unavailable: 'Event layouts are not available in this browser. The standard layouts still work.',
  quota: 'The device is out of storage space. Remove an event layout or free some space, then try again.',
  missing: 'That event layout no longer exists.',
  invalid: 'That event layout could not be read from storage.',
  storage: 'The event layout could not be saved. Please try again.'
};
const badLayout = (reason: StoreFailure, message = EVENT_LAYOUT_MESSAGES[reason]): { ok: false; reason: StoreFailure; message: string } => ({ ok: false, reason, message });
const runLayouts = <T,>(mode: IDBTransactionMode, work: (s: IDBObjectStore, done: (v: T) => void, fail: (r: StoreFailure) => void) => void) => runIn(EVENT_STORE, EVENT_LAYOUT_MESSAGES, mode, work);

export function newEventLayoutId(): string {
  const r = (globalThis.crypto as Crypto | undefined)?.randomUUID?.().replace(/-/g, '').slice(0, 12) ?? Math.random().toString(36).slice(2, 14).padEnd(12, '0');
  return `${EVENT_LAYOUT_PREFIX}${r}`;
}

/** A record read back from disk is never trusted: it needs an `evl-` id, a name, an event id (may be empty), and a picture with at least one window. Anything else is skipped, not crashed on. */
export function isEventLayoutRecord(v: unknown): v is EventLayoutDef {
  const d = v as EventLayoutDef | null;
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !isEventLayoutId(d.id) || typeof d.name !== 'string' || typeof d.eventId !== 'string') return false;
  const a = d.art as CustomLayoutArt | undefined;
  return !!a && typeof a === 'object' && !!a.blob && typeof a.blob === 'object' && Array.isArray(a.slots) && a.slots.length > 0 && typeof a.heightRatio === 'number' && Number.isFinite(a.heightRatio) && a.heightRatio > 0;
}

export async function listEventLayouts(): Promise<StoreResult<EventLayoutDef[]>> {
  const r = await runLayouts<unknown[]>('readonly', (s, done, fail) => { const q = s.getAll(); onErr(q, fail); q.onsuccess = () => done(q.result as unknown[]); });
  if (!r.ok) return r;
  return ok(r.value.filter(isEventLayoutRecord).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

export async function getEventLayoutRecord(id: string): Promise<StoreResult<EventLayoutDef>> {
  const r = await runLayouts<unknown>('readonly', (s, done, fail) => { const q = s.get(id); onErr(q, fail); q.onsuccess = () => done(q.result); });
  if (!r.ok) return r;
  if (r.value === undefined) return badLayout('missing');
  return isEventLayoutRecord(r.value) ? ok(r.value) : badLayout('invalid');
}

/** The layout and its picture are ONE record, written in ONE transaction: a layout without a picture cannot exist. */
export async function createEventLayout(input: { name: string; eventId: string; art: CustomLayoutArt; /** EL-6 copy: start hidden and remember the source picture */ enabled?: boolean; convertedFrom?: string }, now: number = Date.now()): Promise<StoreResult<EventLayoutDef>> {
  const clean = cleanName(input.name);
  if (!clean) return badLayout('invalid', 'Give the layout a name.');
  if (!input.eventId) return badLayout('invalid', 'Pick an event first.');
  const def: EventLayoutDef = { id: newEventLayoutId(), name: clean, eventId: input.eventId, createdAt: now, updatedAt: now, ...(input.enabled === false ? { enabled: false } : {}), ...(input.convertedFrom ? { convertedFrom: input.convertedFrom } : {}), art: { ...input.art, rev: newRev() } };
  if (!isEventLayoutRecord(def)) return badLayout('invalid', 'This picture has no photo windows, so it cannot become a layout.');
  return runLayouts<EventLayoutDef>('readwrite', (s, done, fail) => { const q = s.add(def); onErr(q, fail); q.onsuccess = () => done(def); });
}

/** Read, change and write one event layout inside a single read-write transaction, so two quick edits cannot overwrite each other. id and createdAt cannot be changed. */
export async function updateEventLayout(id: string, mutate: (d: EventLayoutDef) => EventLayoutDef, now: number = Date.now()): Promise<StoreResult<EventLayoutDef>> {
  return runLayouts<EventLayoutDef>('readwrite', (s, done, fail) => {
    const g = s.get(id); onErr(g, fail);
    g.onsuccess = () => {
      if (g.result === undefined) return fail('missing');
      if (!isEventLayoutRecord(g.result)) return fail('invalid');
      let out: EventLayoutDef;
      try { out = { ...mutate(g.result), id: g.result.id, createdAt: g.result.createdAt, updatedAt: now }; } catch { return fail('storage'); }
      if (!isEventLayoutRecord(out)) return fail('invalid');
      const p = s.put(out); onErr(p, fail); p.onsuccess = () => done(out);
    };
  });
}

export const renameEventLayout = (id: string, name: string): Promise<StoreResult<EventLayoutDef>> => {
  const clean = cleanName(name);
  return clean ? updateEventLayout(id, (d) => ({ ...d, name: clean })) : Promise.resolve(badLayout('invalid', 'Give the layout a name.'));
};
/** Replace the picture (and with it the windows). The old QR spot is dropped because it was placed for the old picture. The new file gets a new `rev`. */
export const setEventLayoutArt = (id: string, art: CustomLayoutArt): Promise<StoreResult<EventLayoutDef>> =>
  updateEventLayout(id, (d) => { const { qr: _qr, ...rest } = art; return { ...d, art: { ...rest, rev: newRev() } }; });
/** Set or clear (null) the QR spot. The picture, its `rev` and its blob stay exactly as stored. */
export const setEventLayoutQr = (id: string, qr: CustomQrArea | null): Promise<StoreResult<EventLayoutDef>> =>
  updateEventLayout(id, (d) => { const { qr: _old, ...rest } = d.art; return { ...d, art: qr ? { ...rest, qr: { x: qr.x, y: qr.y, w: qr.w, h: qr.h } } : rest }; });
/** The owner's SHOWN/HIDDEN switch for guests. The picture is untouched. */
export const setEventLayoutEnabled = (id: string, enabled: boolean): Promise<StoreResult<EventLayoutDef>> => updateEventLayout(id, (d) => ({ ...d, enabled }));
/** Move a layout to another event (an empty id means no event: it shows as unassigned). The picture is untouched. */
export const setEventLayoutEvent = (id: string, eventId: string): Promise<StoreResult<EventLayoutDef>> => updateEventLayout(id, (d) => ({ ...d, eventId: eventId ?? '' }));

export async function deleteEventLayout(id: string): Promise<StoreResult<true>> {
  return runLayouts<true>('readwrite', (s, done, fail) => { const q = s.delete(id); onErr(q, fail); q.onsuccess = () => done(true); });
}
