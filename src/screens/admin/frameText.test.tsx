// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeSettings, type BoothSettings } from '../../config/settings';
import { SECTIONS } from './sections';
import { searchSettings } from './search';
import { frameTextEditorStore, frameTextPick, isFrameDirty, isFrameTextDirty, validateFrameText, editLine } from './frameTextEditor';
import { EDITABLE_TEXT_FRAMES, frameTextKeys } from '../../frames/frameText';
import { FRAMES } from '../../frames/registry';
import type { AdminCtx } from './types';

const reset = () => { frameTextEditorStore.reset(); frameTextPick.set(EDITABLE_TEXT_FRAMES[0]); };
beforeEach(reset);
afterEach(reset);
const noop = () => {};
const ctxFor = (s: BoothSettings): AdminCtx => ({ s, set: () => true, tune: noop, busy: false, testUrl: null, notify: noop, clearNotice: noop, actions: { pair: noop, testPrint: noop, testShare: noop, changePin: noop } });
const section = SECTIONS.find((x) => x.id === 'frameText')!;
const card = (cid: string, s: BoothSettings) => renderToStaticMarkup(<>{section.cards.find((c) => c.id === cid)!.render(ctxFor(s))}</>);
/** The editor + preview cards as shown with `id` picked in the dropdown. */
const html = (id: string, s = mergeSettings({})) => { frameTextPick.set(id); return card('frametext-edit', s) + card('frametext-preview', s); };
const ids = (q: string) => searchSettings(SECTIONS, q).map((h) => h.card.id).filter((i) => i.startsWith('frametext-'));
const names = FRAMES.filter((f) => (EDITABLE_TEXT_FRAMES as readonly string[]).includes(f.id)).map((f) => f.name);

describe('ADMIN > Frame text', () => {
  it('sits right after Frames, as one editor card plus a preview card (not one card per frame)', () => {
    const order = SECTIONS.map((x) => x.id);
    expect(order[order.indexOf('frames') + 1]).toBe('frameText');
    expect(section.cards.map((c) => c.id)).toEqual(['frametext-edit', 'frametext-preview']);
    expect(section.cards.find((c) => c.id === 'frametext-preview')!.aside).toBe(true);
    const all = SECTIONS.flatMap((x) => x.cards.map((c) => c.id));
    expect(new Set(all).size).toBe(all.length);
  });
  it('has a dropdown with every editable frame, selected by default on the first one', () => {
    const h = card('frametext-edit', mergeSettings({}));
    expect(h).toContain('FRAME TO EDIT');
    expect((h.match(/<option /g) ?? []).length).toBe(EDITABLE_TEXT_FRAMES.length);
    for (const n of names) expect(h).toContain(`>${n}<`);
    expect((h.match(/data-line=/g) ?? []).length).toBe(frameTextKeys(EDITABLE_TEXT_FRAMES[0]).length);
  });
  it('shows only the chosen frame\'s lines and a live preview of it, one field per line with placeholder + counter, hide and reset', () => {
    for (const id of EDITABLE_TEXT_FRAMES) {
      const h = html(id);
      expect((h.match(/data-line=/g) ?? []).length, id).toBe(frameTextKeys(id).length);
      expect((h.match(/<input /g) ?? []).length, id).toBe(frameTextKeys(id).length);
      expect((h.match(/>HIDE LINE</g) ?? []).length, id).toBe(frameTextKeys(id).length);
      expect(h).toContain('0/40');
      expect(h).toContain('<svg');
      expect((h.match(/<svg/g) ?? []).length, id).toBe(1);
      expect(h).toContain('RESET THIS FRAME');
      expect(h).toContain('{EVENT} {DATE} {TIME} {YEAR} {SERIAL} {THANKS}');
    }
    const b = html('birthday');
    expect(b).toContain('placeholder="BIRTHDAY"');
    expect(b).toContain('placeholder="MAKE A WISH"');
    expect(b).toMatch(/BIRTHDAY<\/span>|HEADER LINE 2/);
    expect(html('graduation')).not.toContain('placeholder="MAKE A WISH"');
  });
  it('shows saved text, a hidden line, and enables RESET only when the frame has saved text', () => {
    const s = mergeSettings({ frameText: { birthday: { 'footer.0': 'GOOD LUCK', 'header.0': '' } } });
    const h = html('birthday', s);
    expect(h).toContain('value="GOOD LUCK"');
    expect(html('graduation', s)).not.toContain('GOOD LUCK');
    expect(h).toContain('placeholder="(HIDDEN)"');
    expect(h).toContain('>SHOW LINE<');
    const reset = (x: string) => /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*RESET THIS FRAME/.exec(x)![0];
    expect(reset(h)).not.toMatch(/\sdisabled/);
    expect(reset(html('birthday'))).toMatch(/\sdisabled/);
  });
  it('is searchable by the words an owner would use, and never lists non-editable frames', () => {
    expect(ids('birthday')).toEqual(['frametext-edit']);
    for (const q of ['footer', 'wording', 'header', 'caption', 'title', 'frame text']) expect(ids(q), q).toEqual(['frametext-edit']);
    expect(ids('make a wish')).toEqual(['frametext-edit']);
    expect(ids('class of')).toEqual(['frametext-edit']);
    expect(ids('preview')).toContain('frametext-preview');
    for (const q of ['wanted', 'bounty', 'straw hat', 'kawaii', 'boarding pass', 'manga']) expect(ids(q), q).toEqual([]);
  });
});

describe('frame text draft', () => {
  const s = mergeSettings({});
  it('edits stay in a draft until SAVE, and typing back to the saved value makes it clean', () => {
    frameTextEditorStore.edit(s, 'event', 'footer.0', 'X');
    expect(isFrameTextDirty(s, frameTextEditorStore.get())).toBe(true);
    expect(s.frameText).toEqual({});
    frameTextEditorStore.edit(s, 'event', 'footer.0', undefined);
    expect(frameTextEditorStore.get()).toBeNull();
  });
  it('SAVE persists trimmed text (blank = hidden) and clears the draft; a refused write keeps it', () => {
    frameTextEditorStore.edit(s, 'event', 'header.1', '  OUR NIGHT ');
    frameTextEditorStore.edit(s, 'event', 'footer.0', '');
    expect(frameTextEditorStore.commit(s, () => false)).toBe('failed');
    expect(frameTextEditorStore.get()).not.toBeNull();
    let saved: unknown;
    expect(frameTextEditorStore.commit(s, (ft) => { saved = ft; return true; })).toBe('saved');
    expect(saved).toEqual({ event: { 'header.1': 'OUR NIGHT', 'footer.0': '' } });
    expect(frameTextEditorStore.get()).toBeNull();
    expect(frameTextEditorStore.commit(s, () => true)).toBe('unchanged');
  });
  it('unsupported characters and too-long lines block SAVE with the event editor wording', () => {
    const d = editLine(s, editLine(s, null, 'event', 'header.0', 'HI \u{1F600}'), 'event', 'header.1', 'x'.repeat(41));
    const e = validateFrameText(d!);
    expect(e['event/header.0']).toMatch(/^CANNOT BE PRINTED/);
    expect(e['event/header.1']).toMatch(/^TOO LONG: 41 OF 40/);
    frameTextEditorStore.edit(s, 'event', 'header.0', 'HI \u{1F600}');
    expect(frameTextEditorStore.commit(s, () => true)).toBe('invalid');
  });
  it('switching frames in the dropdown keeps every frame\'s unsaved lines, and marks the frames that have some', () => {
    frameTextEditorStore.edit(s, 'couple', 'header.0', 'C');
    frameTextPick.set('event');
    frameTextEditorStore.edit(s, 'event', 'footer.0', 'E');
    expect(frameTextPick.get()).toBe('event');
    expect(frameTextEditorStore.get()).toMatchObject({ couple: { 'header.0': 'C' }, event: { 'footer.0': 'E' } });
    const d = frameTextEditorStore.get();
    expect(isFrameDirty(s, d, 'couple')).toBe(true);
    expect(isFrameDirty(s, d, 'birthday')).toBe(false);
    expect(card('frametext-edit', s)).toContain('(UNSAVED)');
    frameTextPick.set('not-a-frame');
    expect(frameTextPick.get()).toBe('event');
  });
  it('RESET THIS FRAME saves right away and leaves other frames\' unsaved edits alone', () => {
    const saved = mergeSettings({ frameText: { birthday: { 'footer.0': 'A' }, event: { 'footer.0': 'B' } } });
    frameTextEditorStore.edit(saved, 'couple', 'header.0', 'C');
    let out: unknown;
    expect(frameTextEditorStore.resetFrame(saved, 'birthday', (ft) => { out = ft; return true; })).toBe(true);
    expect(out).toEqual({ event: { 'footer.0': 'B' } });
    expect(frameTextEditorStore.get()).toMatchObject({ couple: { 'header.0': 'C' } });
  });
});
