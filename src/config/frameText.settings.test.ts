// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from './settings';
import { EDITABLE_TEXT_FRAMES, FRAME_TEXT_MAX_LINES, frameTextKeys, normalizeFrameText } from '../frames/frameText';
import { EVENT_LIMITS } from './events';

const ft = (raw: unknown) => mergeSettings({ frameText: raw }).frameText;

describe('settings.frameText', () => {
  it('defaults to {} and the editable list is the nine text frames', () => {
    expect(DEFAULT_SETTINGS.frameText).toEqual({});
    expect(mergeSettings({}).frameText).toEqual({});
    expect([...EDITABLE_TEXT_FRAMES]).toEqual(['classic-receipt', 'minimal-receipt', 'retro-receipt', 'ticket-stub', 'birthday', 'graduation', 'friends', 'couple', 'event']);
  });
  it('repairs a non-object to {}', () => {
    for (const bad of ['x', 7, null, [], [1], true]) expect(ft(bad), String(bad)).toEqual({});
    expect(ft({ birthday: 'oops' })).toEqual({});
    expect(ft({ birthday: ['a'] })).toEqual({});
  });
  it('drops unknown frames, unknown or out-of-range keys and non-strings', () => {
    const r = ft({ nope: { 'header.0': 'A' }, 'wanted-bounty': { 'header.0': 'A' }, kawaii: { 'header.0': 'A' }, birthday: { 'header.0': 'HI', 'header.2': 'X', 'footer.9': 'X', 'body.0': 'X', 'footer.x': 'X', 'footer.0': 5, 'footer.1': null } });
    expect(r).toEqual({ birthday: { 'header.0': 'HI' } });
  });
  it('sanitises with cleanText and the event line limit', () => {
    const r = ft({ birthday: { 'header.0': 'A\u{1F600}B\n\tC   D', 'footer.0': 'x'.repeat(100) } });
    expect(r.birthday['header.0']).toBe('AB C D');
    expect(r.birthday['footer.0']).toHaveLength(EVENT_LIMITS.lineMax);
  });
  it('is capped: every line of every frame set stays within the cap', () => {
    const all = Object.fromEntries(EDITABLE_TEXT_FRAMES.map((id) => [id, Object.fromEntries(frameTextKeys(id).map((k) => [k, 'Z' + k]))]));
    const n = Object.values(normalizeFrameText(all)).reduce((a, l) => a + Object.keys(l).length, 0);
    expect(n).toBe(EDITABLE_TEXT_FRAMES.reduce((a, id) => a + frameTextKeys(id).length, 0));
    expect(n).toBeLessThanOrEqual(FRAME_TEXT_MAX_LINES);
  });
  it('drops values equal to the built-in text, keeps the rest of the frame', () => {
    expect(ft({ birthday: { 'header.0': 'HAPPY', 'header.1': 'BIRTHDAY', 'footer.0': 'MINE' } })).toEqual({ birthday: { 'footer.0': 'MINE' } });
    expect(ft({ birthday: { 'header.0': 'HAPPY' } })).toEqual({});
  });
  it('keeps an empty string (hidden line)', () => {
    expect(ft({ event: { 'footer.1': '' } })).toEqual({ event: { 'footer.1': '' } });
  });
  it('is idempotent', () => {
    const raw = { birthday: { 'header.0': ' A\u{1F600}  B ', 'footer.0': '', 'footer.1': '{DATE}' }, event: { 'header.1': 'y'.repeat(60) }, junk: 1 };
    const once = normalizeFrameText(raw);
    expect(normalizeFrameText(once)).toEqual(once);
    const m = mergeSettings({ frameText: raw });
    expect(mergeSettings(m).frameText).toEqual(m.frameText);
  });
});
