// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from '../../frames/custom/fakeIdb';
import * as store from '../../frames/custom/store';
import * as ev from '../../frames/custom/eventRuntime';
import { replaceEventLayoutArt, type ReplaceEventLayoutDeps } from '../../frames/custom/replaceEventLayout';
import { addEventProfile, mergeSettings, updateEventProfile, type BoothSettings } from '../../config/settings';
import type { CustomLayoutArt } from '../../frames/custom/types';
import * as rt from '../../frames/custom/runtime';
import { eventLayoutsCard } from './EventLayoutsSection';
import { eventsSection } from './EventSection';
import { eventEditorStore } from './eventEditor';
import { searchSettings } from './search';
import type { AdminCtx } from './types';

const noop = () => {};
const ctxFor = (s: BoothSettings): AdminCtx => ({ s, set: () => true, tune: noop, busy: false, testUrl: null, notify: noop, clearNotice: noop, actions: { pair: noop, testPrint: noop, testShare: noop, changePin: noop } });
const page = (s: BoothSettings) => renderToStaticMarkup(<>{eventLayoutsCard.render(ctxFor(s))}</>);
const two = (): BoothSettings => addEventProfile(updateEventProfile(mergeSettings({}), 'event-1', { name: 'WEDDING' }), { name: 'BIRTHDAY' }, false);
const art = (windows = 1): CustomLayoutArt => ({ blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152, windows: [{ x: 100, y: 100, w: 900, h: 400 }], slots: Array.from({ length: windows }, (_, i) => ({ x: 0.08, y: 0.08 + i * 0.3, w: 0.84, h: 0.25 })) });
const mk = async (name: string, eventId: string, windows = 1) => { const r = await ev.createEventLayoutRecord({ name, eventId, art: art(windows) }); if (!r.ok) throw new Error('create'); return r.value.id; };
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const button = (html: string, label: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((x) => x[0]).find((b) => b.replace(/<[^>]+>/g, '').includes(label)) ?? '';
const tiles = (html: string) => [...html.matchAll(/data-event-layout="([^"]+)"/g)].map((m) => m[1]);

let n = 0;
beforeEach(() => {
  (globalThis as any).indexedDB = new FakeIndexedDB(); store.resetStore(); ev.resetEventRuntime(); eventEditorStore.reset(); n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${++n}`); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); ev.resetEventRuntime(); eventEditorStore.reset(); delete (globalThis as any).indexedDB; });

describe('Event layouts card (server render)', () => {
  it('shows a loading note first, and a plain message when this browser cannot store layouts', async () => {
    expect(text(page(two()))).toContain('Loading your layouts.');
    delete (globalThis as any).indexedDB; store.resetStore(); ev.resetEventRuntime();
    await ev.initEventLayouts();
    expect(text(page(two()))).toContain('not available in this browser');
  });

  it('an event with no layouts says so and offers ADD LAYOUT', async () => {
    await ev.initEventLayouts();
    const html = page(two());
    expect(text(html)).toContain('No layouts in this event yet. Press ADD LAYOUT.');
    expect(button(html, 'ADD LAYOUT')).not.toBe('');
    expect(html).toContain('EVENT LAYOUTS: WEDDING');
    expect(html).not.toContain('data-unassigned-layouts');
  });

  it('lists only the layouts of the picked event, with thumbnail, name, photo count and a SHOWN switch', async () => {
    const a = await mk('Dance floor', 'event-1', 3), b = await mk('Cake', 'event-1', 1), c = await mk('Candles', 'event-2');
    await ev.initEventLayouts();
    const html = page(two());
    expect(tiles(html)).toEqual([a, b]);
    expect(html).not.toContain(c);
    expect(html).toContain('lay-svg'); // the FramePreview thumbnail
    expect(text(html)).toContain('DANCE FLOOR');
    expect(text(html)).toContain('3 PHOTOS');
    expect(text(html)).toContain('1 PHOTO ');
    const sw = button(html, 'SHOWN');
    expect(sw).toContain('aria-checked="true"');
    expect(sw).toContain('SHOW LAYOUT DANCE FLOOR');
    for (const l of ['RENAME', 'MOVE', 'DELETE']) expect(button(html, l), l).not.toBe('');
    expect(html).toContain('aria-label="REPLACE PICTURE OF DANCE FLOOR"'); // a file picker inside a label button
    eventEditorStore.select('event-2');
    expect(tiles(page(two()))).toEqual([c]);
  });

  it('a layout switched off is drawn as hidden and its switch is off', async () => {
    const a = await mk('Dance floor', 'event-1');
    await ev.initEventLayouts();
    await ev.setEventLayoutRecordEnabled(a, false);
    const html = page(two());
    expect(html).toContain('data-shown="false"');
    expect(button(html, 'HIDDEN')).toContain('aria-checked="false"');
    expect(button(html, 'SHOW ALL')).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(button(html, 'HIDE ALL')).toMatch(/\sdisabled(=|\s|>)/); // nothing left to hide
  });

  it('layouts whose event is gone or empty are listed as unassigned, with a way to give them an event', async () => {
    const kept = await mk('Dance floor', 'event-1'), gone = await mk('Old party', 'event-gone'), none = await mk('Loose', 'event-1');
    await ev.initEventLayouts();
    await ev.setEventLayoutRecordEvent(none, ''); // an empty event id means no event
    const html = page(two());
    expect(html).toContain('data-unassigned-layouts="true"');
    expect([...html.matchAll(/data-unassigned-layout="([^"]+)"/g)].map((m) => m[1])).toEqual([gone, none]);
    expect(tiles(html)).toEqual([kept]);
    expect(button(html, 'ASSIGN')).not.toBe('');
    expect(html).toContain('aria-label="EVENT FOR OLD PARTY"');
    expect(html).toMatch(/<option value="event-1"[^>]*>WEDDING<\/option>/); // defaults to the event picked above
  });

  it('the visible text has no emojis and no dashes', async () => {
    await mk('Dance floor', 'event-1', 2); await mk('Old party', 'event-gone');
    await ev.initEventLayouts();
    const t = text(page(two()));
    expect(t).not.toMatch(/[\u2010-\u2015\u2212]/);
    expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(t).not.toMatch(/\s-\s/);
  });
});

describe('Event layouts card wiring', () => {
  it('is the third card of ADMIN > Events, on the uploads tab, and found by the words an owner would type', () => {
    expect(eventsSection.cards.map((c) => c.id)).toEqual(['events-list', 'events-frames', 'events-layouts', 'events-edit', 'events-preview']);
    expect(eventLayoutsCard.tab).toBe('uploads');
    const find = (q: string) => searchSettings([eventsSection], q).map((h) => h.card.id);
    for (const q of ['event layouts', 'add layout', 'replace picture', 'unassigned', 'event special']) expect(find(q), q).toContain('events-layouts');
  });
});

describe('REPLACE PICTURE (replaceEventLayoutArt)', () => {
  const prep = (r: unknown) => ({ prepare: async () => r, setArt: ev.setEventLayoutRecordArt, byId: ev.eventLayoutById }) as unknown as ReplaceEventLayoutDeps;
  const file = new Blob(['png'], { type: 'image/png' });

  it('needs a picture and an existing layout, and changes nothing otherwise', async () => {
    const id = await mk('Dance floor', 'event-1'); await ev.initEventLayouts();
    expect(await replaceEventLayoutArt(id, null)).toEqual({ ok: false, errors: ['Choose a picture for the layout.'] });
    expect(await replaceEventLayoutArt('evl-nope', file)).toEqual({ ok: false, errors: ['That layout no longer exists.'] });
  });

  it('a picture that fails the check leaves the stored layout exactly as it was', async () => {
    const id = await mk('Dance floor', 'event-1', 2); await ev.initEventLayouts();
    const before = ev.eventLayoutById(id)!.art;
    const r = await replaceEventLayoutArt(id, file, prep({ ok: false, errors: ['No photo windows were found.'] }));
    expect(r).toEqual({ ok: false, errors: ['No photo windows were found.'] });
    expect(ev.eventLayoutById(id)!.art).toBe(before);
  });

  it('a good picture replaces the art and windows, keeps name, event and switch, and drops the QR spot with a note', async () => {
    const id = await mk('Dance floor', 'event-1', 2); await ev.initEventLayouts();
    await ev.setEventLayoutRecordQr(id, { x: 0.5, y: 0.8, w: 0.2, h: 0.1 }); await ev.setEventLayoutRecordEnabled(id, false);
    const rev = ev.eventLayoutById(id)!.art.rev;
    const r = await replaceEventLayoutArt(id, file, prep({ ok: true, art: art(4), warnings: ['One transparent area touches the edge of the image and is ignored.'] }));
    expect(r).toEqual({ ok: true, windows: 4, hadQrSpot: true, warnings: ['One transparent area touches the edge of the image and is ignored.'] });
    const d = ev.eventLayoutById(id)!;
    expect(d).toMatchObject({ name: 'Dance floor', eventId: 'event-1', enabled: false });
    expect(d.art.slots).toHaveLength(4);
    expect(d.art.qr).toBeUndefined();
    expect(d.art.rev).not.toBe(rev);
  });

  it('without a saved QR spot there is nothing to report, and a storage failure comes back as a plain sentence', async () => {
    const id = await mk('Dance floor', 'event-1'); await ev.initEventLayouts();
    const ok = await replaceEventLayoutArt(id, file, prep({ ok: true, art: art(2), warnings: [] }));
    expect(ok).toMatchObject({ ok: true, hadQrSpot: false, windows: 2 });
    const failing = { prepare: async () => ({ ok: true, art: art(), warnings: [] }), setArt: async () => ({ ok: false, reason: 'quota', message: store.MESSAGES.quota }), byId: ev.eventLayoutById } as unknown as ReplaceEventLayoutDeps;
    expect(await replaceEventLayoutArt(id, file, failing)).toEqual({ ok: false, errors: [store.MESSAGES.quota] });
    const throwing = { prepare: async () => { throw new Error('boom'); }, setArt: ev.setEventLayoutRecordArt, byId: ev.eventLayoutById } as unknown as ReplaceEventLayoutDeps;
    expect(await replaceEventLayoutArt(id, file, throwing)).toEqual({ ok: false, errors: ['The picture could not be saved. Please try again.'] });
  });
});

describe('QR spot of an event layout (EL-5, server render)', () => {
  it('each tile says whether a QR spot is set and offers a QR SPOT button, closed by default', async () => {
    const a = await mk('Dance floor', 'event-1', 2), b = await mk('Cake table', 'event-1');
    await ev.initEventLayouts(); await ev.setEventLayoutRecordQr(a, { x: 0.5, y: 0.8, w: 0.2, h: 0.1 });
    const html = page(two());
    expect(html).toContain(`data-layout-qr="set"`); expect(html).toContain(`data-layout-qr="none"`);
    expect(text(html)).toContain('QR SPOT SET'); expect(text(html)).toContain('NO QR SPOT');
    expect(html).toContain('aria-label="QR SPOT OF DANCE FLOOR"'); expect(html).toContain('aria-label="QR SPOT OF CAKE TABLE"');
    expect(html).not.toContain('data-qr-editor');
    expect(b).toBeTruthy();
  });
  it('is found by the words an owner would use', () => {
    for (const q of ['qr spot', 'draw spot', 'find empty space', 'clear spot']) expect(eventLayoutsCard.keywords).toContain(q);
    const desc = eventLayoutsCard.description ?? '';
    expect(text(desc)).toContain('QR code');
    expect(/[\u2013\u2014]/.test(desc)).toBe(false);
  });
});

describe('Old event frames in the Event layouts card (EL-6, server render)', () => {
  it('shows no block when there are no old event frames', async () => {
    await ev.initEventLayouts(); await rt.initCustomFrames();
    await mk('Dance floor', 'event-1');
    expect(page(two())).not.toContain('data-old-event-frames');
  });
  it('lists the old special frames of the picked event with a COPY TO LAYOUTS button and the count', async () => {
    await ev.initEventLayouts(); await rt.initCustomFrames();
    const f = await rt.createCustomFrame('Gala', true, 'event-1'); if (!f.ok) throw new Error('frame');
    await rt.setCustomLayoutArt(f.value.id, 'single', art(1)); await rt.setCustomLayoutArt(f.value.id, 'strip-3', art(3));
    const html = page(two());
    expect(html).toContain('data-old-event-frames'); expect(html).toContain(`data-old-frame="${f.value.id}"`);
    expect(text(html)).toContain('2 PICTURES, 0 ALREADY COPIED');
    expect(button(html, 'COPY TO LAYOUTS')).not.toContain('disabled');
    expect(text(html)).toContain('leaves the frame untouched');
    expect(page(addEventProfile(two(), { name: 'THIRD' }, false))).toContain('data-old-event-frames'); // still the picked event (event-1)
    rt.resetCustomRuntime();
  });
});
