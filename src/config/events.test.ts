import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRANDING_TEXT,
  DEFAULT_EVENT_NAME,
  DEFAULT_EVENT_PROFILE,
  DEFAULT_THANK_YOU,
  EVENT_LIMITS,
  cleanText,
  finalText,
  getActiveEvent,
  isValidEventId,
  nextEventId,
  normalizeEventProfile,
  normalizeEvents
} from './events';

describe('limits are centralised', () => {
  it('exposes the documented numbers in one place', () => {
    expect(EVENT_LIMITS).toEqual({ maxEvents: 50, lineMax: 40, detailLines: 3, idMax: 40 });
  });
  it('a maximum-length line still fits 58 mm paper (384 dots) at the 14 dot text size (advance 0.6 em)', () => {
    expect(EVENT_LIMITS.lineMax * 14 * 0.6).toBeLessThanOrEqual(384);
  });
});

describe('default profile', () => {
  it('is the documented default', () => {
    expect(DEFAULT_EVENT_PROFILE).toEqual({
      id: 'event-1', name: 'PHOTOBOOTH', header: '', details: [], thankYou: 'THANK YOU', brandingEnabled: true, brandingText: 'Printed by Memorys'
    });
    expect(DEFAULT_EVENT_NAME).toBe('PHOTOBOOTH');
    expect(DEFAULT_THANK_YOU).toBe('THANK YOU');
    expect(DEFAULT_BRANDING_TEXT).toBe('Printed by Memorys');
  });
  it('is frozen so the shared default cannot be mutated', () => {
    expect(Object.isFrozen(DEFAULT_EVENT_PROFILE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_EVENT_PROFILE.details)).toBe(true);
  });
  it('normalising nothing gives the default fields with a fresh details array', () => {
    const p = normalizeEventProfile(undefined, 'event-1');
    expect(p).toEqual(DEFAULT_EVENT_PROFILE);
    expect(p.details).not.toBe(DEFAULT_EVENT_PROFILE.details);
  });
});

describe('cleanText (stored, draft-safe level)', () => {
  it('keeps ordinary text, accents and the allowed typography', () => {
    expect(cleanText('Peña & José\u2019s 25th \u2014 \u201CParty\u201D \u20AC5 \u2022 Œuvre\u2026')).toBe('Peña & José\u2019s 25th \u2014 \u201CParty\u201D \u20AC5 \u2022 Œuvre\u2026');
  });
  it('composes decomposed accents (NFC) so n + combining tilde survives as ñ', () => {
    expect(cleanText('Pen\u0303a')).toBe('Peña');
  });
  it('folds tabs, NBSP and every kind of line break into one space', () => {
    expect(cleanText('A\tB\u00A0C\r\nD\nE\u2028F')).toBe('A B C D E F');
  });
  it('does NOT trim, so a space can be typed between words', () => {
    expect(cleanText('MARIA ')).toBe('MARIA ');
    expect(cleanText(' MARIA')).toBe(' MARIA');
    expect(cleanText('MARIA  &  JOSE')).toBe('MARIA & JOSE');
  });
  it('removes control, zero-width, bidi, emoji and CJK characters', () => {
    expect(cleanText('A\u0000B\u0007C\u200BD\u202EE\uFEFFF')).toBe('ABCDEF');
    expect(cleanText('PARTY \u{1F389}\u{1F38A}')).toBe('PARTY ');
    expect(cleanText('\u6B22\u8FCE HELLO')).toBe(' HELLO');
  });
  it('closes up spaces that removal brought together', () => {
    expect(cleanText('A \u{1F389} B')).toBe('A B');
  });
  it('caps the length and never splits a character', () => {
    expect(cleanText('x'.repeat(500))).toHaveLength(EVENT_LIMITS.lineMax);
    expect(cleanText('abcdef', 3)).toBe('abc');
  });
  it('returns an empty string for every non-string', () => {
    for (const v of [undefined, null, 5, true, {}, [], ['a'], () => 'a']) expect(cleanText(v)).toBe('');
  });
  it('is idempotent', () => {
    for (const v of ['  a \u{1F389}  b  ', 'Pen\u0303a\u00A0\u00A0x', 'z'.repeat(80), '\u0000\u0000', ' ']) expect(cleanText(cleanText(v))).toBe(cleanText(v));
  });
  it('finalText also trims', () => {
    expect(finalText('  MARIA  &  JOSE  ')).toBe('MARIA & JOSE');
    expect(finalText('\u{1F389}')).toBe('');
  });
});

describe('profile field validation', () => {
  it('repairs a wrong type per field without touching the others', () => {
    const p = normalizeEventProfile({ name: 42, header: { a: 1 }, details: 7, thankYou: null, brandingEnabled: 'yes', brandingText: [] }, 'event-9');
    expect(p).toEqual({ id: 'event-9', name: 'PHOTOBOOTH', header: '', details: [], thankYou: 'THANK YOU', brandingEnabled: true, brandingText: 'Printed by Memorys' });
    expect(normalizeEventProfile({ name: 'KEEP', brandingEnabled: 'no' }, 'x').name).toBe('KEEP');
  });
  it('treats a cleared string as the owner\'s choice, not as a missing value', () => {
    const p = normalizeEventProfile({ name: '', thankYou: '', brandingText: '' }, 'x');
    expect(p.name).toBe('');
    expect(p.thankYou).toBe('');
    expect(p.brandingText).toBe('');
  });
  it('caps every text field at the line limit', () => {
    const long = 'L'.repeat(300);
    const p = normalizeEventProfile({ name: long, header: long, details: [long], thankYou: long, brandingText: long }, 'x');
    for (const v of [p.name, p.header, p.details[0], p.thankYou, p.brandingText]) expect(v).toHaveLength(EVENT_LIMITS.lineMax);
  });
  it('caps detail lines, keeps blanks while drafting, and accepts a newline-separated string', () => {
    expect(normalizeEventProfile({ details: ['1', '2', '3', '4', '5'] }, 'x').details).toEqual(['1', '2', '3']);
    expect(normalizeEventProfile({ details: ['a', '', 'b'] }, 'x').details).toEqual(['a', '', 'b']);
    expect(normalizeEventProfile({ details: 'one\r\ntwo\nthree\nfour' }, 'x').details).toEqual(['one', 'two', 'three']);
    expect(normalizeEventProfile({ details: [1, null, { a: 1 }, 'ok'] }, 'x').details).toEqual(['', '', '']); // 4th dropped by the cap, non-strings blank
  });
  it('accepts only real booleans for branding', () => {
    expect(normalizeEventProfile({ brandingEnabled: false }, 'x').brandingEnabled).toBe(false);
    for (const v of [0, 1, 'false', null, undefined]) expect(normalizeEventProfile({ brandingEnabled: v }, 'x').brandingEnabled).toBe(true);
  });
  it('ignores unknown fields instead of carrying them along', () => {
    expect(Object.keys(normalizeEventProfile({ name: 'A', evil: 1, __proto__: { x: 1 } }, 'x')).sort()).toEqual(['brandingEnabled', 'brandingText', 'details', 'header', 'id', 'name', 'thankYou']);
  });
});

describe('ids', () => {
  it('accepts letters, digits, - and _ and rejects the rest', () => {
    for (const ok of ['event-1', 'a', 'Z9_-x', '7']) expect(isValidEventId(ok)).toBe(true);
    for (const bad of ['', '-a', '_a', 'a b', 'a/b', '..', 'é', 'x'.repeat(41), 5, null, undefined, {}]) expect(isValidEventId(bad)).toBe(false);
  });
  it('nextEventId is one above the highest event-N and never collides', () => {
    expect(nextEventId([])).toBe('event-1');
    expect(nextEventId([{ id: 'event-1' }])).toBe('event-2');
    expect(nextEventId([{ id: 'event-1' }, { id: 'event-7' }, { id: 'custom' }])).toBe('event-8');
    expect(nextEventId([{ id: 'custom' }])).toBe('event-1');
  });
});

describe('normalizeEvents', () => {
  it('creates the default profile when nothing usable is stored', () => {
    for (const raw of [undefined, null, [], 'x', 5, {}, [null, 5, 'a', []]]) {
      expect(normalizeEvents(raw, undefined)).toEqual({ events: [DEFAULT_EVENT_PROFILE], activeEventId: 'event-1' });
    }
  });
  it('seeds the first profile from a legacy name, cleaned and capped', () => {
    expect(normalizeEvents(undefined, undefined, 'MARIA & JOSE').events[0].name).toBe('MARIA & JOSE');
    expect(normalizeEvents(undefined, undefined, '  Spaced   Out ').events[0].name).toBe('Spaced Out');
    expect(normalizeEvents(undefined, undefined, 'N'.repeat(99)).events[0].name).toHaveLength(EVENT_LIMITS.lineMax);
    for (const bad of ['', '   ', 5, null, {}, '\u{1F389}']) expect(normalizeEvents(undefined, undefined, bad).events[0].name).toBe('PHOTOBOOTH');
  });
  it('ignores the legacy name once a usable list exists', () => {
    const r = normalizeEvents([{ id: 'a', name: 'LISTED' }], 'a', 'LEGACY');
    expect(r.events.map((e) => e.name)).toEqual(['LISTED']);
  });
  it('drops entries that are not objects but repairs every object', () => {
    const r = normalizeEvents([null, 'x', 3, [], { id: 'a', name: 'A' }, {}, { name: 5 }], 'a');
    expect(r.events).toHaveLength(3);
    expect(r.events[0].name).toBe('A');
  });
  it('replaces missing, invalid and duplicate ids deterministically without colliding with later valid ids', () => {
    const raw = [{ name: 'no id' }, { id: 'dup', name: 'first' }, { id: 'dup', name: 'second' }, { id: 'bad id!', name: 'bad' }, { id: 'event-1', name: 'claims event-1' }];
    const a = normalizeEvents(raw, undefined);
    const ids = a.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[1]).toBe('dup');
    expect(ids[4]).toBe('event-1'); // the valid one keeps its id; generated ones step around it
    expect(ids.every(isValidEventId)).toBe(true);
    expect(normalizeEvents(raw, undefined)).toEqual(a); // same input, same output
    expect(a.events.map((e) => e.name)).toEqual(['no id', 'first', 'second', 'bad', 'claims event-1']); // nothing discarded
  });
  it('is stable: normalising its own output changes nothing', () => {
    const once = normalizeEvents([{ name: 'x' }, { name: 'y', id: 'dup' }, { name: 'z', id: 'dup' }], 'dup');
    expect(normalizeEvents(once.events, once.activeEventId)).toEqual(once);
  });
  it('keeps at most maxEvents profiles', () => {
    const raw = Array.from({ length: 80 }, (_, i) => ({ id: `e${i}`, name: `N${i}` }));
    const r = normalizeEvents(raw, 'e79');
    expect(r.events).toHaveLength(EVENT_LIMITS.maxEvents);
    expect(r.activeEventId).toBe('e0'); // e79 was beyond the cap
  });
  it('keeps a valid active id and repairs a missing, unknown or non-string one to the first profile', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    expect(normalizeEvents(list, 'b').activeEventId).toBe('b');
    for (const bad of [undefined, null, 'zzz', '', 7, {}, ['b']]) expect(normalizeEvents(list, bad).activeEventId).toBe('a');
  });
});

describe('getActiveEvent', () => {
  it('returns the FINAL profile: trimmed, blank detail lines removed, blank name and branding defaulted', () => {
    const p = getActiveEvent({ events: [{ id: 'a', name: '  ', header: ' HEADER ', details: ['', ' d1 ', 'd2'], thankYou: ' ty ', brandingEnabled: true, brandingText: ' ' }], activeEventId: 'a' });
    expect(p).toEqual({ id: 'a', name: 'PHOTOBOOTH', header: 'HEADER', details: ['d1', 'd2'], thankYou: 'ty', brandingEnabled: true, brandingText: 'Printed by Memorys' });
  });
  it('keeps an intentionally empty thank-you empty', () => {
    expect(getActiveEvent({ events: [{ id: 'a', name: 'N', header: '', details: [], thankYou: '', brandingEnabled: true, brandingText: 'B' }], activeEventId: 'a' }).thankYou).toBe('');
  });
  it('is total: works on an object that was never normalised and never returns undefined', () => {
    expect(getActiveEvent({})).toEqual(DEFAULT_EVENT_PROFILE);
    expect(getActiveEvent({ eventName: 'LEGACY ONLY' }).name).toBe('LEGACY ONLY');
    expect(getActiveEvent({ events: [] as never[], activeEventId: 'nope' })).toEqual(DEFAULT_EVENT_PROFILE);
  });
  it('picks the active profile and falls back to the first one when the id is unknown', () => {
    const events = [normalizeEventProfile({ name: 'ONE' }, 'a'), normalizeEventProfile({ name: 'TWO' }, 'b')];
    expect(getActiveEvent({ events, activeEventId: 'b' }).name).toBe('TWO');
    expect(getActiveEvent({ events, activeEventId: 'x' }).name).toBe('ONE');
  });
  it('does not return the stored object, so callers cannot mutate settings through it', () => {
    const events = [normalizeEventProfile({ name: 'ONE', details: ['d'] }, 'a')];
    const p = getActiveEvent({ events, activeEventId: 'a' });
    p.details.push('x');
    p.name = 'CHANGED';
    expect(events[0]).toMatchObject({ name: 'ONE', details: ['d'] });
  });
});
