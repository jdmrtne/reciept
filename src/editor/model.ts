import type { Carry, Crop, EditorObject, EditorState, PhotoObject, Snapshot, StickerObject } from './types';
import { isSticker } from './types';
import { DEFAULT_FRAME, resolveFramed } from '../frames/registry';
import { DEFAULT_FILTER, getFilter } from '../filters/registry';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export interface PhotoSrc { src: string; iw: number; ih: number }

/** Fills every layout slot with a photo (photos repeat if the layout has more slots than photos). */
export function buildSnapshot(layoutId: string, photos: PhotoSrc[], frameId: string = DEFAULT_FRAME, filterId: string = DEFAULT_FILTER): Snapshot {
  const L = resolveFramed(layoutId, frameId);
  filterId = getFilter(filterId).id;
  if (!photos.length) return { layoutId, frameId, filterId, objects: [] };
  return {
    layoutId, frameId, filterId,
    objects: L.slots.map((s, i): PhotoObject => {
      const p = photos[i % photos.length];
      return { id: `photo-${i}`, type: 'photo', ...s, rotation: 0, layer: i, visible: true, ...p, crop: { zoom: 1, ox: 0, oy: 0 } };
    })
  };
}

/** Switch frame: slots may move (different header/footer heights) but crops and photos are kept. */
export function withFrame(s: Snapshot, frameId: string): Snapshot {
  const L = resolveFramed(s.layoutId, frameId);
  let pi = 0;
  const objects = s.objects.map((o): EditorObject => (o.type === 'photo' ? { ...o, ...L.slots[pi++] } : o));
  return { ...s, frameId, objects: clampStickers(objects, L.width, L.height) };
}

/** Filter applies to every photo (never the source blob) and is one undo step. */
export const withFilter = (s: Snapshot, filterId: string): Snapshot => ({ ...s, filterId: getFilter(filterId).id });

/** Swap which source photo sits in two slots. Slot geometry stays; each photo keeps its crop (re-clamped for the new slot). */
export function swapPhotos(s: Snapshot, idA: string, idB: string): Snapshot {
  const a = s.objects.find((o): o is PhotoObject => o.id === idA && o.type === 'photo');
  const b = s.objects.find((o): o is PhotoObject => o.id === idB && o.type === 'photo');
  if (!a || !b || a.id === b.id) return s;
  const put = (slot: PhotoObject, from: PhotoObject): PhotoObject => {
    const n = { ...slot, src: from.src, iw: from.iw, ih: from.ih };
    return { ...n, crop: clampCrop(n, from.crop) };
  };
  return { ...s, objects: s.objects.map((o) => (o.id === a.id ? put(a, b) : o.id === b.id ? put(b, a) : o)) };
}

/** Editor was rebuilt after a retake: bring back the stickers + filter from before. */
export function applyCarry(s: Snapshot, c: Carry): Snapshot {
  const L = resolveFramed(s.layoutId, s.frameId);
  return { ...s, filterId: getFilter(c.filterId).id, objects: clampStickers([...s.objects, ...c.stickers], L.width, L.height) };
}

// ---- stickers (pure) ----
const DEG = 180 / Math.PI;
export const MIN_STICKER = 40;
const newId = () => 'sticker-' + Math.random().toString(36).slice(2, 8);
const nextLayer = (s: Snapshot) => Math.max(-1, ...s.objects.map((o) => o.layer)) + 1;

/** Keeps sticker centres on the canvas (used when canvas size changes). */
export function clampStickers(objs: EditorObject[], cw: number, ch: number): EditorObject[] {
  return objs.map((o) => {
    if (!isSticker(o)) return o;
    const cx = clamp(o.x + o.w / 2, 0, cw), cy = clamp(o.y + o.h / 2, 0, ch);
    return { ...o, x: cx - o.w / 2, y: cy - o.h / 2 };
  });
}
/** After a layout change: carry the old stickers over to the freshly built snapshot. */
export function keepStickers(old: Snapshot, next: Snapshot): Snapshot {
  const L = resolveFramed(next.layoutId, next.frameId);
  const kept = old.objects.filter(isSticker);
  return { ...next, objects: clampStickers([...next.objects, ...kept], L.width, L.height) };
}
export function addSticker(s: Snapshot, stickerId: string, cw: number, ch: number) {
  const size = cw * 0.3, id = newId();
  const o: StickerObject = { id, type: 'sticker', stickerId, x: cw / 2 - size / 2, y: ch / 2 - size / 2, w: size, h: size, rotation: 0, layer: nextLayer(s), visible: true };
  return { snap: { ...s, objects: [...s.objects, o] }, id };
}
export const deleteObject = (s: Snapshot, id: string): Snapshot => ({ ...s, objects: s.objects.filter((o) => o.id !== id || o.type === 'photo') });
export function duplicateObject(s: Snapshot, id: string) {
  const o = s.objects.find((x) => x.id === id);
  if (!o || !isSticker(o)) return { snap: s, id };
  const nid = newId();
  return { snap: { ...s, objects: [...s.objects, { ...o, id: nid, x: o.x + 24, y: o.y + 24, layer: nextLayer(s) }] }, id: nid };
}
/** Swap layer with the neighbouring sticker (photos always stay underneath). */
export function moveLayer(s: Snapshot, id: string, dir: 1 | -1): Snapshot {
  const st = s.objects.filter(isSticker).sort((a, b) => a.layer - b.layer);
  const i = st.findIndex((o) => o.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= st.length) return s;
  const [a, b] = [st[i], st[j]];
  return { ...s, objects: s.objects.map((o) => (o.id === a.id ? { ...o, layer: b.layer } : o.id === b.id ? { ...o, layer: a.layer } : o)) };
}
export function hitSticker(o: StickerObject, p: { x: number; y: number }): boolean {
  const r = -o.rotation / DEG, dx = p.x - (o.x + o.w / 2), dy = p.y - (o.y + o.h / 2);
  return Math.abs(dx * Math.cos(r) - dy * Math.sin(r)) <= o.w / 2 && Math.abs(dx * Math.sin(r) + dy * Math.cos(r)) <= o.h / 2;
}
/** Bottom-right corner (the resize/rotate handle position). */
export function stickerCorner(o: StickerObject) {
  const r = o.rotation / DEG, hx = o.w / 2, hy = o.h / 2;
  return { x: o.x + hx + hx * Math.cos(r) - hy * Math.sin(r), y: o.y + hy + hx * Math.sin(r) + hy * Math.cos(r) };
}

const bounds = (o: PhotoObject, zoom: number) => {
  const base = Math.max(o.w / o.iw, o.h / o.ih) * zoom;
  const dw = o.iw * base, dh = o.ih * base;
  return { dw, dh, maxX: (dw - o.w) / 2, maxY: (dh - o.h) / 2 };
};

/** Keeps the crop valid: zoom 1..4 and the photo always covers its slot. */
export function clampCrop(o: PhotoObject, c: Crop): Crop {
  const zoom = clamp(c.zoom, 1, 4);
  const { maxX, maxY } = bounds(o, zoom);
  return { zoom, ox: clamp(c.ox, -maxX, maxX), oy: clamp(c.oy, -maxY, maxY) };
}

/** Where the (cropped) source image is drawn, before clipping to the slot. */
export function photoRect(o: PhotoObject) {
  const c = clampCrop(o, o.crop);
  const { dw, dh } = bounds(o, c.zoom);
  return { x: o.x + (o.w - dw) / 2 + c.ox, y: o.y + (o.h - dh) / 2 + c.oy, w: dw, h: dh };
}

// ---- history (pure) ----
export const newEditor = (s: Snapshot): EditorState => ({ past: [], present: s, future: [], initial: s });
export const commit = (e: EditorState, s: Snapshot): EditorState => ({ ...e, past: [...e.past.slice(-49), e.present], present: s, future: [] });
export const undo = (e: EditorState): EditorState =>
  e.past.length ? { ...e, past: e.past.slice(0, -1), present: e.past[e.past.length - 1], future: [e.present, ...e.future] } : e;
export const redo = (e: EditorState): EditorState =>
  e.future.length ? { ...e, past: [...e.past, e.present], present: e.future[0], future: e.future.slice(1) } : e;
export const resetEditor = (e: EditorState): EditorState => commit(e, e.initial);

export function loadPhotoSrcs(urls: string[]): Promise<PhotoSrc[]> {
  return Promise.all(urls.map((src) => new Promise<PhotoSrc>((res, rej) => {
    const i = new Image();
    i.onload = () => res({ src, iw: i.naturalWidth, ih: i.naturalHeight });
    i.onerror = () => rej(new Error('image'));
    i.src = src;
  })));
}
