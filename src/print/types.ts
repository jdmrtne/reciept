/** Straight RGBA pixels (same layout as canvas ImageData). The thermal pipeline's input. Never mutated. */
export interface RGBAImage { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

/** 1-bit image, rows packed MSB-first (bit 7 = leftmost dot), 1 = BLACK (burned). rowBytes = ceil(width/8). */
export interface Bitmap1 { width: number; height: number; rowBytes: number; data: Uint8Array }

export type DitherMode = 'threshold' | 'floyd-steinberg' | 'atkinson' | 'ordered';

/** Owner-facing print tuning. Stored in BoothSettings (settings only, never photos). */
export interface ThermalSettings {
  /** -100..100. Added after contrast. */
  brightness: number;
  /** -100..100. */
  contrast: number;
  dither: DitherMode;
  /** 0..255. Cut-off for `threshold` mode (error diffusion / ordered ignore it). */
  threshold: number;
  /** 1..5 (3 = neutral). Software darkness bias for printers that burn light/dark; Phase 10 may also map it to a heat command. */
  density: number;
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

export const DEFAULT_THERMAL: ThermalSettings = {
  brightness: 0, contrast: 0, dither: 'atkinson', threshold: 128, density: 3,
  marginX: 0, marginTop: 0, marginBottom: 8, feedLines: 4, cut: false
};

export type PrinterKind = 'mock' | 'system' | 'windows' | 'bluetooth' | 'usb' | 'network';

export type PrinterState = 'disconnected' | 'ready' | 'busy' | 'error';
export interface PrinterStatus { state: PrinterState; detail?: string }

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
