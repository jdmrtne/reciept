import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  EVENT_LIMITS,
  addEventProfile,
  canDeleteEvent,
  deleteEventProfile,
  duplicateEventProfile,
  getActiveEvent,
  loadSettings,
  mergeSettings,
  resetEventProfile,
  saveSettings,
  setActiveEvent,
  updateEventProfile,
  type BoothSettings
} from './settings';
import { DEFAULT_BRANDING_TEXT, DEFAULT_EVENT_NAME, DEFAULT_THANK_YOU, unsupportedChars } from './events';

const KEY = 'booth.settings.v1';
function fakeStorage(opts: { failSet?: boolean } = {}) {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => (data.has(k) ? data.get(k)! : null), setItem: (k: string, v: string) => { if (opts.failSet) throw new Error('quota'); data.set(k, String(v)); }, removeItem: (k: string) => void data.delete(k), clear: () => data.clear() };
}
let store: ReturnType<typeof fakeStorage>;
const install = (s = fakeStorage()) => { store = s; vi.stubGlobal('localStorage', s); return s; };
beforeEach(() => { install(); });
afterEach(() => { vi.unstubAllGlobals(); });

/** Three events; the middle one is active. */
const three = (): BoothSettings => {
  let s = mergeSettings({});
  s = updateEventProfile(s, 'event-1', { name: 'WEDDING', header: 'RECEPTION', details: ['BALLROOM', 'HOST: SANTOS'] });
  s = addEventProfile(s, { name: 'BIRTHDAY', thankYou: 'SEE YOU' }, false);
  s = addEventProfile(s, { name: 'GALA' }, false);
  return setActiveEvent(s, 'event-2');
};
const ids = (s: BoothSettings) => s.events.map((e) => e.id);

describe('unsupportedChars', () => {
  it('lists characters the receipt font cannot draw, once each', () => {
    expect(unsupportedChars('PARTY \u{1F389}\u{1F389} \u65E5\u672C')).toEqual(['\u{1F389}', '\u65E5', '\u672C']);
  });
  it('names invisible and control characters by code point', () => {
    expect(unsupportedChars('A\u200BB')).toEqual(['U+200B']);
    expect(unsupportedChars('A\u0001B')).toEqual(['U+0001']);
  });
  it('accepts accents, typographic punctuation, the euro sign and every kind of space', () => {
    expect(unsupportedChars('Ni\u00F1o \u00C9lan \u201Cquote\u201D \u2014 \u20AC5 \u2022 a\u00A0b\tc')).toEqual([]);
  });
  it('is total: non-strings give nothing', () => {
    for (const v of [undefined, null, 5, {}, []]) expect(unsupportedChars(v)).toEqual([]);
  });
});

describe('duplicateEventProfile', () => {
  it('creates a NEW profile with its own stable id and the same text, and does not change the active event', () => {
    const s = three(), next = duplicateEventProfile(s, 'event-1');
    expect(next.events).toHaveLength(4);
    const copy = next.events[3];
    expect(copy.id).toBe('event-4');
    expect(copy).toMatchObject({ name: 'WEDDING COPY', header: 'RECEPTION', details: ['BALLROOM', 'HOST: SANTOS'], thankYou: DEFAULT_THANK_YOU });
    expect(next.activeEventId).toBe('event-2');
    expect(next.events.slice(0, 3)).toEqual(s.events); // nothing else moved or changed
  });
  it('copies the details instead of sharing the array', () => {
    const next = duplicateEventProfile(three(), 'event-1');
    next.events[3].details.push('X');
    expect(next.events[0].details).toEqual(['BALLROOM', 'HOST: SANTOS']);
  });
  it('keeps the name within the limit, ending in " COPY"', () => {
    const s = updateEventProfile(three(), 'event-1', { name: 'N'.repeat(EVENT_LIMITS.lineMax) });
    const copy = duplicateEventProfile(s, 'event-1').events[3];
    expect(copy.name.length).toBeLessThanOrEqual(EVENT_LIMITS.lineMax);
    expect(copy.name.endsWith(' COPY')).toBe(true);
  });
  it('a blank name copies as the default name', () => {
    const s = updateEventProfile(three(), 'event-1', { name: '   ' });
    expect(duplicateEventProfile(s, 'event-1').events[3].name).toBe(`${DEFAULT_EVENT_NAME} COPY`);
  });
  it('an unknown id, or the profile limit, leaves settings unchanged', () => {
    const s = three();
    expect(duplicateEventProfile(s, 'nope')).toBe(s);
    let full = mergeSettings({});
    while (full.events.length < EVENT_LIMITS.maxEvents) full = addEventProfile(full, {}, false);
    expect(duplicateEventProfile(full, 'event-1')).toBe(full);
  });
});

describe('deleteEventProfile and canDeleteEvent', () => {
  it('deletes an inactive profile; the others keep their ids and the active one stays active', () => {
    const next = deleteEventProfile(three(), 'event-3');
    expect(ids(next)).toEqual(['event-1', 'event-2']);
    expect(next.activeEventId).toBe('event-2');
  });
  it('refuses the active profile (the owner must make another one active first)', () => {
    const s = three();
    expect(canDeleteEvent(s, 'event-2')).toEqual({ ok: false, reason: 'active' });
    expect(deleteEventProfile(s, 'event-2')).toBe(s);
  });
  it('refuses the last remaining profile', () => {
    const s = mergeSettings({});
    expect(canDeleteEvent(s, 'event-1')).toEqual({ ok: false, reason: 'last' });
    expect(deleteEventProfile(s, 'event-1')).toBe(s);
  });
  it('refuses unknown and malformed ids', () => {
    const s = three();
    for (const id of ['nope', '', '../x', 'event-99', '__proto__']) { expect(canDeleteEvent(s, id)).toEqual({ ok: false, reason: 'unknown' }); expect(deleteEventProfile(s, id)).toBe(s); }
  });
  it('the active profile becomes deletable once another one is made active', () => {
    const s = setActiveEvent(three(), 'event-1');
    expect(canDeleteEvent(s, 'event-2')).toEqual({ ok: true });
    expect(deleteEventProfile(s, 'event-2').activeEventId).toBe('event-1');
  });
  it('a new id is never a reused one after a delete', () => {
    const s = deleteEventProfile(three(), 'event-3'); // highest id gone
    expect(addEventProfile(s, {}, false).events.at(-1)!.id).toBe('event-3'); // allowed: nothing newer exists
    const t = deleteEventProfile(three(), 'event-1');
    expect(addEventProfile(t, {}, false).events.at(-1)!.id).toBe('event-4'); // an older id is not recycled while a newer one exists
  });
});

describe('resetEventProfile', () => {
  it('puts every editable field back to the defaults and keeps the id and the active selection', () => {
    const s = three(), next = resetEventProfile(s, 'event-1');
    expect(next.events[0]).toEqual({ id: 'event-1', name: DEFAULT_EVENT_NAME, header: '', details: [], thankYou: DEFAULT_THANK_YOU, brandingEnabled: true, brandingText: DEFAULT_BRANDING_TEXT });
    expect(next.events.slice(1)).toEqual(s.events.slice(1));
    expect(next.activeEventId).toBe('event-2');
  });
  it('can reset the active profile (it stays active)', () => {
    const next = resetEventProfile(three(), 'event-2');
    expect(next.activeEventId).toBe('event-2');
    expect(getActiveEvent(next).name).toBe(DEFAULT_EVENT_NAME);
  });
  it('an unknown id changes nothing', () => {
    const s = three();
    expect(resetEventProfile(s, 'nope')).toBe(s);
  });
});

describe('duplicate event names with distinct ids', () => {
  it('are allowed, stay separate, and are selected by id', () => {
    let s = mergeSettings({});
    s = updateEventProfile(s, 'event-1', { name: 'GALA', header: 'FIRST' });
    s = addEventProfile(s, { name: 'GALA', header: 'SECOND' }, false);
    expect(s.events.map((e) => e.name)).toEqual(['GALA', 'GALA']);
    expect(new Set(ids(s)).size).toBe(2);
    expect(getActiveEvent(setActiveEvent(s, 'event-2')).header).toBe('SECOND');
    expect(getActiveEvent(setActiveEvent(s, 'event-1')).header).toBe('FIRST');
    expect(getActiveEvent(updateEventProfile(s, 'event-2', { header: 'EDITED' })).header).toBe('FIRST'); // editing one never touches the other
  });
});

describe('persistence', () => {
  it('profiles and the active selection survive save and reload; the derived eventName is not stored', () => {
    saveSettings(three());
    const back = loadSettings();
    expect(ids(back)).toEqual(['event-1', 'event-2', 'event-3']);
    expect(back.activeEventId).toBe('event-2');
    expect(back.eventName).toBe('BIRTHDAY');
    expect('eventName' in JSON.parse(store.data.get(KEY)!)).toBe(false);
  });
  it('every operation keeps printer, thermal, network and sharing settings intact', () => {
    const base = mergeSettings({ ...DEFAULT_SETTINGS, printer: 'network', paperWidthMm: 80, share: { enabled: true, publicBaseUrl: 'https://booth.example.com' }, network: { bridgeUrl: 'http://10.0.0.5:9101', host: '10.0.0.77', port: 9101 }, thermal: { ...DEFAULT_SETTINGS.thermal, contrast: 41, marginX: 12 }, inactivitySeconds: 90, countdownSeconds: 5 });
    const ops = [(s: BoothSettings) => addEventProfile(s, { name: 'A' }, false), (s: BoothSettings) => duplicateEventProfile(s, 'event-1'), (s: BoothSettings) => resetEventProfile(s, 'event-1'), (s: BoothSettings) => updateEventProfile(s, 'event-1', { name: 'Z' })];
    let s = base;
    for (const op of ops) s = op(s);
    s = deleteEventProfile(setActiveEvent(s, 'event-1'), 'event-2');
    saveSettings(s);
    const back = loadSettings();
    for (const k of ['printer', 'paperWidthMm', 'share', 'network', 'thermal', 'inactivitySeconds', 'countdownSeconds', 'bluetooth', 'windowsPrinter', 'successSeconds'] as const) expect(back[k], k).toEqual(base[k]);
  });
  it('a booth that only has the legacy eventName still upgrades, and the new operations work on it', () => {
    store.data.set(KEY, JSON.stringify({ eventName: 'OLD NAME', printer: 'usb' }));
    const s = loadSettings();
    expect(s.events.map((e) => e.name)).toEqual(['OLD NAME']);
    const next = duplicateEventProfile(s, s.activeEventId);
    expect(next.events.map((e) => e.name)).toEqual(['OLD NAME', 'OLD NAME COPY']);
    expect(next.printer).toBe('usb');
  });
  it('malformed saved data is repaired, after which the operations behave', () => {
    store.data.set(KEY, JSON.stringify({ events: [{ id: 'a', name: 'ONE' }, { id: 'a', name: 'TWO' }, { id: '../x', name: 'THREE' }, 7], activeEventId: 'missing' }));
    const s = loadSettings();
    expect(s.events.map((e) => e.name)).toEqual(['ONE', 'TWO', 'THREE']);
    expect(new Set(ids(s)).size).toBe(3);
    expect(s.activeEventId).toBe(s.events[0].id);
    const next = deleteEventProfile(s, s.events[2].id);
    expect(next.events.map((e) => e.name)).toEqual(['ONE', 'TWO']);
  });
  it('an unparsable blob falls back to one default event and is kept aside, not destroyed', () => {
    store.data.set(KEY, '{not json');
    expect(loadSettings().events).toHaveLength(1);
    expect(store.data.get('booth.settings.v1.unreadable')).toBe('{not json');
  });
  it('a refused write is reported (false) instead of pretending to save', () => {
    install(fakeStorage({ failSet: true }));
    expect(saveSettings(three())).toBe(false);
  });
});
