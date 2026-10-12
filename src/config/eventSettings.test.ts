import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  EVENT_LIMITS,
  addEventProfile,
  getActiveEvent,
  loadSettings,
  mergeSettings,
  saveSettings,
  setActiveEvent,
  updateEventProfile
} from './settings';
import { makeCtx } from '../frames/prims';

const KEY = 'booth.settings.v1';
const BACKUP = 'booth.settings.v1.unreadable';

/** Minimal localStorage stand-in (the vitest environment here is node). */
function fakeStorage(opts: { failGet?: boolean; failSet?: boolean } = {}) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => { if (opts.failGet) throw new Error('denied'); return data.has(k) ? data.get(k)! : null; },
    setItem: (k: string, v: string) => { if (opts.failSet) throw new Error('quota'); data.set(k, String(v)); },
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear()
  };
}
let store: ReturnType<typeof fakeStorage>;
const install = (s = fakeStorage()) => { store = s; vi.stubGlobal('localStorage', s); return s; };
const stored = () => JSON.parse(store.data.get(KEY)!);

beforeEach(() => { install(); });
afterEach(() => { vi.unstubAllGlobals(); });

/** What a pre-EP-1 booth with a tuned printer, sharing and a customised event name had in storage. */
const LEGACY = {
  inactivitySeconds: 90,
  eventName: 'MARIA & JOSE',
  paperWidthMm: 80,
  countdownSeconds: 5,
  printer: 'usb',
  thermal: { ...DEFAULT_SETTINGS.thermal, contrast: 41, density: 4, marginX: 12 },
  bluetooth: { chunkSize: 180, chunkDelayMs: 7 },
  network: { bridgeUrl: 'http://10.0.0.5:9101', host: '10.0.0.77', port: 9101 },
  windowsPrinter: 'POS80 Custom Queue',
  mockFailures: ['failed'],
  successSeconds: 14,
  share: { enabled: true, publicBaseUrl: 'https://booth.example.com' }
};

describe('default profile creation', () => {
  it('a fresh install gets one sensible default profile and it is active', () => {
    const s = loadSettings();
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toEqual({ id: 'event-1', name: 'PHOTOBOOTH', header: '', details: [], thankYou: 'THANK YOU', brandingEnabled: true, brandingText: 'Printed by Memorys' });
    expect(s.activeEventId).toBe('event-1');
    expect(getActiveEvent(s).brandingText).toBe('Printed by Memorys');
  });
  it('DEFAULT_SETTINGS and mergeSettings({}) agree', () => {
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.eventName).toBe('PHOTOBOOTH');
  });
  it('merged defaults never alias the shared default arrays', () => {
    const s = mergeSettings({});
    s.events[0].details.push('x');
    s.events.push(s.events[0]);
    expect(DEFAULT_SETTINGS.events).toHaveLength(1);
    expect(DEFAULT_SETTINGS.events[0].details).toEqual([]);
    expect(mergeSettings({}).events[0].details).toEqual([]);
  });
});

describe('multiple profiles, active selection and round trips', () => {
  it('creates several profiles with stable, unique ids and persists them in order', () => {
    let s = loadSettings();
    s = addEventProfile(s, { name: 'WEDDING', header: 'MARIA & JOSE', details: ['12 DEC 2026', 'MANILA'], thankYou: 'SALAMAT!' });
    s = addEventProfile(s, { name: 'BIRTHDAY', brandingEnabled: false });
    expect(s.events.map((e) => e.id)).toEqual(['event-1', 'event-2', 'event-3']);
    expect(saveSettings(s)).toBe(true);
    const back = loadSettings();
    expect(back.events.map((e) => e.name)).toEqual(['PHOTOBOOTH', 'WEDDING', 'BIRTHDAY']);
    expect(back.events[1]).toMatchObject({ header: 'MARIA & JOSE', details: ['12 DEC 2026', 'MANILA'], thankYou: 'SALAMAT!' });
    expect(back.events[2].brandingEnabled).toBe(false);
    expect(back).toEqual(s);
  });
  it('a newly added profile becomes active unless told otherwise', () => {
    const a = addEventProfile(loadSettings(), { name: 'NEW' });
    expect(a.activeEventId).toBe('event-2');
    const b = addEventProfile(loadSettings(), { name: 'NEW' }, false);
    expect(b.activeEventId).toBe('event-1');
    expect(b.events).toHaveLength(2);
  });
  it('ids are not reused while a later profile exists and never collide with hand-picked ids', () => {
    let s = addEventProfile(loadSettings(), { name: 'B' });
    s = { ...s, events: [{ ...s.events[0], id: 'event-1' }, { ...s.events[1], id: 'custom' }] };
    s = addEventProfile(s, { name: 'C' });
    expect(s.events.map((e) => e.id)).toEqual(['event-1', 'custom', 'event-2']);
  });
  it('selects the active profile, persists it, and the legacy mirror follows', () => {
    let s = addEventProfile(loadSettings(), { name: 'SECOND' }, false);
    s = setActiveEvent(s, 'event-2');
    expect(s.activeEventId).toBe('event-2');
    expect(s.eventName).toBe('SECOND');
    saveSettings(s);
    const back = loadSettings();
    expect(back.activeEventId).toBe('event-2');
    expect(back.eventName).toBe('SECOND');
    expect(getActiveEvent(back).name).toBe('SECOND');
  });
  it('selecting an unknown id leaves everything as it was', () => {
    const s = addEventProfile(loadSettings(), { name: 'SECOND' });
    for (const bad of ['nope', '', 'event-99']) expect(setActiveEvent(s, bad)).toBe(s);
  });
  it('updating changes only that profile and never its id', () => {
    let s = addEventProfile(loadSettings(), { name: 'SECOND' }, false);
    s = updateEventProfile(s, 'event-2', { name: 'RENAMED', header: 'H', id: 'hijack' } as never);
    expect(s.events[1]).toMatchObject({ id: 'event-2', name: 'RENAMED', header: 'H' });
    expect(s.events[0].name).toBe('PHOTOBOOTH');
    expect(updateEventProfile(s, 'missing', { name: 'x' })).toBe(s);
  });
  it('refuses to add beyond the profile limit', () => {
    let s = loadSettings();
    for (let i = 0; i < EVENT_LIMITS.maxEvents + 5; i++) s = addEventProfile(s, { name: `E${i}` });
    expect(s.events).toHaveLength(EVENT_LIMITS.maxEvents);
    expect(addEventProfile(s, { name: 'one more' })).toBe(s);
  });
  it('a full round trip is lossless for a heavily customised settings object', () => {
    let s = mergeSettings(LEGACY);
    s = addEventProfile(s, { name: 'GALA', header: 'ANNUAL GALA', details: ['A', 'B', 'C'], thankYou: 'THANKS', brandingText: 'Made by us' });
    s = setActiveEvent(s, 'event-1');
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
    saveSettings(loadSettings());
    expect(loadSettings()).toEqual(s);
  });
  it('does not store the derived eventName and stores each profile exactly once', () => {
    saveSettings(addEventProfile(loadSettings(), { name: 'UNIQUE NAME' }));
    const raw = store.data.get(KEY)!;
    expect(stored()).not.toHaveProperty('eventName');
    expect(raw.split('UNIQUE NAME')).toHaveLength(2); // present once
    expect(stored().events).toHaveLength(2);
  });
});

describe('missing and invalid ids in storage', () => {
  it('repairs a missing, unknown and non-string active id to the first profile', () => {
    for (const activeEventId of [undefined, 'nope', 5, null]) {
      const s = mergeSettings({ events: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], activeEventId });
      expect(s.activeEventId).toBe('a');
      expect(s.eventName).toBe('A');
    }
  });
  it('keeps the selection when the id is valid', () => {
    expect(mergeSettings({ events: [{ id: 'a' }, { id: 'b', name: 'B' }], activeEventId: 'b' }).eventName).toBe('B');
  });
  it('gives profiles with a missing or invalid or duplicate id a valid unique one and keeps their content', () => {
    const s = mergeSettings({ events: [{ name: 'A' }, { id: 'x y', name: 'B' }, { id: 'same', name: 'C' }, { id: 'same', name: 'D' }] });
    expect(s.events.map((e) => e.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(new Set(s.events.map((e) => e.id)).size).toBe(4);
  });
  it('repairs ids the same way on every load, so the saved selection keeps pointing at the same profile', () => {
    const raw = { events: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], activeEventId: 'event-2' };
    store.data.set(KEY, JSON.stringify(raw));
    const first = loadSettings();
    expect(first.eventName).toBe('B');
    expect(loadSettings()).toEqual(first);
    saveSettings(first);
    expect(loadSettings()).toEqual(first);
  });
});

describe('invalid field types and oversize text', () => {
  it('repairs hostile profile fields on load', () => {
    const hostile = { events: [{ id: 'a', name: 12345, header: ['x'], details: { 0: 'a' }, thankYou: false, brandingEnabled: 'maybe', brandingText: 99 }] };
    store.data.set(KEY, JSON.stringify(hostile));
    expect(loadSettings().events[0]).toEqual({ id: 'a', name: 'PHOTOBOOTH', header: '', details: [], thankYou: 'THANK YOU', brandingEnabled: true, brandingText: 'Printed by Memorys' });
  });
  it('truncates over-long text, drops extra detail lines and strips unsupported characters', () => {
    const long = 'Z'.repeat(1000);
    const s = mergeSettings({ events: [{ id: 'a', name: long, header: long, details: [long, 'b', 'c', 'd'], thankYou: long, brandingText: long }] });
    const e = s.events[0];
    for (const v of [e.name, e.header, e.details[0], e.thankYou, e.brandingText]) expect(v).toHaveLength(EVENT_LIMITS.lineMax);
    expect(e.details).toHaveLength(EVENT_LIMITS.detailLines);
    expect(mergeSettings({ events: [{ id: 'a', name: 'PARTY \u{1F389} \u6B22\u8FCE\u0000' }] }).eventName).toBe('PARTY');
  });
  it('a stored value cannot smuggle markup or line breaks into a single-line field', () => {
    const s = mergeSettings({ events: [{ id: 'a', name: 'A\r\nB\u2028C' }] });
    expect(s.events[0].name).toBe('A B C');
  });
  it('keeps typing usable: stored text is not trimmed, the final text is', () => {
    let s = loadSettings();
    s = updateEventProfile(s, 'event-1', { name: 'MARIA ' });
    expect(s.events[0].name).toBe('MARIA ');
    s = updateEventProfile(s, 'event-1', { name: 'MARIA & ' });
    expect(s.events[0].name).toBe('MARIA & ');
    expect(getActiveEvent(s).name).toBe('MARIA &');
    expect(s.eventName).toBe('MARIA &');
  });
  it('lets a field be cleared while typing; the final name falls back to the default', () => {
    const s = updateEventProfile(loadSettings(), 'event-1', { name: '', thankYou: '', details: ['', ''] });
    expect(s.events[0]).toMatchObject({ name: '', thankYou: '', details: ['', ''] });
    expect(s.eventName).toBe('PHOTOBOOTH');
    expect(getActiveEvent(s)).toMatchObject({ name: 'PHOTOBOOTH', thankYou: '', details: [] });
  });
  it('mergeSettings is idempotent on hostile input (ADMIN re-merges on every change)', () => {
    const hostile = { ...LEGACY, events: [{ name: '  a\u0000  b ', details: ['', ' x', 'y', 'z'] }, 5, { id: 'dup' }, { id: 'dup', name: 'q'.repeat(90) }], activeEventId: 'dup', inactivitySeconds: 'x', countdownSeconds: -4 };
    const once = mergeSettings(hostile);
    expect(mergeSettings(once)).toEqual(once);
    expect(mergeSettings(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});

describe('migration from the legacy eventName', () => {
  it('turns a customised eventName into the first profile instead of the default', () => {
    store.data.set(KEY, JSON.stringify(LEGACY));
    const s = loadSettings();
    expect(s.events).toHaveLength(1);
    expect(s.events[0].name).toBe('MARIA & JOSE');
    expect(s.events[0].id).toBe('event-1');
    expect(s.activeEventId).toBe('event-1');
    expect(s.eventName).toBe('MARIA & JOSE');
    expect(s.events[0].thankYou).toBe('THANK YOU');
    expect(s.events[0].brandingEnabled).toBe(true);
  });
  it('never replaces a customised name with PHOTOBOOTH, across save and reload, however often it runs', () => {
    store.data.set(KEY, JSON.stringify(LEGACY));
    for (let i = 0; i < 3; i++) { saveSettings(loadSettings()); expect(loadSettings().eventName).toBe('MARIA & JOSE'); }
    expect(stored().events[0].name).toBe('MARIA & JOSE');
  });
  it('rewrites storage into the new shape on the first save: profiles stored, legacy name not duplicated', () => {
    store.data.set(KEY, JSON.stringify(LEGACY));
    saveSettings(loadSettings());
    expect(stored()).not.toHaveProperty('eventName');
    expect(stored().events).toHaveLength(1);
    expect(stored().activeEventId).toBe('event-1');
    expect(store.data.get(KEY)!.split('MARIA & JOSE')).toHaveLength(2);
  });
  it('uses the default only when there is no usable legacy name', () => {
    for (const eventName of [undefined, '', '   ', 42, null, {}, ['x'], '\u{1F389}']) {
      expect(mergeSettings({ eventName }).eventName).toBe('PHOTOBOOTH');
    }
  });
  it('cleans a legacy name and truncates an over-long one at the documented limit', () => {
    expect(mergeSettings({ eventName: '  Spaced   Out  ' }).eventName).toBe('Spaced Out');
    expect(mergeSettings({ eventName: 'N'.repeat(200) }).eventName).toBe('N'.repeat(EVENT_LIMITS.lineMax));
    expect(mergeSettings({ eventName: 'Peña de Francia' }).eventName).toBe('Peña de Francia');
  });
  it('profiles are authoritative: a stale default eventName beside them (older build re-saved) does not overwrite', () => {
    store.data.set(KEY, JSON.stringify({ ...LEGACY, eventName: 'PHOTOBOOTH', events: [{ id: 'event-1', name: 'KEPT' }], activeEventId: 'event-1' }));
    expect(loadSettings().eventName).toBe('KEPT');
  });
  it('writing the legacy eventName has no effect once profiles exist; the profile is the way to rename', () => {
    const s = mergeSettings({ ...loadSettings(), eventName: 'IGNORED' });
    expect(s.eventName).toBe('PHOTOBOOTH');
    expect(updateEventProfile(s, 'event-1', { name: 'RENAMED' }).eventName).toBe('RENAMED');
  });
  it('a legacy caller that saves only eventName (no events) is still persisted as the first profile', () => {
    const legacyShape = { ...DEFAULT_SETTINGS, events: undefined, activeEventId: undefined, eventName: 'LEGACY SAVE' } as never;
    expect(saveSettings(legacyShape)).toBe(true);
    expect(loadSettings().eventName).toBe('LEGACY SAVE');
  });
});

describe('malformed legacy localStorage data', () => {
  const MALFORMED = ['{not json', '', '{"events":', '\u0000\u0001', 'undefined', '{"a":'.repeat(50)];
  it('unparseable JSON loads the defaults and does not throw', () => {
    for (const raw of MALFORMED) {
      store.data.set(KEY, raw);
      expect(() => loadSettings()).not.toThrow();
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    }
  });
  it('keeps one copy of an unparseable blob before it can be overwritten, and never overwrites that copy', () => {
    store.data.set(KEY, '{owner had typed this by hand');
    loadSettings();
    expect(store.data.get(BACKUP)).toBe('{owner had typed this by hand');
    store.data.set(KEY, '{second corrupt');
    loadSettings();
    expect(store.data.get(BACKUP)).toBe('{owner had typed this by hand');
  });
  it('valid JSON of the wrong shape loads the defaults', () => {
    for (const raw of ['null', '[]', '"text"', '42', 'true', '[1,2,3]', '{}']) {
      store.data.set(KEY, raw);
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    }
  });
  it('garbage inside otherwise valid settings is repaired without losing the valid parts', () => {
    store.data.set(KEY, JSON.stringify({ ...LEGACY, events: 'nope', activeEventId: [], printer: 'laser', thermal: 'x', bluetooth: 5, network: null, share: [], mockFailures: 'x' }));
    const s = loadSettings();
    expect(s.eventName).toBe('MARIA & JOSE'); // events unusable, legacy name still migrates
    expect(s.paperWidthMm).toBe(80);
    expect(s.printer).toBe('mock');
    expect(s.successSeconds).toBe(14);
  });
  it('a storage that throws on read or write never breaks the booth', () => {
    install(fakeStorage({ failGet: true }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    install(fakeStorage({ failSet: true }));
    expect(saveSettings(loadSettings())).toBe(false);
  });
  it('no localStorage at all (private or odd contexts) falls back to defaults', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
  });
  it('repairs the two timers that were never validated', () => {
    for (const bad of ['x', NaN, null, {}, [], Infinity, undefined]) expect(mergeSettings({ inactivitySeconds: bad }).inactivitySeconds).toBe(60); // not a finite number: default
    expect(mergeSettings({ inactivitySeconds: 86400 }).inactivitySeconds).toBe(3600); // out of range: clamped, like the other numeric settings
    for (const low of [3, 0, -5]) expect(mergeSettings({ inactivitySeconds: low }).inactivitySeconds).toBe(10);
    for (const bad of ['x', NaN, null, [], Infinity]) expect(mergeSettings({ countdownSeconds: bad }).countdownSeconds).toBe(3);
    expect(mergeSettings({ countdownSeconds: 99 }).countdownSeconds).toBe(10);
    expect(mergeSettings({ countdownSeconds: -2 }).countdownSeconds).toBe(0);
  });
  it('keeps every valid timer value an installation could have had', () => {
    expect(mergeSettings({ inactivitySeconds: 120, countdownSeconds: 5 })).toMatchObject({ inactivitySeconds: 120, countdownSeconds: 5 });
    expect(mergeSettings({ countdownSeconds: 0 }).countdownSeconds).toBe(0);
  });
});

describe('unrelated settings are preserved', () => {
  it('printer, sharing, thermal, bluetooth, network and the rest survive the migration unchanged', () => {
    const s = mergeSettings(LEGACY);
    expect(s).toMatchObject({
      inactivitySeconds: 90, countdownSeconds: 5, paperWidthMm: 80, printer: 'usb', windowsPrinter: 'POS80 Custom Queue', successSeconds: 14,
      bluetooth: { chunkSize: 180, chunkDelayMs: 7 },
      network: { bridgeUrl: 'http://10.0.0.5:9101', host: '10.0.0.77', port: 9101 },
      share: { enabled: true, publicBaseUrl: 'https://booth.example.com' },
      mockFailures: ['failed']
    });
    expect(s.thermal).toMatchObject({ contrast: 41, density: 4, marginX: 12 });
  });
  it('they are identical before and after migration, saving and reloading', () => {
    const before = mergeSettings(LEGACY);
    store.data.set(KEY, JSON.stringify(LEGACY));
    saveSettings(loadSettings());
    const after = loadSettings();
    const { events: _e, activeEventId: _a, ...restAfter } = after;
    const { events: _e2, activeEventId: _a2, ...restBefore } = before;
    void [_e, _a, _e2, _a2];
    expect(restAfter).toEqual(restBefore);
  });
  it('editing an event does not touch printer, sharing or thermal settings', () => {
    const base = mergeSettings(LEGACY);
    const next = updateEventProfile(addEventProfile(base, { name: 'NEW' }), 'event-1', { header: 'H' });
    const strip = ({ events: _e, activeEventId: _a, eventName: _n, ...rest }: typeof base) => (void [_e, _a, _n], rest);
    expect(strip(next)).toEqual(strip(base));
  });
  it('unknown keys written by a newer or older build pass through untouched', () => {
    store.data.set(KEY, JSON.stringify({ ...LEGACY, futureFlag: { a: 1 } }));
    saveSettings(loadSettings());
    expect(stored().futureFlag).toEqual({ a: 1 });
  });
  it('the storage key is unchanged', () => {
    saveSettings(loadSettings());
    expect([...store.data.keys()]).toEqual([KEY]);
  });
});

describe('backward compatibility for existing eventName consumers', () => {
  it('mergeSettings({ eventName }) still reports that name (print.test.ts relies on this)', () => {
    expect(mergeSettings({ eventName: 'X' }).eventName).toBe('X');
  });
  it('loadSettings().eventName is a plain string for Standby, Preview, Print, Share and Edit, with no profile needed', () => {
    expect(typeof loadSettings().eventName).toBe('string');
    expect(loadSettings().eventName).toBe('PHOTOBOOTH');
  });
  it('the mirror always equals the active profile name and is trimmed (it seeds the receipt and the barcode)', () => {
    const s = updateEventProfile(loadSettings(), 'event-1', { name: ' PADDED NAME ' });
    expect(s.eventName).toBe(getActiveEvent(s).name);
    expect(s.eventName).toBe('PADDED NAME');
  });
  it('makeCtx(loadSettings().eventName) keeps producing the same frame context as before', () => {
    store.data.set(KEY, JSON.stringify(LEGACY));
    const d = new Date(2026, 9, 12, 8, 5);
    const ctx = makeCtx(loadSettings().eventName, d);
    expect(ctx).toEqual(makeCtx('MARIA & JOSE', d));
    expect(ctx.event).toBe('MARIA & JOSE');
    expect(Object.keys(ctx).sort()).toEqual(['date', 'event', 'serial', 'time', 'year']); // FrameCtx shape unchanged in EP-1
  });
});
