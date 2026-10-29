import type { FrameDef } from '../types';
import { CUSTOM_FRAME_PREFIX, type CustomArtMeta, type CustomFrameDef, type CustomLayoutArt, type CustomLayoutId, type CustomQrArea } from './types';
import * as store from './store';
import type { StoreResult } from './store';

/**
 * Runtime registry of custom frames: loaded from IndexedDB at app start, kept in memory, read SYNCHRONOUSLY by frames/registry.ts
 * (getFrame, framesForLayout, isFrameAllowed) and, in Phase 3, by frames/assets.ts. Each stored PNG gets one object URL; it is revoked
 * when its layout art is replaced or removed and when the frame is deleted. This module imports only types and the store, never
 * frames/registry.ts, so there is no import cycle. If IndexedDB is unavailable the registry stays empty and the app is unaffected.
 */
export type CustomStatus = 'idle' | 'loading' | 'ready' | 'unavailable';
interface Entry { def: CustomFrameDef; frame: FrameDef; urls: Partial<Record<CustomLayoutId, string>> }

const entries = new Map<string, Entry>();
let status: CustomStatus = 'idle', persisted: boolean | null = null, version = 0, initP: Promise<void> | null = null;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((l) => { try { l(); } catch { /* a bad listener must not break the registry */ } }); };

export const isCustomFrameId = (id: string | null | undefined): boolean => !!id && id.startsWith(CUSTOM_FRAME_PREFIX);

/** A custom frame looks like any built-in image frame to the rest of the app: type 'image', no bands, no text, no frame-lock. */
export function toFrameDef(d: CustomFrameDef): FrameDef {
  // Per-layout QR safe areas the owner set (Phase 5) become a normal `qr.byLayout`; layouts without one keep the strip-below fallback.
  const byLayout: Record<string, { safeArea: { x: number; y: number; w: number; h: number } }> = {};
  for (const [k, art] of Object.entries(d.layouts)) if (art?.qr) byLayout[k] = { safeArea: { ...art.qr } };
  return { id: d.id, name: d.name, type: 'image', image: { dir: d.id, padding: 0 }, headerHeight: 0, footerHeight: 0, border: { style: 'none', width: 0, inset: 0 }, header: { lines: [] }, footer: { lines: [] }, ...(Object.keys(byLayout).length ? { qr: { byLayout } } : {}) };
}

/** Decodes of every artwork URL, so the editor, preview and print find the image ready (no flash). Best effort; never rejects. */
const warm = new Map<string, Promise<void>>();
function warmUp(url: string): void {
  if (warm.has(url) || typeof Image === 'undefined') return;
  warm.set(url, new Promise<void>((res) => { try { const im = new Image(); im.src = url; (im.decode ? im.decode() : Promise.resolve()).then(() => res(), () => res()); } catch { res(); } }));
}
/** Resolves when the artwork for this frame (all layouts, or one) is decoded. Resolves at once for built-in frames and unknown ids. */
export function customReady(frameId?: string | null, layoutId?: string): Promise<void> {
  const e = frameId ? entries.get(frameId) : undefined;
  const urls = e ? (Object.entries(e.urls) as [string, string][]).filter(([k]) => !layoutId || k === layoutId).map(([, u]) => u) : [];
  return Promise.all(urls.map((u) => warm.get(u) ?? Promise.resolve())).then(() => undefined);
}

const revoke = (e: Entry | undefined, only?: CustomLayoutId) => {
  if (!e) return;
  for (const k of Object.keys(e.urls) as CustomLayoutId[]) if (!only || only === k) { try { warm.delete(e.urls[k]!); URL.revokeObjectURL(e.urls[k]!); } catch { /* ignore */ } delete e.urls[k]; }
};
function install(def: CustomFrameDef): void {
  const old = entries.get(def.id), urls: Entry['urls'] = {};
  for (const [k, art] of Object.entries(def.layouts) as [CustomLayoutId, CustomLayoutArt][]) {
    // keep the object URL while the stored file is unchanged (same rev) (a rename must not invalidate images already decoded from it)
    const prev = old?.def.layouts[k];
    if (prev?.rev && prev.rev === art.rev && old!.urls[k]) { urls[k] = old!.urls[k]; delete old!.urls[k]; continue; }
    try { urls[k] = URL.createObjectURL(art.blob); warmUp(urls[k]!); } catch { /* an unreadable blob just means no art for that layout */ }
  }
  revoke(old);
  entries.set(def.id, { def, frame: toFrameDef(def), urls });
}

/** Load every stored frame. Safe to call more than once (one load); never rejects. */
export function initCustomFrames(): Promise<void> {
  if (initP) return initP;
  status = 'loading';
  initP = (async () => {
    const r = await store.listFrames();
    if (!r.ok) status = r.reason === 'unavailable' ? 'unavailable' : 'ready'; // a read error leaves the feature empty, not broken
    else { for (const e of entries.values()) revoke(e); entries.clear(); r.value.forEach(install); status = 'ready'; }
    if (status === 'ready') void store.requestPersistence().then((p) => { persisted = p; bump(); });
    bump();
  })().catch(() => { status = 'unavailable'; bump(); });
  return initP;
}

export const getCustomStatus = (): CustomStatus => status;
export const isPersistent = (): boolean | null => persisted;
export const customVersion = (): number => version;
export function subscribeCustom(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

// ---- synchronous lookups (used by frames/registry.ts and, in Phase 3, frames/assets.ts) ----
export const customFrameDefs = (): FrameDef[] => [...entries.values()].map((e) => e.frame);
export const customFrameById = (id: string | null | undefined): FrameDef | undefined => (id ? entries.get(id)?.frame : undefined);
/** ON unless the owner switched it off (absent flag = on). Unknown ids count as on: they are never offered anyway. */
/** An event special frame (ADMIN > Events) as opposed to a normal own frame (ADMIN > Frames). */
export const customIsSpecial = (id: string): boolean => entries.get(id)?.def.special === true;
export const customEnabled = (id: string): boolean => entries.get(id)?.def.enabled !== false;
/** Every stored frame record in creation order (the pure helpers in groups.ts take these). */
export const customRecords = (): CustomFrameDef[] => [...entries.values()].map((e) => e.def).sort((a, b) => a.createdAt - b.createdAt);
export const customRecord = (id: string): CustomFrameDef | undefined => entries.get(id)?.def;
export const customLayouts = (id: string): CustomLayoutId[] => { const e = entries.get(id); return e ? (Object.keys(e.urls) as CustomLayoutId[]) : []; };
/** A layout is offered only when the frame has art for it AND its object URL exists. */
export const customHasLayout = (id: string, layoutId: string): boolean => !!entries.get(id)?.urls[layoutId as CustomLayoutId];
export interface CustomAsset { src: string; meta: CustomArtMeta }
export function customAsset(id: string, layoutId: string): CustomAsset | null {
  const e = entries.get(id), k = layoutId as CustomLayoutId, art = e?.def.layouts[k], src = e?.urls[k];
  if (!e || !art || !src) return null;
  const { blob: _blob, ...meta } = art;
  return { src, meta };
}

// ---- changes: store first, then memory, so memory never shows something that was not saved ----
async function apply(r: StoreResult<CustomFrameDef>): Promise<StoreResult<CustomFrameDef>> {
  if (r.ok) { install(r.value); bump(); void store.requestPersistence().then((p) => { if (p !== persisted) { persisted = p; bump(); } }); }
  return r;
}
export const createCustomFrame = async (name: string, special = false, eventId?: string) => apply(await store.createFrame(name, Date.now(), special, eventId));
/** Event frame groups: move a frame into an event (null = no event). Memory changes only after the store accepted it. */
export const setCustomFrameEvent = async (id: string, eventId: string | null) => apply(await store.setEventId(id, eventId));
export const setCustomEnabled = async (id: string, enabled: boolean) => apply(await store.setEnabled(id, enabled));
export const renameCustomFrame = async (id: string, name: string) => apply(await store.renameFrame(id, name));
export const setCustomLayoutArt = async (id: string, layoutId: CustomLayoutId, art: CustomLayoutArt) => apply(await store.setLayoutArt(id, layoutId, art));
/** Phase 5: set or clear (null) the QR spot of one layout. Memory changes only after the store accepted it; a layout with no art is refused (`missing`). */
export const setCustomLayoutQr = async (id: string, layoutId: CustomLayoutId, qr: CustomQrArea | null): Promise<StoreResult<CustomFrameDef>> =>
  entries.get(id)?.def.layouts[layoutId] ? apply(await store.setLayoutQr(id, layoutId, qr)) : { ok: false, reason: 'missing', message: store.MESSAGES.missing };
export const removeCustomLayoutArt = async (id: string, layoutId: CustomLayoutId) => apply(await store.removeLayoutArt(id, layoutId));
export async function deleteCustomFrame(id: string): Promise<StoreResult<true>> {
  const r = await store.deleteFrame(id);
  if (r.ok) { revoke(entries.get(id)); entries.delete(id); bump(); }
  return r;
}

/** Tests only: forget everything (does not touch the database). */
export function resetCustomRuntime(): void { for (const e of entries.values()) revoke(e); entries.clear(); status = 'idle'; persisted = null; initP = null; version = 0; listeners.clear(); }
