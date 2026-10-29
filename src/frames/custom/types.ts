/**
 * Custom (owner-uploaded) image frames. Phase 1: pure data shapes only, no DOM, no storage.
 * Design notes and decisions: docs/CUSTOM-FRAMES.md.
 */

/** Layouts a custom frame can supply art for: the six ordinary layouts (the built-in frame-locked NCL pass layouts were removed). */
export type CustomLayoutId = 'single' | 'strip-2' | 'strip-3' | 'strip-4' | 'grid-2x2' | 'classic';

/**
 * One photo slot in the SAME coordinate system as `Arrangement` kind 'manual' (layouts/types.ts): every value is a fraction of the
 * artwork WIDTH (y, h too, not of the height), so it is resolution independent and the engine multiplies by the canvas width.
 */
export interface CustomSlot { x: number; y: number; w: number; h: number }

/** A detected transparent window in artwork PIXELS (bounding box). Kept for the admin outline preview. */
export interface WindowRect { x: number; y: number; w: number; h: number }

/** Optional QR safe area, fractions of the canvas (x/w of its width, y/h of its height): same meaning as `QrArea.safeArea`. Phase 5. */
export interface CustomQrArea { x: number; y: number; w: number; h: number }

/** What one uploaded PNG/WebP yields after validation (pure data, no blob). */
export interface CustomArtMeta {
  mime: 'image/png' | 'image/webp';
  width: number;
  height: number;
  /** height / width: becomes `heightRatio` of the manual arrangement. */
  heightRatio: number;
  /** Detected windows in pixels, ordered top to bottom then left to right. */
  windows: WindowRect[];
  /** `windows` as manual-arrangement slots (fractions of width, with the small bleed applied). Same order. */
  slots: CustomSlot[];
  qr?: CustomQrArea;
}

/** Stored per layout: the file itself plus its metadata. */
export interface CustomLayoutArt extends CustomArtMeta {
  blob: Blob;
  /** Stamped by the store on every write of this layout's file. IndexedDB hands back a fresh Blob copy on each read, so the runtime compares this, not the Blob, to know a file is unchanged. */
  rev?: string;
}

export interface CustomFrameDef {
  /** Always starts with CUSTOM_FRAME_PREFIX so it can never collide with a built-in frame id. */
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Only the layouts the owner uploaded. A frame is offered only on these layouts. */
  layouts: Partial<Record<CustomLayoutId, CustomLayoutArt>>;
  /** Owner's ON/OFF switch (ADMIN > Events > Event special frames). Absent = on. Off: guests no longer see it in the frame tray; a guest already holding it keeps it. */
  enabled?: boolean;
  /** True = an EVENT SPECIAL frame (listed in ADMIN > Events); absent/false = a normal own frame (ADMIN > Frames). Same pictures, same rules, just two lists. */
  special?: boolean;
}

export const CUSTOM_FRAME_PREFIX = 'custom-';
