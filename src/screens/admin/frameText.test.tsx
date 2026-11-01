// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeSettings, type BoothSettings } from '../../config/settings';
import { SECTIONS } from './sections';
import { searchSettings } from './search';
import { FrameTextPanel } from './FrameTextPanel';
import { frameTextEditorStore, frameTextPanel, frameTextPick, isFrameDirty, isFrameTextDirty, validateFrameText, editLine } from './frameTextEditor';
import { EDITABLE_TEXT_FRAMES, frameTextKeys } from '../../frames/frameText';
import { FRAMES } from '../../frames/registry';
import type { AdminCtx } from './types';

const reset = () => { frameTextEditorStore.reset(); frameTextPanel.close(); frameTextPick.set(EDITABLE_TEXT_FRAMES[0]); };
beforeEach(reset);
afterEach(reset);
const noop = () => {};
const ctxFor = (s: BoothSettings): AdminCtx => ({ s, set: () => true, tune: noop, busy: false, testUrl: null, notify: noop, clearNotice: noop, actions: { pair: noop, testPrint: noop, testShare: noop, changePin: noop } });
const framesCard = SECTIONS.find((x) => x.id === 'frames')!.cards.find((c) => c.id === 'frames-visibility')!;
const panel = (id: string, s: BoothSettings = mergeSettings({})) => renderToStaticMarkup(<FrameTextPanel c={ctxFor(s)} frame={FRAMES.find((f) => f.id === id)!} />);
const framesHtml = (s: BoothSettings = mergeSettings({})) => renderToStaticMarkup(<>{framesCard.render(ctxFor(s))}</>);
const ids = (q: string) => searchSettings(SECTIONS, q).map((h) => h.card.id);
const names = FRAMES.filter((f) => (EDITABLE_TEXT_FRAMES as readonly string[]).includes(f.id)).map((f) => f.name);

describe('ADMIN > Frames: frame text', () => {
  it('is no longer its own category: the text editor lives inside Frames', () => {
    expect(SECTIONS.map((x) => x.id)).not.toContain('frameText');
    expect(SECTIONS.flatMap((x) => x.cards.map((c) => c.id)).some((i) => i.startsWith('frametext-'))).toBe(false);
    const all = SECTIONS.flatMap((x) => x.cards.map((c) => c.id));
    expect(new Set(all).size).toBe(all.length);
  });
  it('shows no editor until a frame is tapped; then only that frame\'s editor appears under its group', () => {
    expect(framesHtml()).not.toContain('data-ft-panel');
    frameTextPanel.toggle('birthday');
    const h = framesHtml();
    expect((h.match(/data-ft-panel=/g) ?? []).length).toBe(1);
    expect(h).toContain('data-ft-panel="birthday"');
    expect(h).toContain('data-selected="true"');
    expect((h.match(/data-selected="true"/g) ?? []).length).toBe(1);
    expect(h.indexOf('data-frame-group="receipt"')).toBeLessThan(h.indexOf('data-ft-panel="birthday"'));
    expect(h.indexOf('data-ft-panel="birthday"')).toBeLessThan(h.indexOf('data-frame-group="designs"'));
    frameTextPanel.toggle('birthday'); // tapping the open frame again closes it
    expect(framesHtml()).not.toContain('data-ft-panel');
  });
  it('only the nine editable frames can be tapped; picture frames and Wanted frames cannot', () => {
    const h = framesHtml();
    expect((h.match(/aria-label="EDIT TEXT OF /g) ?? []).length).toBe(EDITABLE_TEXT_FRAMES.length);
    for (const n of names) expect(h).toContain(`aria-label="EDIT TEXT OF ${n.toUpperCase()}"`);
    frameTextPanel.toggle('kawaii'); frameTextPanel.toggle('wanted-bounty');
    expect(frameTextPanel.get()).toBeNull();
    frameTextPanel.toggle('not-a-frame');
    expect(frameTextPanel.get()).toBeNull();
  });
  it('the editor has no frame dropdown: one field per line of the tapped frame, with placeholder, counter, hide and reset, and one live preview', () => {
    for (const id of EDITABLE_TEXT_FRAMES) {
      const h = panel(id);
      expect(h).not.toContain('<select');
      expect(h).not.toContain('FRAME TO EDIT');
      expect((h.match(/data-line=/g) ?? []).length, id).toBe(frameTextKeys(id).length);
      expect((h.match(/<input /g) ?? []).length, id).toBe(frameTextKeys(id).length);
      expect((h.match(/>HIDE LINE</g) ?? []).length, id).toBe(frameTextKeys(id).length);
      expect(h).toContain('0/40');
      expect((h.match(/class="ft-prev"/g) ?? []).length, id).toBe(1);
      expect(h).toContain('RESET THIS FRAME');
      expect(h).toContain('{EVENT} {DATE} {TIME} {YEAR} {SERIAL} {THANKS}');
      expect(h).toContain('>SAVE<');
      expect(h).toContain('CLOSE');
    }
    const b = panel('birthday');
    expect(b).toContain('placeholder="BIRTHDAY"');
    expect(b).toContain('placeholder="MAKE A WISH"');
    expect(panel('graduation')).not.toContain('placeholder="MAKE A WISH"');
  });
  it('shows saved text, a hidden line, and enables RESET only when the frame has saved text', () => {
    const s = mergeSettings({ frameText: { birthday: { 'footer.0': 'GOOD LUCK', 'header.0': '' } } });
    const h = panel('birthday', s);
    expect(h).toContain('value="GOOD LUCK"');
    expect(panel('graduation', s)).not.toContain('GOOD LUCK');
    expect(h).toContain('placeholder="(HIDDEN)"');
    expect(h).toContain('>SHOW LINE<');
    const reset = (x: string) => /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*RESET THIS FRAME/.exec(x)![0];
    expect(reset(h)).not.toMatch(/\sdisabled/);
    expect(reset(panel('birthday'))).toMatch(/\sdisabled/);
  });
  it('marks a tile whose text has unsaved edits (or errors)', () => {
    const s = mergeSettings({});
    expect(framesHtml(s)).not.toContain('UNSAVED TEXT');
    frameTextEditorStore.edit(s, 'couple', 'header.0', 'C');
    expect(framesHtml(s)).toContain('UNSAVED TEXT');
    frameTextEditorStore.edit(s, 'couple', 'header.0', 'x'.repeat(41));
    expect(framesHtml(s)).toContain('FIX TEXT');
  });
  it('the Frames tab carries the unsaved-text marker, and search finds the text editor through the Frames card', () => {
    expect(SECTIONS.find((x) => x.id === 'frames')!.tabs.find((t) => t.id === 'builtin')!.draft).toBe('frameText');
    for (const q of ['birthday', 'footer', 'wording', 'header', 'caption', 'frame text', 'make a wish', 'class of']) expect(ids(q), q).toContain('frames-visibility');
    for (const q of ['wanted', 'bounty', 'straw hat', 'boarding pass']) expect(ids(q).filter((i) => i.startsWith('frametext')), q).toEqual([]);
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
  it('opening another frame keeps every frame\'s unsaved lines, and marks the frames that have some', () => {
    frameTextEditorStore.edit(s, 'couple', 'header.0', 'C');
    frameTextPick.set('event');
    frameTextEditorStore.edit(s, 'event', 'footer.0', 'E');
    expect(frameTextPick.get()).toBe('event');
    expect(frameTextEditorStore.get()).toMatchObject({ couple: { 'header.0': 'C' }, event: { 'footer.0': 'E' } });
    const d = frameTextEditorStore.get();
    expect(isFrameDirty(s, d, 'couple')).toBe(true);
    expect(isFrameDirty(s, d, 'birthday')).toBe(false);
    expect(framesHtml(s)).toContain('UNSAVED TEXT');
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
