import type { PrinterErrorCode } from '../print/errors';
import { DEFAULT_THERMAL, LEGACY_THERMAL, PHOTOBOOTH_FACE, TONE_KEYS, type PrinterKind, type ThermalSettings } from '../print/types';
import { normalizeThermal } from '../print/pipeline';

export interface BoothSettings {
  /** Seconds of inactivity (outside standby) before the session is wiped. */
  inactivitySeconds: number;
  eventName: string;
  paperWidthMm: 58 | 80;
  countdownSeconds: number;
  /** Which printer connection the booth uses. 'mock' prints nothing (safe default until Phase 10). */
  printer: PrinterKind;
  /** Owner print tuning (brightness, contrast, dithering, margins, density, feed/cut). */
  thermal: ThermalSettings;
  /** Bluetooth link tuning: bytes per GATT write and pause after each (ms). Slower = safer for printers that drop data. */
  bluetooth: { chunkSize: number; chunkDelayMs: number };
  /** Network printer: where the local print bridge runs and the printer's LAN address (raw port 9100). */
  network: { bridgeUrl: string; host: string; port: number };
  /** Name of the Windows print queue used by the 'windows' printer (see `npm run list-printers`). Shares network.bridgeUrl. */
  windowsPrinter: string;
  /** Test aid for the mock printer: fail the first prints with these errors, then work. Shows the error + RETRY screen without hardware. */
  mockFailures: PrinterErrorCode[];
  /** Seconds the "take your receipt" screen stays before returning to standby. */
  successSeconds: number;
  /**
   * QR codes after printing (docs/SHARE.md). Files are uploaded to the print bridge (network.bridgeUrl) and the QR
   * points at `publicBaseUrl`, the address customers' PHONES can reach (tunnel / LAN address of the bridge's share port).
   */
  share: { enabled: boolean; publicBaseUrl: string };
}

export const DEFAULT_SETTINGS: BoothSettings = {
  inactivitySeconds: 60,
  eventName: 'PHOTOBOOTH',
  paperWidthMm: 58,
  countdownSeconds: 3,
  printer: 'mock',
  thermal: DEFAULT_THERMAL,
  bluetooth: { chunkSize: 128, chunkDelayMs: 20 },
  network: { bridgeUrl: 'http://localhost:9101', host: '10.0.0.11', port: 9100 },
  windowsPrinter: 'POS80 10.0.0.11',
  mockFailures: [],
  successSeconds: 10,
  share: { enabled: false, publicBaseUrl: '' }
};

const KEY = 'booth.settings.v1';
const KINDS: PrinterKind[] = ['mock', 'system', 'windows', 'bluetooth', 'usb', 'network'];

const clampInt = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;

/**
 * Settings saved before the Photobooth Face preset existed have no sharpen/autoLevel. If their tone values are still
 * the untouched old defaults, move them to the new default look (paper margins/feed/cut are kept). Anything the owner
 * actually tuned is left alone; LEGACY in ADMIN restores the old look on demand.
 */
function upgradeThermal(t: unknown): unknown {
  if (!t || typeof t !== 'object') return t;
  const o = t as Record<string, unknown>;
  if ('sharpen' in o || 'autoLevel' in o) return t;
  const untouched = (['brightness', 'contrast', 'dither', 'threshold', 'density'] as const).every((k) => o[k] === LEGACY_THERMAL[k]);
  return untouched ? { ...o, ...Object.fromEntries(TONE_KEYS.map((k) => [k, PHOTOBOOTH_FACE[k]])) } : t;
}

/** Merge stored values over defaults and repair anything invalid (old versions, hand edits). */
export function mergeSettings(raw: unknown): BoothSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BoothSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...r,
    paperWidthMm: r.paperWidthMm === 80 ? 80 : 58,
    printer: KINDS.includes(r.printer as PrinterKind) ? (r.printer as PrinterKind) : DEFAULT_SETTINGS.printer,
    thermal: normalizeThermal(upgradeThermal(r.thermal) as Partial<ThermalSettings>),
    bluetooth: {
      chunkSize: clampInt(r.bluetooth?.chunkSize, 20, 512, DEFAULT_SETTINGS.bluetooth.chunkSize),
      chunkDelayMs: clampInt(r.bluetooth?.chunkDelayMs, 0, 200, DEFAULT_SETTINGS.bluetooth.chunkDelayMs)
    },
    network: {
      bridgeUrl: typeof r.network?.bridgeUrl === 'string' ? r.network.bridgeUrl.trim() : DEFAULT_SETTINGS.network.bridgeUrl,
      host: typeof r.network?.host === 'string' ? r.network.host.trim() : DEFAULT_SETTINGS.network.host,
      port: clampInt(r.network?.port, 1, 65535, DEFAULT_SETTINGS.network.port)
    },
    windowsPrinter: typeof r.windowsPrinter === 'string' ? r.windowsPrinter.slice(0, 200) : DEFAULT_SETTINGS.windowsPrinter, // not trimmed here: names contain spaces and this runs on every keystroke
    mockFailures: Array.isArray(r.mockFailures) ? r.mockFailures : [],
    successSeconds: typeof r.successSeconds === 'number' && r.successSeconds > 0 ? r.successSeconds : DEFAULT_SETTINGS.successSeconds,
    share: {
      enabled: r.share?.enabled === true,
      publicBaseUrl: typeof r.share?.publicBaseUrl === 'string' ? r.share.publicBaseUrl.slice(0, 300) : DEFAULT_SETTINGS.share.publicBaseUrl // not trimmed here: runs on every keystroke
    }
  };
}

export function loadSettings(): BoothSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? mergeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: BoothSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage may be unavailable; booth still works with defaults */
  }
}
