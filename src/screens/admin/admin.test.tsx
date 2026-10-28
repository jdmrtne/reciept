import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, type BoothSettings } from '../../config/settings';
import { AdminPanel } from './AdminPanel';
import { SECTIONS } from './sections';
import { FRAMES } from '../../frames/registry';
import { searchSettings } from './search';
import type { AdminCtx } from './types';

const noop = () => {};
const ctxFor = (s: BoothSettings): AdminCtx => ({ s, set: () => true, tune: noop, busy: false, testUrl: null, notify: noop, clearNotice: noop, actions: { pair: noop, testPrint: noop, testShare: noop, changePin: noop } });
const html = (s: BoothSettings) => SECTIONS.flatMap((sec) => sec.cards.map((c) => renderToStaticMarkup(<>{c.render(ctxFor(s))}</>))).join('\n');
const decode = (h: string) => h.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');

describe('settings map', () => {
  it('has unique section ids and unique card ids, and no empty sections', () => {
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
    const cards = SECTIONS.flatMap((s) => s.cards.map((c) => c.id));
    expect(new Set(cards).size).toBe(cards.length);
    for (const s of SECTIONS) expect(s.cards.length, s.id).toBeGreaterThan(0);
  });

  /** The owner guide and docs name these controls; the redesign must not drop or rename any of them. */
  it('still offers every control the old panel had', () => {
    const LEGACY = ['SYSTEM PRINT', 'WINDOWS PRINTER', 'USB (DIRECT)', 'NETWORK', 'BLUETOOTH', 'TEST PRINTER',
      'WINDOWS PRINTER NAME', 'PRINTER IP', 'BRIDGE URL', 'BRIDGE URL (UPLOADS)', 'PUBLIC URL (WHAT PHONES OPEN)', 'SHARE QR',
      'PAPER', 'PRESET', 'DITHER', 'DOT SIZE', 'BRIGHTNESS', 'CONTRAST', 'DENSITY', 'SHARPEN', 'AUTO LEVEL', 'THRESHOLD', 'SIDE MARGIN', 'FEED LINES', 'CUT',
      'BT CHUNK', 'BT DELAY MS', 'CHANGE PIN', 'TEST PRINT', 'PAIR PRINTER', 'CHECK PRINTER', 'CHECK SHARE'];
    const variants = (['windows', 'network', 'bluetooth', 'usb', 'system', 'mock'] as const).flatMap((printer) =>
      [false, true].map((enabled) => mergeSettings({ ...DEFAULT_SETTINGS, printer, share: { enabled, publicBaseUrl: '' }, thermal: { ...DEFAULT_SETTINGS.thermal, dither: 'halftone' } })));
    const all = decode(variants.map(html).join('\n'));
    const missing = LEGACY.filter((l) => !all.includes(l));
    expect(missing).toEqual([]);
  });

  it('shows each setting once per printer type (no duplicate fields on screen)', () => {
    for (const printer of ['windows', 'network'] as const) {
      const h = decode(html(mergeSettings({ ...DEFAULT_SETTINGS, printer, share: { enabled: true, publicBaseUrl: '' } })));
      expect((h.match(/>BRIDGE URL</g) ?? []).length, printer).toBe(1);
    }
    const h = decode(html(mergeSettings({ ...DEFAULT_SETTINGS, printer: 'mock', share: { enabled: true, publicBaseUrl: '' } })));
    expect((h.match(/BRIDGE URL/g) ?? []).length).toBe(1);
  });
});

describe('settings search', () => {
  const find = (q: string) => searchSettings(SECTIONS, q).map((h) => h.card.id);
  it('finds the examples from the brief', () => {
    expect(find('dark mode')).toContain('appearance-theme');
    expect(find('receipt')).toEqual(expect.arrayContaining(['printer-type', 'quality-paper']));
    expect(find('printer')).toContain('printer-type');
    expect(find('user')).toContain('security-pin');
  });
  it('is case-insensitive, matches every word, and ignores extra spaces', () => {
    expect(find('  BRIGHTNESS ')).toEqual(['quality-tone']);
    expect(find('test print')).toEqual(expect.arrayContaining(['printer-test', 'quality-test']));
    expect(find('brightness qr')).toEqual([]);
  });
  it('returns nothing for an empty query or an unknown term (e.g. tax)', () => {
    expect(find('')).toEqual([]);
    expect(find('tax')).toEqual([]);
  });
});

describe('panel shell', () => {
  it('renders every section in the navigation plus search, EXIT and the theme toggle', () => {
    const h = renderToStaticMarkup(<AdminPanel onChangePin={noop} />);
    for (const s of SECTIONS) expect(h).toContain(s.label);
    expect(h).toContain('OWNER SETTINGS');
    expect(h).toContain('EXIT');
    expect(h).toContain('Search settings');
    expect(h).toMatch(/Switch to (dark|light) mode/);
    expect(h).toContain('AUTO-SAVE ON');
  });
  it('can open on a given section (used after CHANGE PIN)', () => {
    expect(renderToStaticMarkup(<AdminPanel onChangePin={noop} initialSection="security" />)).toContain('OWNER PIN');
  });
});

describe('layouts section', () => {
  const card = SECTIONS.find((s) => s.id === 'layouts')!.cards[0];
  const render = (hidden: string[]) => decode(renderToStaticMarkup(<>{card.render({ ...ctxFor(mergeSettings({ layoutVisibility: { hidden } })) })}</>));
  it('is in the map, searchable, and listed after Events', () => {
    expect(SECTIONS.map((s) => s.id).slice(0, 2)).toEqual(['events', 'layouts']);
    expect(searchSettings(SECTIONS, 'choose your strip').map((h) => h.card.id)).toContain('layouts-visibility');
    expect(searchSettings(SECTIONS, 'hide layout').map((h) => h.card.id)).toContain('layouts-visibility');
  });
  it('has one switch per layout plus a whole-group switch, with photo counts and a preview each', () => {
    const h = render([]);
    expect((h.match(/role="switch"/g) ?? []).length).toBe(11);
    expect(h).toContain('SHOW WHOLE GROUP JLC 20TH ANNIV. SPECIAL');
    for (const n of ['SINGLE', 'TWO STRIP', 'THREE STRIP', 'FOUR STRIP', '2 × 2', 'CLASSIC', 'NCL PASS 1', 'NCL PASS 4']) expect(h).toContain(`aria-label="SHOW ${n}"`);
    expect(h).toContain('4 PHOTOS');
    expect((h.match(/data-sample-qr/g) ?? []).length).toBe(11); // six ordinary + the group's own preview + four passes
  });
  it('reflects hidden layouts, and offers SHOW ALL only when something is hidden', () => {
    expect(render(['single'])).toMatch(/aria-checked="false"[^>]*aria-label="SHOW SINGLE"/);
    expect(render([])).toMatch(/<button[^>]*disabled=""[^>]*>SHOW ALL/);
    expect(render(['single'])).not.toMatch(/<button[^>]*disabled=""[^>]*>SHOW ALL/);
  });
  it('locks the last visible layout and explains why', () => {
    const h = render(['single', 'strip-2', 'strip-3', 'strip-4', 'grid-2x2', 'pass-1', 'pass-2', 'pass-3', 'pass-4']); // only classic shown
    expect(h).toMatch(/aria-label="SHOW CLASSIC"[^>]*disabled=""|disabled=""[^>]*aria-label="SHOW CLASSIC"/);
    expect(h).toContain('At least one layout must stay shown');
  });
});

describe('frames section', () => {
  const sec = SECTIONS.find((s) => s.id === 'frames')!, card = sec.cards[0];
  const render = (hidden: string[]) => decode(renderToStaticMarkup(<>{card.render(ctxFor(mergeSettings({ frameVisibility: { hidden } })))}</>));
  const STD = FRAMES.filter((f) => !f.onlyLayouts);
  it('is in the map right after Layouts and is searchable', () => {
    expect(SECTIONS.map((s) => s.id).slice(0, 3)).toEqual(['events', 'layouts', 'frames']);
    expect(searchSettings(SECTIONS, 'frame design').map((h) => h.card.id)).toContain('frames-visibility');
    expect(searchSettings(SECTIONS, 'hide border').map((h) => h.card.id)).toContain('frames-visibility');
    expect(searchSettings(SECTIONS, 'kawaii cats').map((h) => h.card.id)).toContain('frames-visibility');
  });
  it('one switch per standard frame (two groups), a preview each, and the NCL frame is not listed but explained', () => {
    const h = render([]);
    expect((h.match(/role="switch"/g) ?? []).length).toBe(STD.length);
    for (const f of STD) expect(h).toContain(`aria-label="SHOW FRAME ${f.name.toUpperCase()}"`);
    expect(h).not.toContain('NCL BOARDING PASS');
    expect(h).toContain('JLC NCL Boarding Pass frame is not listed');
    expect(h).toContain('RECEIPT STYLES');
    expect(h).toContain('DESIGNS');
  });
  it('lays the frames out as a grid of tiles (thumbnail, name, switch) and dims a hidden one', () => {
    const h = render(['event']);
    expect((h.match(/class="fg-grid"/g) ?? []).length).toBe(2);
    expect((h.match(/class="fg-tile"/g) ?? []).length).toBe(STD.length);
    expect((h.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(STD.length);
    expect((h.match(/data-shown="false"/g) ?? []).length).toBe(1);
    expect(h).not.toContain('lv-flat');
  });
  it('reflects hidden frames and enables SHOW ALL FRAMES only when something is hidden', () => {
    expect(render(['event'])).toMatch(/aria-checked="false"[^>]*aria-label="SHOW FRAME EVENT"/);
    expect(render([])).toMatch(/<button[^>]*disabled=""[^>]*>SHOW ALL FRAMES/);
    expect(render(['event'])).not.toMatch(/<button[^>]*disabled=""[^>]*>SHOW ALL FRAMES/);
  });
  it('locks the last visible frame and explains why', () => {
    const h = render(STD.slice(1).map((f) => f.id));
    expect(h).toMatch(new RegExp(`aria-label="SHOW FRAME ${STD[0].name.toUpperCase()}"[^>]*disabled=""|disabled=""[^>]*aria-label="SHOW FRAME ${STD[0].name.toUpperCase()}"`));
    expect(h).toContain('At least one frame must stay shown');
  });
  it('group HIDE ALL is disabled when it would hide the last visible frames; group SHOW ALL needs something hidden in it', () => {
    const designs = STD.filter((f) => f.type === 'image').map((f) => f.id);
    const onlyReceiptShown = render(designs); // every image frame hidden
    expect(onlyReceiptShown).toMatch(/disabled=""[^>]*aria-label="HIDE ALL RECEIPT STYLES"|aria-label="HIDE ALL RECEIPT STYLES"[^>]*disabled=""/);
    expect(onlyReceiptShown).not.toMatch(/disabled=""[^>]*aria-label="SHOW ALL DESIGNS"|aria-label="SHOW ALL DESIGNS"[^>]*disabled=""/);
    const none = render([]);
    expect(none).toMatch(/disabled=""[^>]*aria-label="SHOW ALL DESIGNS"|aria-label="SHOW ALL DESIGNS"[^>]*disabled=""/);
    expect(none).not.toMatch(/disabled=""[^>]*aria-label="HIDE ALL DESIGNS"|aria-label="HIDE ALL DESIGNS"[^>]*disabled=""/);
  });
});

describe('standby photo card', () => {
  const find = (q: string) => searchSettings(SECTIONS, q).map((h) => h.card.id);
  it('is found by plain-language search', () => {
    for (const q of ['wallpaper', 'standby', 'background', 'home screen', 'upload photo']) expect(find(q), q).toContain('appearance-standby');
  });
  const card = SECTIONS.flatMap((s) => s.cards).find((c) => c.id === 'appearance-standby')!;
  const show = (s: BoothSettings) => decode(renderToStaticMarkup(<>{card.render(ctxFor(s))}</>));
  it('with no photo: offers UPLOAD PHOTO only, and the fit/receipt controls are disabled', () => {
    const h = show(DEFAULT_SETTINGS);
    expect(h).toContain('UPLOAD PHOTO');
    expect(h).not.toContain('REMOVE PHOTO');
    expect(h).not.toContain('Current standby photo');
    expect(h).toContain('SHOW RECEIPT OVER PHOTO');
  });
  it('with a photo: offers CHANGE PHOTO and REMOVE PHOTO', () => {
    const h = show(mergeSettings({ standbyPhoto: { enabled: true, fit: 'contain', showReceipt: false, version: 2 } }));
    expect(h).toContain('CHANGE PHOTO');
    expect(h).toContain('REMOVE PHOTO');
    expect(h).toContain('COVER');
    expect(h).toContain('CONTAIN');
  });
});
