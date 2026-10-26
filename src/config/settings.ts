import { normalizeHidden, type LayoutVisibility } from '../layouts/visibility';
import { normalizeHidden as normalizeHiddenFrames, type FrameVisibility } from '../frames/visibility';
import type { PrinterErrorCode } from '../print/errors';
import { DEFAULT_THERMAL, LEGACY_THERMAL, PHOTOBOOTH_FACE, TONE_KEYS, type PrinterKind, type ThermalSettings } from '../print/types';
import { normalizeThermal } from '../print/pipeline';
import { normalizeFrameText, type FrameTextOverrides } from '../frames/frameText';
import {
  DEFAULT_EVENT_NAME,
  DEFAULT_EVENT_PROFILE,
  EVENT_LIMITS,
  finalText,
  getActiveEvent,
  nextEventId,
  normalizeEventProfile,
  normalizeEvents,
  type EventProfile,
  type EventProfileInput
} from './events';

export { getActiveEvent, EVENT_LIMITS, DEFAULT_BRANDING_TEXT, DEFAULT_EVENT_NAME } from './events';
export type { EventProfile, EventProfileInput } from './events';

/** Owner-chosen standby photo. METADATA ONLY: the image itself lives in IndexedDB (lib/standbyPhoto.ts), never in these settings. */
export interface StandbyPhotoSettings {
  /** A photo has been uploaded and is shown on standby. */
  enabled: boolean;
  /** COVER fills the screen (crops); CONTAIN shows the whole photo. */
  fit: 'cover' | 'contain';
  /** Keep the receipt card (event name + TAP TO START) on top of the photo. Off = photo plus a small TAP TO START pill. */
  showReceipt: boolean;
  /** Bumped on every upload so the standby screen reloads the image. */
  version: number;
}

export const DEFAULT_STANDBY_PHOTO: StandbyPhotoSettings = { enabled: false, fit: 'cover', showReceipt: true, version: 0 };

export function normalizeStandbyPhoto(raw: unknown): StandbyPhotoSettings {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Partial<Record<keyof StandbyPhotoSettings, unknown>>;
  return {
    enabled: r.enabled === true,
    fit: r.fit === 'contain' ? 'contain' : 'cover',
    showReceipt: r.showReceipt !== false,
    version: typeof r.version === 'number' && Number.isInteger(r.version) && r.version >= 0 ? r.version : 0
  };
}

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
  /** Which layouts the guest picker (CHOOSE YOUR STRIP) hides. Default: none. Repaired by mergeSettings; at least one layout always stays visible (layouts/visibility.ts). */
  layoutVisibility: LayoutVisibility;
  /** Which frame designs the guest's frame tray hides. Default: none. Repaired by mergeSettings; the frame-locked NCL pass frame is never hideable and at least one other frame always stays visible (frames/visibility.ts). */
  frameVisibility: FrameVisibility;
  /** Admin auto-save of finished outputs into the chosen folder (autosave/). Independent switches (photo, GIF, MP4 video), all OFF by default; the folder handle lives in IndexedDB, not here. */
  autoSave: { images: boolean; gifs: boolean; videos: boolean };
  /** Custom standby screen photo (metadata only; see StandbyPhotoSettings). */
  standbyPhoto: StandbyPhotoSettings;
  /** Owner text inside the built-in frames (ADMIN > Frame text): frameId -> `header.<i>`/`footer.<i>` -> text. Differences only; absent = built-in text, '' = hidden line. Repaired by mergeSettings (frames/frameText.ts). */
  frameText: FrameTextOverrides;
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
  share: { enabled: false, publicBaseUrl: '' },
  layoutVisibility: { hidden: [] },
  frameVisibility: { hidden: [] },
  autoSave: { images: false, gifs: false, videos: false },
  standbyPhoto: DEFAULT_STANDBY_PHOTO,
  frameText: {}
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
    },
    layoutVisibility: { hidden: normalizeHidden((r.layoutVisibility as { hidden?: unknown } | undefined)?.hidden) },
    frameVisibility: { hidden: normalizeHiddenFrames((r.frameVisibility as { hidden?: unknown } | undefined)?.hidden) },
    autoSave: { images: (r.autoSave as { images?: unknown } | undefined)?.images === true, gifs: (r.autoSave as { gifs?: unknown } | undefined)?.gifs === true, videos: (r.autoSave as { videos?: unknown } | undefined)?.videos === true },
    standbyPhoto: normalizeStandbyPhoto(r.standbyPhoto),
    frameText: normalizeFrameText(r.frameText)
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

/** Why a profile cannot be deleted right now (EP-3). `ok` = it can. */
export type DeleteCheck = { ok: true } | { ok: false; reason: 'unknown' | 'active' | 'last' };

/**
 * Only an INACTIVE profile can be deleted, and never the last one. The active profile is protected on purpose: the owner must
 * first make another profile active (or create one), so the booth is never left without a valid event and a customer session
 * can never start on a profile that is being removed.
 */
export function canDeleteEvent(s: BoothSettings, id: string): DeleteCheck {
  if (!s.events.some((e) => e.id === id)) return { ok: false, reason: 'unknown' };
  if (s.events.length <= 1) return { ok: false, reason: 'last' };
  if (s.activeEventId === id) return { ok: false, reason: 'active' };
  return { ok: true };
}

/** Deletes an inactive profile (see `canDeleteEvent`); returns the input unchanged when that is not allowed. The active id never changes. */
export function deleteEventProfile(s: BoothSettings, id: string): BoothSettings {
  if (!canDeleteEvent(s, id).ok) return s;
  return mergeSettings({ ...s, events: s.events.filter((e) => e.id !== id) });
}

/**
 * Copies a profile into a NEW profile (new stable id, same text, name ending in " COPY", kept within the name limit). The copy is appended
 * and is NOT made active: duplicating never changes which event customers get. Unknown id or profile limit reached: unchanged.
 */
export function duplicateEventProfile(s: BoothSettings, id: string): BoothSettings {
  const src = s.events.find((e) => e.id === id);
  if (!src || s.events.length >= EVENT_LIMITS.maxEvents) return s;
  const SUFFIX = ' COPY';
  const base = finalText(src.name) || DEFAULT_EVENT_NAME;
  const name = base.slice(0, EVENT_LIMITS.lineMax - SUFFIX.length).trimEnd() + SUFFIX;
  return addEventProfile(s, { ...src, name, details: [...src.details] }, false);
}

/** Puts every editable field of a profile back to the defaults. The id (and so whether it is the active one) is kept. */
export function resetEventProfile(s: BoothSettings, id: string): BoothSettings {
  if (!s.events.some((e) => e.id === id)) return s;
  const { id: _id, ...defaults } = normalizeEventProfile({}, id);
  void _id;
  return updateEventProfile(s, id, defaults);
}
