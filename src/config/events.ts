/**
 * Event profiles (Event Pack EP-1): owner-configured text for one event. Pure, DOM-free, no storage.
 * These are OWNER settings, never a guest-facing text tool. Nothing here is rendered yet (EP-2 does that).
 *
 * Two normalisation levels, because ADMIN calls `mergeSettings` on every keystroke:
 *  - STORED (draft-safe): strips unsupported characters, folds whitespace runs and newlines into one space, caps the
 *    length. It does NOT trim and does NOT drop blank lines, so an owner can type a space between two words or clear a
 *    field and retype it. Idempotent: normalising twice gives the same result.
 *  - FINAL (what consumers read, via `getActiveEvent`): the stored values trimmed, blank detail lines removed, a blank
 *    name replaced by the default. Receipt and screen code must read this level, never the raw stored fields.
 */

export interface EventProfile {
  /** Stable identifier. Never derived from the name, so renaming an event keeps its id. */
  id: string;
  /** Short event name ("MARIA & JOSE"). Also the legacy `eventName`. */
  name: string;
  /** Header/title line printed above the details (EP-2). May be empty. */
  header: string;
  /** Detail lines under the header (date, place, host...). At most `EVENT_LIMITS.detailLines`. */
  details: string[];
  /** One thank-you line. May be empty (empty means the owner chose none). */
  thankYou: string;
  /** Whether the branding line is printed. */
  brandingEnabled: boolean;
  /** Branding line. Never blank when branding is enabled: blank falls back to `DEFAULT_BRANDING_TEXT`. */
  brandingText: string;
}

/** Fields an owner can edit; `id` is fixed at creation. */
export type EventProfileInput = Partial<Omit<EventProfile, 'id'>>;

/**
 * Central limits for owner text. Every value counts characters of the already-sanitised text (all allowed characters
 * are single UTF-16 units, so length equals what the owner sees).
 * 40 characters is about 216 dots at the 9-dot minimum text size and still fits 58 mm paper (384 dots) at 14 dots
 * (336 dots), so the longest allowed line never overflows even before shrink-to-fit. EP-2 owns fitting.
 */
export const EVENT_LIMITS = {
  /** Saved profiles kept at most. Bounds localStorage growth and hand-edited data. */
  maxEvents: 50,
  /** Characters per single-line field: name, header, every detail line, thank-you, branding text. */
  lineMax: 40,
  /** Detail lines per event. */
  detailLines: 3,
  /** Profile id: letters, digits, '-' and '_', starting with a letter or digit. */
  idMax: 40
} as const;

export const DEFAULT_EVENT_NAME = 'PHOTOBOOTH';
export const DEFAULT_THANK_YOU = 'THANK YOU';
export const DEFAULT_BRANDING_TEXT = 'Printed by Memorys';
export const FIRST_EVENT_ID = 'event-1';

/** Default profile for installs that never configured an event. Frozen so nobody mutates the shared default. */
export const DEFAULT_EVENT_PROFILE: Readonly<EventProfile> = Object.freeze({
  id: FIRST_EVENT_ID,
  name: DEFAULT_EVENT_NAME,
  header: '',
  details: Object.freeze([]) as unknown as string[],
  thankYou: DEFAULT_THANK_YOU,
  brandingEnabled: true,
  brandingText: DEFAULT_BRANDING_TEXT
});

/**
 * The bundled Courier Prime is the Fontsource "latin" subset, so only characters it can draw are allowed (assumption
 * from the subset name; the woff2 could not be decoded in the authoring sandbox): Basic Latin, Latin-1 letters and
 * symbols (accents such as ñ and é), Œ œ, typographic dashes and quotes, bullet, ellipsis and the euro sign.
 * Emoji, CJK, control and zero-width characters are removed. NBSP is folded to a normal space.
 */
const DISALLOWED = /[^\u0020-\u007E\u00A1-\u00AC\u00AE-\u00FF\u0152\u0153\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/g;

const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Draft-safe text clean-up (see the file header). Non-strings become ''. Never throws. */
export function cleanText(raw: unknown, max: number = EVENT_LIMITS.lineMax): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .replace(INVISIBLE, '') // zero-width and bidi marks vanish; they must not turn into a visible space (U+FEFF counts as whitespace)
    .replace(/\s+/g, ' ') // spaces, tabs, NBSP and every line break become one space
    .replace(DISALLOWED, '')
    .replace(/ {2,}/g, ' ') // removing characters can bring two spaces together
    .slice(0, max);
}

/** Final text: cleaned, then trimmed. */
export const finalText = (raw: unknown, max: number = EVENT_LIMITS.lineMax): string => cleanText(raw, max).trim();

export const isValidEventId = (v: unknown): v is string => typeof v === 'string' && v.length <= EVENT_LIMITS.idMax && ID_RE.test(v);

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Detail lines from an array (or, tolerated, one newline-separated string). Draft-safe: blanks are kept. */
function cleanDetails(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\r?\n/) : [];
  return list.slice(0, EVENT_LIMITS.detailLines).map((l) => cleanText(l));
}

/**
 * STORED-level normalisation of one profile. A wrong type falls back to the default for that field; a string that
 * cleans down to '' is kept (the owner may clear a field). `id` must already be valid and unique (see `normalizeEvents`).
 */
export function normalizeEventProfile(raw: unknown, id: string): EventProfile {
  const r = isPlainObject(raw) ? raw : {};
  return {
    id,
    name: typeof r.name === 'string' ? cleanText(r.name) : DEFAULT_EVENT_NAME,
    header: cleanText(r.header),
    details: cleanDetails(r.details),
    thankYou: typeof r.thankYou === 'string' ? cleanText(r.thankYou) : DEFAULT_THANK_YOU,
    brandingEnabled: typeof r.brandingEnabled === 'boolean' ? r.brandingEnabled : DEFAULT_EVENT_PROFILE.brandingEnabled,
    brandingText: typeof r.brandingText === 'string' ? cleanText(r.brandingText) : DEFAULT_BRANDING_TEXT
  };
}

/** FINAL-level view of a profile: what the receipt and the screens should use. */
export function finalizeEventProfile(p: EventProfile): EventProfile {
  const brandingText = finalText(p.brandingText);
  return {
    id: p.id,
    name: finalText(p.name) || DEFAULT_EVENT_NAME,
    header: finalText(p.header),
    details: p.details.map((l) => finalText(l)).filter(Boolean),
    thankYou: finalText(p.thankYou),
    brandingEnabled: p.brandingEnabled,
    brandingText: brandingText || DEFAULT_BRANDING_TEXT
  };
}

/** Next unused `event-N` id: one more than the highest N present, so ids are never reused while a newer one exists. */
export function nextEventId(existing: readonly { id: string }[]): string {
  let n = 0;
  for (const { id } of existing) {
    const m = /^event-(\d+)$/.exec(id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  let id = `event-${n + 1}`;
  const taken = new Set(existing.map((e) => e.id));
  while (taken.has(id)) id = `event-${Number(id.slice(6)) + 1}`;
  return id;
}

export interface ResolvedEvents {
  events: EventProfile[];
  activeEventId: string;
}

/**
 * Turns whatever was stored into a valid list plus a valid active id.
 *  - Entries that are not objects are dropped; every other entry is repaired field by field, never discarded.
 *  - A missing, invalid or duplicate id is replaced by a deterministic `event-N` id (same input, same output, so
 *    repeated loads agree even before the repaired list is saved).
 *  - More than `maxEvents` entries: the first `maxEvents` are kept (only reachable by hand-editing storage).
 *  - No usable entry at all: ONE profile is created from the legacy global `eventName` when it is a non-blank string
 *    (so a customised name survives the upgrade), otherwise the default profile.
 *  - Once a usable list exists it is authoritative and `legacyName` is ignored (an older build that re-saved the
 *    default `eventName` next to the list must not overwrite a profile).
 *  - `activeId` that is not in the list falls back to the first profile.
 */
export function normalizeEvents(rawEvents: unknown, rawActiveId: unknown, legacyName?: unknown): ResolvedEvents {
  const items = (Array.isArray(rawEvents) ? rawEvents : []).filter(isPlainObject).slice(0, EVENT_LIMITS.maxEvents);

  // ids already claimed by the first occurrence of a valid id, so generated ids can never collide with a later entry
  const claimed = new Set<string>();
  for (const it of items) if (isValidEventId(it.id)) claimed.add(it.id);

  const used = new Set<string>();
  let counter = 0;
  const generate = () => {
    let id: string;
    do id = `event-${++counter}`;
    while (claimed.has(id) || used.has(id));
    return id;
  };

  const events = items.map((it) => {
    const id = isValidEventId(it.id) && !used.has(it.id) ? it.id : generate();
    used.add(id);
    return normalizeEventProfile(it, id);
  });

  if (events.length === 0) {
    const legacy = finalText(legacyName);
    events.push({ ...normalizeEventProfile({}, FIRST_EVENT_ID), name: legacy || DEFAULT_EVENT_NAME });
  }

  const activeEventId = typeof rawActiveId === 'string' && events.some((e) => e.id === rawActiveId) ? rawActiveId : events[0].id;
  return { events, activeEventId };
}

/**
 * The active event as a FINAL-level profile. Pure and total: works on a settings object that was never normalised
 * (missing list, unknown id) and always returns a valid profile. This is the one place consumers read event text.
 */
export function getActiveEvent(s: { events?: readonly EventProfile[]; activeEventId?: string; eventName?: string }): EventProfile {
  const { events, activeEventId } = normalizeEvents(s.events, s.activeEventId, s.eventName);
  return finalizeEventProfile(events.find((e) => e.id === activeEventId) ?? events[0]);
}
