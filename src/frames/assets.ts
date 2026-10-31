import type { FrameDef } from './types';
import { customAsset, isCustomFrameId } from './custom/runtime';
import { eventLayoutAsset } from './custom/eventRuntime';
import { isEventLayoutId } from './custom/eventLayouts';

/**
 * Image-frame artwork lookup. PURE except for the one Vite glob below, so frame resolution is shared by the editor,
 * the picker thumbnails, the preview, the print renderer and the GIF overlay (all go through buildPlan / FramePreview).
 *
 * Convention (no code changes needed to add art): src/assets/frames/<frame dir>/<layoutId>.png, plus optional default.png.
 *   layout-specific  →  default.png  →  null (caller falls back to the vector frame)
 */
const MODULES = import.meta.glob('../assets/frames/*/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** "dir/name" → url, e.g. "kawaii/strip-2" → "/assets/strip-2-abc123.png". */
export type AssetIndex = Record<string, string>;

export function buildAssetIndex(modules: Record<string, string>): AssetIndex {
  const out: AssetIndex = {};
  for (const [path, url] of Object.entries(modules)) {
    const m = /frames\/([^/]+)\/([^/]+)\.(?:png|webp)$/.exec(path);
    if (m) out[`${m[1]}/${m[2]}`] = url;
  }
  return out;
}
const INDEX = buildAssetIndex(MODULES);

/** How the artwork maps onto the canvas. 'stretch' = authored for this exact layout (aspect matches); 'cover' = generic default.png, scaled uniformly and cropped, never distorted. */
export type AssetFit = 'stretch' | 'cover';
export interface FrameAsset { src: string; fit: AssetFit; layoutSpecific: boolean }

export function resolveFrameAsset(index: AssetIndex, f: FrameDef, layoutId: string): FrameAsset | null {
  if (!f.image) return null;
  const exact = index[`${f.image.dir}/${layoutId}`];
  if (exact) return { src: exact, fit: 'stretch', layoutSpecific: true };
  const generic = index[`${f.image.dir}/default`];
  return generic ? { src: generic, fit: 'cover', layoutSpecific: false } : null;
}

/** frameId + layoutId → artwork (or null → vector fallback). `f` comes from getFrame(frameId). */
export const getFrameAsset = (f: FrameDef, layoutId: string): FrameAsset | null => {
  if (isEventLayoutId(f.id)) { // event layout art (frames/custom/eventRuntime.ts): the frame id IS the layout id, and the art is drawn only on its own layout
    const e = f.id === layoutId ? eventLayoutAsset(f.id) : null;
    return e ? { src: e.src, fit: 'stretch', layoutSpecific: true } : null;
  }
  if (isCustomFrameId(f.id)) { // owner-uploaded art (frames/custom/runtime.ts): always layout specific, stretched like built-in layout art, never a generic default
    const c = customAsset(f.id, layoutId);
    return c ? { src: c.src, fit: 'stretch', layoutSpecific: true } : null;
  }
  return resolveFrameAsset(INDEX, f, layoutId);
};

/** Which layout ids have their own artwork for this frame (used by tests / docs). */
export const frameAssetLayouts = (f: FrameDef, index: AssetIndex = INDEX): string[] =>
  f.image ? Object.keys(index).filter((k) => k.startsWith(f.image!.dir + '/')).map((k) => k.slice(f.image!.dir.length + 1)) : [];
