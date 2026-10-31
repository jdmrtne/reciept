import type { EventLayoutDef } from './eventLayouts';
import type { FrameDef } from '../types';
import type { CustomArtMeta, CustomQrArea, CustomLayoutArt } from './types';
import * as store from './store';
import type { StoreResult } from './store';
import { artReady, createArtUrl, revokeArtUrl } from './artUrls';

/**
 * Runtime registry of EVENT LAYOUTS (EL-2): loaded from IndexedDB at app start (kiosk.tsx), kept in memory, read SYNCHRONOUSLY.
 * Each layout has ONE object URL (its picture). The URL is revoked when the picture is replaced and when the layout is deleted;
 * it is kept while the stored file is unchanged (same `rev`), so a rename or a QR change never invalidates an image already decoded.
 * Changes go to the store first and to memory only after the store accepted them, so memory never shows something that was not saved.
 * Imports only types, eventLayouts.ts, artUrls.ts and the store, never frames/registry.ts, validate.ts or config/settings.ts (no import cycle).
 * If IndexedDB is unavailable the registry stays empty and the app is unaffected. getLayout / allLayouts (layouts/registry.ts) and the frame lock (frames/registry.ts) read it (EL-3).
 */
export type EventLayoutStatus = 'idle' | 'loading' | 'ready' | 'unavailable';
interface Entry { def: EventLayoutDef; url: string | null; frame: FrameDef }

/**
 * The frame lock of an event layout: a synthetic image frame whose id IS the layout id and which is offered ONLY on that layout
 * (FrameDef.onlyLayouts), so no standard frame fits an event layout and event art fits no standard layout (frames/registry.ts: lockOf, isFrameAllowed).
 * A QR spot the owner set becomes a normal `qr.byLayout` entry, so qrAreaFor and the placement rules work unchanged. No bands, no text, no border: the art is the whole design.
 */
export function toEventFrameDef(def: EventLayoutDef): FrameDef {
  return { id: def.id, name: def.name, type: 'image', onlyLayouts: [def.id], image: { dir: def.id, padding: 0 }, headerHeight: 0, footerHeight: 0, border: { style: 'none', width: 0, inset: 0 }, header: { lines: [] }, footer: { lines: [] },
    ...(def.art.qr ? { qr: { byLayout: { [def.id]: { safeArea: { ...def.art.qr } } } } } : {}) };
}

const entries = new Map<string, Entry>();
let status: EventLayoutStatus = 'idle', version = 0, initP: Promise<void> | null = null;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((l) => { try { l(); } catch { /* a bad listener must not break the registry */ } }); };

function install(def: EventLayoutDef): void {
  const old = entries.get(def.id);
  // keep the object URL while the stored file is unchanged (same rev)
  if (old?.url && old.def.art.rev && old.def.art.rev === def.art.rev) { entries.set(def.id, { def, url: old.url, frame: toEventFrameDef(def) }); return; }
  const url = createArtUrl(def.art.blob);
  revokeArtUrl(old?.url);
  entries.set(def.id, { def, url, frame: toEventFrameDef(def) });
}
const drop = (id: string) => { const e = entries.get(id); if (!e) return; revokeArtUrl(e.url); entries.delete(id); };

/** Load every stored event layout. Safe to call more than once (one load); never rejects. */
export function initEventLayouts(): Promise<void> {
  if (initP) return initP;
  status = 'loading';
  initP = (async () => {
    const r = await store.listEventLayouts();
    if (!r.ok) status = r.reason === 'unavailable' ? 'unavailable' : 'ready'; // a read error leaves the feature empty, not broken
    else { for (const id of [...entries.keys()]) drop(id); r.value.forEach(install); status = 'ready'; }
    bump();
  })().catch(() => { status = 'unavailable'; bump(); });
  return initP;
}

export const getEventLayoutStatus = (): EventLayoutStatus => status;
/** Changes on every load and every change: the snapshot for useSyncExternalStore. */
export const eventLayoutVersion = (): number => version;
export function subscribeEventLayouts(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

// ---- synchronous lookups ----
const byCreation = (a: EventLayoutDef, b: EventLayoutDef) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Every stored event layout in creation order (the pure helpers in eventLayouts.ts take these). */
export const eventLayoutRecords = (): EventLayoutDef[] => [...entries.values()].map((e) => e.def).sort(byCreation);
export const eventLayoutById = (id: string | null | undefined): EventLayoutDef | undefined => (id ? entries.get(id)?.def : undefined);
/** SHOWN unless the owner switched it off. Unknown ids count as shown: they are never offered anyway. */
export const eventLayoutEnabled = (id: string): boolean => entries.get(id)?.def.enabled !== false;
/**
 * What a guest is offered while `activeEventId` is the active event: the layout must be SHOWN *and* belong to that event.
 * So making another event active swaps the EVENT SPECIAL layouts instead of piling them up. Layouts of no event (deleted event) are never offered.
 */
export const eventLayoutOfferedFor = (activeEventId: string) => (id: string): boolean => {
  const d = entries.get(id)?.def;
  return !!d && d.enabled !== false && !!activeEventId && d.eventId === activeEventId;
};
export interface EventLayoutAsset { src: string; meta: CustomArtMeta }
/** The picture's object URL plus its metadata (no blob). null when the layout is unknown or the browser could not make a URL. */
export function eventLayoutAsset(id: string): EventLayoutAsset | null {
  const e = entries.get(id);
  if (!e || !e.url) return null;
  const { blob: _blob, ...meta } = e.def.art;
  return { src: e.url, meta };
}
/** The frame lock of this event layout (see toEventFrameDef), or undefined when the id is not a stored event layout. */
export const eventFrameById = (id: string | null | undefined): FrameDef | undefined => (id ? entries.get(id)?.frame : undefined);
/** Every event layout's frame lock, in creation order. */
export const eventFrameDefs = (): FrameDef[] => eventLayoutRecords().flatMap((d) => { const f = entries.get(d.id)?.frame; return f ? [f] : []; });
/** Resolves when the picture of this layout (or of every layout) is decoded. Resolves at once for unknown ids. */
export function eventLayoutReady(id?: string | null): Promise<void> {
  const list = id ? [entries.get(id)] : [...entries.values()];
  return artReady(list.map((e) => e?.url));
}

// ---- changes: store first, then memory ----
function apply(r: StoreResult<EventLayoutDef>): StoreResult<EventLayoutDef> {
  if (r.ok) { install(r.value); bump(); }
  return r;
}
export const createEventLayoutRecord = async (input: Parameters<typeof store.createEventLayout>[0]) => apply(await store.createEventLayout(input));
export const renameEventLayoutRecord = async (id: string, name: string) => apply(await store.renameEventLayout(id, name));
export const setEventLayoutRecordArt = async (id: string, art: CustomLayoutArt) => apply(await store.setEventLayoutArt(id, art));
export const setEventLayoutRecordQr = async (id: string, qr: CustomQrArea | null) => apply(await store.setEventLayoutQr(id, qr));
export const setEventLayoutRecordEnabled = async (id: string, enabled: boolean) => apply(await store.setEventLayoutEnabled(id, enabled));
export const setEventLayoutRecordEvent = async (id: string, eventId: string) => apply(await store.setEventLayoutEvent(id, eventId));
export async function deleteEventLayoutRecord(id: string): Promise<StoreResult<true>> {
  const r = await store.deleteEventLayout(id);
  if (r.ok) { drop(id); bump(); }
  return r;
}

/** Tests only: forget everything (does not touch the database). */
export function resetEventRuntime(): void { for (const id of [...entries.keys()]) drop(id); status = 'idle'; initP = null; version = 0; listeners.clear(); }
