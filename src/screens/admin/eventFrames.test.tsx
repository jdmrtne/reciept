// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from '../../frames/custom/fakeIdb';
import * as store from '../../frames/custom/store';
import * as rt from '../../frames/custom/runtime';
import type { CustomLayoutArt, CustomLayoutId } from '../../frames/custom/types';
import { guestFramesForLayout } from '../../frames/visibility';
import { addEventProfile, mergeSettings, setActiveEvent, updateEventProfile, type BoothSettings } from '../../config/settings';
import { eventFramesCard } from './EventFramesSection';
import { deleteBody } from './EventSection';
import { eventEditorStore } from './eventEditor';
import type { AdminCtx } from './types';

const noop = () => {};
const ctxFor = (s: BoothSettings): AdminCtx => ({ s, set: () => true, tune: noop, busy: false, testUrl: null, notify: noop, clearNotice: noop, actions: { pair: noop, testPrint: noop, testShare: noop, changePin: noop } });
const group = (s: BoothSettings) => renderToStaticMarkup(<>{eventFramesCard.render(ctxFor(s))}</>);
const two = (): BoothSettings => addEventProfile(updateEventProfile(mergeSettings({}), 'event-1', { name: 'WEDDING' }), { name: 'BIRTHDAY' }, false); // event-1 WEDDING active, event-2 BIRTHDAY
const art = (): CustomLayoutArt => ({ blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152, windows: [{ x: 100, y: 100, w: 900, h: 400 }], slots: [{ x: 0.08, y: 0.08, w: 0.84, h: 0.35 }] });
const mk = async (name: string, eventId: string | undefined, layouts: CustomLayoutId[] = ['single'], special = true) => {
  const r = await rt.createCustomFrame(name, special, eventId); if (!r.ok) throw new Error('create');
  for (const l of layouts) await rt.setCustomLayoutArt(r.value.id, l, art());
  return r.value.id;
};
const button = (html: string, label: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((x) => x[0]).find((b) => b.replace(/<[^>]+>/g, '').includes(label)) ?? '';
const isDisabled = (html: string, label: string) => { const b = button(html, label); expect(b, `button "${label}"`).not.toBe(''); return /\sdisabled(=|\s|>)/.test(b); };

let n = 0;
beforeEach(() => {
  (globalThis as any).indexedDB = new FakeIndexedDB(); store.resetStore(); rt.resetCustomRuntime(); eventEditorStore.reset(); n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${++n}`); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  Object.defineProperty(globalThis, 'navigator', { value: { storage: { persist: async () => true, persisted: async () => false } }, configurable: true });
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); rt.resetCustomRuntime(); eventEditorStore.reset(); delete (globalThis as any).indexedDB; });

describe('Event frames card: the frame group of the selected event', () => {
  it('shows a loading note before the registry loads, and a plain message when this browser cannot store frames', async () => {
    expect(group(two())).toContain('Loading your frames');
    delete (globalThis as any).indexedDB; store.resetStore(); rt.resetCustomRuntime();
    await rt.initCustomFrames();
    const h = group(two());
    expect(h).toContain(store.MESSAGES.unavailable);
    expect(h).not.toContain('ADD FRAME');
  });

  it('an empty group says so, offers ADD FRAME, and has nothing to show or hide', async () => {
    await rt.initCustomFrames();
    const h = group(two());
    expect(h).toContain('FRAME GROUP: WEDDING');
    expect(h).toContain('No frames in this event yet. Press ADD FRAME.');
    expect(isDisabled(h, 'ADD FRAME')).toBe(false);
    expect(isDisabled(h, 'SHOW ALL')).toBe(true); expect(isDisabled(h, 'HIDE ALL')).toBe(true);
    expect(h).not.toContain('data-unassigned-frames');
    expect(h).not.toContain('data-add-panel'); // the panel opens only on ADD FRAME
  });

  it('frames of event A never appear in the grid of event B, and selecting another event switches the grid', async () => {
    await rt.initCustomFrames();
    await mk('Rings', 'event-1'); await mk('Cake', 'event-2'); await mk('Toast', 'event-2');
    const s = two();
    let h = group(s);
    expect(h).toContain('FRAME GROUP: WEDDING'); expect(h).toContain('RINGS'); expect(h).not.toContain('CAKE'); expect(h).not.toContain('TOAST');
    eventEditorStore.select('event-2');
    h = group(s);
    expect(h).toContain('FRAME GROUP: BIRTHDAY'); expect(h).toContain('CAKE'); expect(h).toContain('TOAST'); expect(h).not.toContain('RINGS');
    expect((h.match(/data-event-frame=/g) ?? []).length).toBe(2);
  });

  it('is the same grid as ADMIN > Frames: a tile per frame with thumbnail, name and a SHOWN / HIDDEN switch; hidden tiles are marked', async () => {
    await rt.initCustomFrames();
    const a = await mk('Rings', 'event-1', ['strip-3', 'single']), b = await mk('Vows', 'event-1');
    await rt.setCustomEnabled(b, false);
    const h = group(two());
    for (const c of ['fg-grid', 'fg-tile', 'fg-thumb', 'fg-name', 'switch']) expect(h, c).toContain(c);
    expect(h).toContain(`data-event-frame="${a}"`);
    expect(h).toMatch(/data-shown="true"[^>]*data-event-frame="custom-[a-z0-9]+"/);
    expect(h).toMatch(/data-shown="false"[^>]*data-event-frame/);
    expect(h).toMatch(/aria-checked="true"[^>]*aria-label="SHOW FRAME RINGS"/);
    expect(h).toMatch(/aria-checked="false"[^>]*aria-label="SHOW FRAME VOWS"/);
    expect(h).toContain('<b>SHOWN</b>'); expect(h).toContain('<b>HIDDEN</b>');
    expect(h).toContain('aria-label="EDIT FRAME RINGS"'); // tapping the thumbnail or the name opens the editor
    expect((h.match(/<svg[^>]*class="lay-svg"/g) ?? []).length).toBe(2); // a real FramePreview per tile
  });

  it('the header counts the frames and SHOW ALL / HIDE ALL follow what is shown', async () => {
    await rt.initCustomFrames();
    const a = await mk('A', 'event-1'), b = await mk('B', 'event-1');
    let h = group(two());
    expect(h).toMatch(/FRAME GROUP: WEDDING <small>2<\/small>/);
    expect(isDisabled(h, 'SHOW ALL')).toBe(true); expect(isDisabled(h, 'HIDE ALL')).toBe(false); // all shown
    await rt.setCustomEnabled(a, false); await rt.setCustomEnabled(b, false);
    h = group(two());
    expect(isDisabled(h, 'SHOW ALL')).toBe(false); expect(isDisabled(h, 'HIDE ALL')).toBe(true); // all hidden: no "last visible frame" lock, built-in frames always exist
  });

  it('a frame with no pictures yet still has a tile (so it can be opened and deleted)', async () => {
    await rt.initCustomFrames();
    await mk('Blank', 'event-1', []);
    expect(group(two())).toContain('NO PICTURES');
  });

  it('says that a frame is offered when it is SHOWN, whichever event is active', async () => {
    await rt.initCustomFrames();
    expect(group(two())).toContain('A frame is offered to guests when it is SHOWN, whichever event is active.');
  });

  it('lists old special frames (no event, or an event that was deleted) under UNASSIGNED FRAMES with MOVE TO THIS EVENT; never normal frames or assigned ones', async () => {
    await rt.initCustomFrames();
    const old = await mk('From Before', undefined), orphan = await mk('Orphan', 'event-77'), own = await mk('Own Frame', undefined, ['single'], false), mine = await mk('Mine', 'event-1');
    const h = group(two());
    expect(h).toContain('data-unassigned-frames');
    expect(h).toContain(`data-unassigned-frame="${old}"`); expect(h).toContain(`data-unassigned-frame="${orphan}"`);
    expect(h).not.toContain(`data-unassigned-frame="${own}"`); expect(h).not.toContain(`data-unassigned-frame="${mine}"`);
    expect(h).toContain('aria-label="MOVE FROM BEFORE TO THIS EVENT"');
    expect(h).toContain('UNASSIGNED FRAMES <small>2</small>');
    expect(h).not.toContain('OWN FRAME');
    expect((h.match(/data-event-frame=/g) ?? []).length).toBe(1); // only MINE is a tile of this group; unassigned frames are rows, not tiles
  });

  it('shows no UNASSIGNED block when every special frame has its event', async () => {
    await rt.initCustomFrames();
    await mk('Mine', 'event-1'); await mk('Theirs', 'event-2');
    expect(group(two())).not.toContain('data-unassigned-frames');
  });

  it('deleting an event leaves its frames visible under UNASSIGNED (nothing is lost silently)', async () => {
    await rt.initCustomFrames();
    await mk('Cake', 'event-2');
    const s = two();
    const withoutTwo = { ...s, events: s.events.filter((e) => e.id !== 'event-2') } as BoothSettings;
    expect(group(withoutTwo)).toContain('data-unassigned-frame');
  });
});

describe('guests: a frame is offered by its own switch only, whichever event is active', () => {
  it('SHOWN frames of ANY event are in the guest tray; HIDDEN ones are not; pictures stay', async () => {
    await rt.initCustomFrames();
    const a = await mk('A', 'event-1'), b = await mk('B', 'event-2'), old = await mk('Old', undefined);
    const ids = () => guestFramesForLayout('single', [], null).map((f) => f.id);
    expect(ids()).toEqual(expect.arrayContaining([a, b, old]));
    await rt.setCustomEnabled(b, false);
    expect(ids()).toEqual(expect.arrayContaining([a, old])); expect(ids()).not.toContain(b);
    expect(rt.customLayouts(b)).toEqual(['single']);
    // making event 2 the ACTIVE event changes nothing for frames (no active-event gating, decision D1)
    const s = setActiveEvent(two(), 'event-2');
    expect(s.activeEventId).toBe('event-2');
    expect(ids()).toEqual(expect.arrayContaining([a, old])); expect(ids()).not.toContain(b);
    await rt.setCustomEnabled(b, true);
    expect(ids()).toContain(b);
  });
  it('a guest who already holds a hidden frame keeps it', async () => {
    await rt.initCustomFrames();
    const a = await mk('A', 'event-1'); await rt.setCustomEnabled(a, false);
    expect(guestFramesForLayout('single', [], a).map((f) => f.id)).toContain(a);
  });
});

describe('delete question', () => {
  it('says how many frames go with the event, and nothing extra when there are none', () => {
    expect(deleteBody('GALA', 0)).toBe('"GALA" and its receipt text will be removed. This cannot be undone.');
    expect(deleteBody('GALA', 1)).toContain('This event has 1 frame. It will be deleted with it.');
    expect(deleteBody('GALA', 3)).toContain('This event has 3 frames. They will be deleted with it.');
  });
});
