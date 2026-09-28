/** Every editable thing is an EditorObject. Add new types (sticker, ...) to the union — the editor core stays the same. */
export interface BaseObject {
  id: string;
  type: string;
  x: number; y: number; w: number; h: number; // canvas units (layout px)
  rotation: number; // degrees
  layer: number;
  visible: boolean;
}
export interface Crop { zoom: number; ox: number; oy: number } // zoom >= 1; ox/oy = pan in canvas units
export interface PhotoObject extends BaseObject {
  type: 'photo';
  src: string; iw: number; ih: number; // source image (never modified)
  crop: Crop;
}
export interface StickerObject extends BaseObject { type: 'sticker'; stickerId: string } // square: w === h; x,y = unrotated top-left
export type EditorObject = PhotoObject | StickerObject; // add new object types here
export const isPhoto = (o: EditorObject): o is PhotoObject => o.type === 'photo';
export const isSticker = (o: EditorObject): o is StickerObject => o.type === 'sticker';

export interface Snapshot { layoutId: string; frameId: string; filterId: string; objects: EditorObject[] }
/** Kept across a RETAKE from the editor so stickers + filter survive (photos/crops are rebuilt). */
export interface Carry { stickers: StickerObject[]; filterId: string }
export interface EditorState { past: Snapshot[]; present: Snapshot; future: Snapshot[]; initial: Snapshot }
