import type { PrinterErrorCode } from '../print/errors';
import { DEFAULT_THERMAL, LEGACY_THERMAL, PHOTOBOOTH_FACE, TONE_KEYS, type PrinterKind, type ThermalSettings } from '../print/types';
import { normalizeThermal } from '../print/pipeline';
import {
  DEFAULT_EVENT_PROFILE,
  EVENT_LIMITS,
  getActiveEvent,
  nextEventId,
  normalizeEventProfile,
  normalizeEvents,
  type EventProfile,
  type EventProfileInput
} from './events';

export { getActiveEvent, EVENT_LIMITS, DEFAULT_BRANDING_TEXT, DEFAULT_EVENT_NAME } from './events';
export type { EventProfile, EventProfileInput } from './events';

export interface BoothSettings {
  /** Seconds of inactivity (outside standby) before the session is wiped. */
  inactivitySeconds: number;
  /**
   * Saved event profiles (docs/ARCHITECTURE.md "Event profiles"). Always at least one. AUTHORITATIVE for event text:
   * read the active one through `getActiveEvent(settings)`, which returns trimmed, repaired values.
   */
  events: EventProfile[];
  /** Id of the active profile. Always one of `events`; repaired to the first profile otherwise. */
  activeEventId: string;
  /**
   * LEGACY, DERIVED, READ-ONLY mirror of the active profile's name, kept so existing consumers (Standby, Preview, Print,
   * Share, Edit) keep working unchanged. `mergeSettings` recomputes it on every call and `saveSettings` does not
   * store it. Writing it has no effect once `events` exist: change the name through `updateEventProfile`.
   */
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
  events: [{ ...DEFAULT_EVENT_PROFILE, details: [] }],
  activeEventId: DEFAULT_EVENT_PROFILE.id,
  eventName: DEFAULT_EVENT_PROFILE.name,
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
/** Copy of stored settings that could not be parsed, kept once so a corrupt blob is never silently destroyed by the next save. */
const KEY_UNREADABLE = 'booth.settings.v1.unreadable';
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
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Partial<BoothSettings>; // an array would spread its indices into the settings
  // Event profiles are authoritative; the legacy `eventName` only seeds the first profile when no usable list exists.
  const { events, activeEventId } = normalizeEvents(r.events, r.activeEventId, r.eventName);
  return {
    ...DEFAULT_SETTINGS,
    ...r,
    inactivitySeconds: clampInt(r.inactivitySeconds, 10, 3600, DEFAULT_SETTINGS.inactivitySeconds),
    countdownSeconds: clampInt(r.countdownSeconds, 0, 10, DEFAULT_SETTINGS.countdownSeconds),
    events,
    activeEventId,
    eventName: getActiveEvent({ events, activeEventId }).name,
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
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return mergeSettings({}); // storage unavailable: run on defaults
  }
  if (!raw) return mergeSettings({});
  try {
    return mergeSettings(JSON.parse(raw));
  } catch {
    keepUnreadable(raw);
    return mergeSettings({});
  }
}

function keepUnreadable(raw: string) {
  try {
    if (localStorage.getItem(KEY_UNREADABLE) === null) localStorage.setItem(KEY_UNREADABLE, raw);
  } catch {
    /* best effort */
  }
}

/**
 * Returns false when the browser refused the write (private mode, quota). The booth still runs on what is in memory/defaults.
 * The event list is normalised on the way out and the derived `eventName` mirror is NOT stored (one copy of the name).
 * A caller that only knows the legacy `eventName` (no `events`) is still saved correctly: it becomes the first profile.
 */
export function saveSettings(s: BoothSettings): boolean {
  try {
    const { eventName: _derived, ...rest } = s;
    void _derived;
    localStorage.setItem(KEY, JSON.stringify({ ...rest, ...normalizeEvents(s.events, s.activeEventId, s.eventName) }));
    return true;
  } catch {
    /* storage may be unavailable; booth still works with defaults */
    return false;
  }
}

/**
 * Pure event-profile operations. Each returns a NEW, fully merged settings object (ready for `saveSettings`) and
 * returns the input unchanged when the request is impossible (unknown id, profile limit reached).
 */
export function addEventProfile(s: BoothSettings, input: EventProfileInput = {}, activate = true): BoothSettings {
  if (s.events.length >= EVENT_LIMITS.maxEvents) return s;
  const id = nextEventId(s.events);
  const profile = normalizeEventProfile(input, id);
  return mergeSettings({ ...s, events: [...s.events, profile], activeEventId: activate ? id : s.activeEventId });
}

/** Edits an existing profile's fields. The id cannot be changed. */
export function updateEventProfile(s: BoothSettings, id: string, patch: EventProfileInput): BoothSettings {
  if (!s.events.some((e) => e.id === id)) return s;
  return mergeSettings({ ...s, events: s.events.map((e) => (e.id === id ? { ...e, ...patch, id } : e)) });
}

/** Makes an existing profile the active event. An unknown id leaves the selection as it was. */
export function setActiveEvent(s: BoothSettings, id: string): BoothSettings {
  return s.events.some((e) => e.id === id) ? mergeSettings({ ...s, activeEventId: id }) : s;
}
