/** Straight RGBA pixels (same layout as canvas ImageData). The thermal pipeline's input. Never mutated. */
export interface RGBAImage { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

/** 1-bit image, rows packed MSB-first (bit 7 = leftmost dot), 1 = BLACK (burned). rowBytes = ceil(width/8). */
export interface Bitmap1 { width: number; height: number; rowBytes: number; data: Uint8Array }

export type DitherMode = 'threshold' | 'floyd-steinberg' | 'atkinson' | 'ordered' | 'halftone';

/** Owner-facing print tuning. Stored in BoothSettings (settings only, never photos). */
export interface ThermalSettings {
  /** -100..100. Added after contrast. */
  brightness: number;
  /** -100..100. */
  contrast: number;
  dither: DitherMode;
  /** 3..12. Distance in printer dots between halftone dot centres (`halftone` mode only). Bigger = chunkier, more visible dots. */
  dotSize: number;
  /** 0..255. Cut-off for `threshold` mode (error diffusion / ordered ignore it). */
  threshold: number;
  /** 1..5 (3 = neutral). Software darkness bias for printers that burn light/dark; Phase 10 may also map it to a heat command. */
  density: number;
  /**
   * 0..100 (percent). Unsharp-mask amount applied at PRINTER resolution just before dithering (0 = off, 65 = 0.65).
   * Restores the eye/brow/lip/jaw edges that resampling and the camera softened; capped so it cannot make halos.
   */
  sharpen: number;
  /**
   * 0..100 (percent). Adaptive levels: stretches the photo pixels' own tonal range to the full range before the
   * tone curve, so a dim or over-bright booth still lands on the same face tones. 0 = off (fixed curve only).
   */
  autoLevel: number;
  /** Blank dots left and right of the picture (paper is white there). Content is resized to fit. */
  marginX: number;
  /** Blank dots above the picture. */
  marginTop: number;
  /** Blank dots below the picture (before the feed/cut). */
  marginBottom: number;
  /** Extra lines fed after the image so the receipt clears the tear bar. */
  feedLines: number;
  /** Send a partial-cut command after the feed (printers without a cutter ignore it). */
  cut: boolean;
}

/** Non-tone settings shared by every preset (paper handling, not image look). */
const PAPER_DEFAULTS = { marginX: 0, marginTop: 0, marginBottom: 8, feedLines: 4, cut: false } as const;

/** The pre-preset behaviour, kept selectable so nothing that worked before is lost. */
export const LEGACY_THERMAL: ThermalSettings = {
  brightness: 0, contrast: 0, dither: 'atkinson', dotSize: 6, threshold: 128, density: 3, sharpen: 0, autoLevel: 0, ...PAPER_DEFAULTS
};

/**
 * Photobooth Face: tuned so faces stay recognisable as 1-bit thermal dots. Order and values are explained in
 * pipeline.ts (toThermalBitmap). Start here; nudge brightness / contrast / sharpen / autoLevel to taste.
 */
export const PHOTOBOOTH_FACE: ThermalSettings = {
  brightness: 15, contrast: 35, dither: 'floyd-steinberg', dotSize: 6, threshold: 128, density: 2, sharpen: 65, autoLevel: 60, ...PAPER_DEFAULTS
};

/** Halftone: photos become a regular 45° screen of round dots (newspaper / pop-art look); text and frame lines stay crisp. */
export const HALFTONE: ThermalSettings = {
  brightness: 10, contrast: 25, dither: 'halftone', dotSize: 6, threshold: 128, density: 3, sharpen: 0, autoLevel: 60, ...PAPER_DEFAULTS
};

/** Tone-only presets the owner can pick in ADMIN. Applying one never touches margins/feed/cut. */
export const THERMAL_PRESETS = [
  { id: 'photobooth-face', name: 'PHOTOBOOTH FACE', tone: PHOTOBOOTH_FACE },
  { id: 'halftone', name: 'HALFTONE', tone: HALFTONE },
  { id: 'legacy', name: 'LEGACY', tone: LEGACY_THERMAL }
] as const;
export const TONE_KEYS = ['brightness', 'contrast', 'dither', 'dotSize', 'threshold', 'density', 'sharpen', 'autoLevel'] as const;

export const DEFAULT_THERMAL: ThermalSettings = PHOTOBOOTH_FACE;

export type PrinterKind = 'mock' | 'system' | 'windows' | 'bluetooth' | 'usb' | 'network';

export type PrinterState = 'disconnected' | 'ready' | 'busy' | 'error';
export interface PrinterStatus { state: PrinterState; detail?: string }

/** Customer-facing summary for the Standby dot: ready to print, needs attention (paper low/out, cover open), or not reachable. */
export type PrinterHealthLevel = 'ready' | 'attention' | 'offline';
export interface PrinterHealth { level: PrinterHealthLevel; detail?: string }

export interface PrintOptions {
  thermal: ThermalSettings;
  /** Printable dots for the paper (384 for 58mm, 576 for 80mm). */
  paperDots: number;
  /** 0..1 as bytes are sent. Optional. */
  onProgress?: (fraction: number) => void;
  /** Give up after this long (default 60 000). The kiosk must never hang on a dead printer. */
  timeoutMs?: number;
}
/** What adapters receive: a ready 1-bit bitmap plus the job's paper commands. They encode + transport it. */
export interface AdapterJob {
  thermal: Pick<ThermalSettings, 'feedLines' | 'cut' | 'density'>;
  onProgress?: (fraction: number) => void;
}

export interface PrintResult { bitmap: Bitmap1; bytes: number }

/** Implemented by every printer connection. Adapters never touch the UI or the composition. */
export interface PrinterAdapter {
  readonly kind: PrinterKind;
  readonly label: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): Promise<PrinterStatus>;
  print(bitmap: Bitmap1, job: AdapterJob): Promise<void>;
  /** Optional one-time pairing (needs a user tap). Mock has none. */
  pair?(): Promise<void>;
}
