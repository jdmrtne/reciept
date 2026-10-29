// @vitest-environment node
/**
 * Real clicks against the real ADMIN > Events page, for the event frame groups (Phase 6).
 * Needs a DOM, which the project does not install by default: runs only when `jsdom` and `@testing-library/react` are present
 * (`npm i -D jsdom @testing-library/react @testing-library/dom`) and is SKIPPED otherwise. A skip is not a pass.
 * Pictures are not decoded here (no canvas in jsdom): `prepareUpload` is replaced by a stub that accepts or rejects; the real
 * validation and the atomic add logic are covered with real fixtures in frames/custom/addEventFrame.test.ts.
 */
import { createRequire } from 'module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventEditorStore } from './eventEditor';
import { FakeIndexedDB } from '../../frames/custom/fakeIdb';
import * as store from '../../frames/custom/store';
import * as rt from '../../frames/custom/runtime';
import { guestFramesForLayout } from '../../frames/visibility';
import type { CustomLayoutArt } from '../../frames/custom/types';

const prep = vi.hoisted(() => ({ fn: null as null | ((layoutId: string, file: Blob) => Promise<unknown>) }));
vi.mock('../../frames/custom/upload', async (orig) => ({ ...(await orig<typeof import('../../frames/custom/upload')>()), prepareUpload: (l: string, f: Blob) => prep.fn!(l, f) }));

const req = createRequire(import.meta.url);
const load = (m: string): Promise<any> => import(/* @vite-ignore */ m); // eslint-disable-line @typescript-eslint/no-explicit-any
const has = (m: string) => { try { req.resolve(m); return true; } catch { return false; } };
const available = has('jsdom') && has('@testing-library/react') && has('@testing-library/dom');
const KEY = 'booth.settings.v1';
const noop = () => {};
const art = (): CustomLayoutArt => ({ blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152, windows: [{ x: 100, y: 100, w: 900, h: 400 }, { x: 100, y: 600, w: 900, h: 400 }], slots: [{ x: 0.08, y: 0.08, w: 0.84, h: 0.35 }, { x: 0.08, y: 0.5, w: 0.84, h: 0.35 }] });
const OK = async () => ({ ok: true, art: art(), warnings: [] });

describe.skipIf(!available)('Events section: frame groups, real interaction', () => {
  type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let RTL: Any, AdminPanel: typeof import('./AdminPanel').AdminPanel, dom: Any, idb: FakeIndexedDB;
  const stubbed: string[] = [];
  let n = 0;

  beforeAll(async () => {
    const { JSDOM } = await load('jsdom');
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
    const w = dom.window as unknown as Record<string, unknown>;
    for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'InputEvent', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLButtonElement', 'SVGElement']) {
      vi.stubGlobal(k, k === 'window' ? dom.window : w[k]); stubbed.push(k);
    }
    (dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    RTL = await load('@testing-library/react');
    ({ AdminPanel } = await import('./AdminPanel'));
  });
  afterAll(() => { vi.unstubAllGlobals(); dom?.window.close(); });
  beforeEach(async () => {
    localStorage.clear(); eventEditorStore.reset(); prep.fn = OK; n = 0;
    idb = new FakeIndexedDB(); (globalThis as Any).indexedDB = idb; store.resetStore(); rt.resetCustomRuntime();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${++n}`); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await rt.initCustomFrames();
  });
  afterEach(() => { RTL.cleanup(); vi.restoreAllMocks(); eventEditorStore.reset(); store.resetStore(); rt.resetCustomRuntime(); delete (globalThis as Any).indexedDB; });

  const seed = () => localStorage.setItem(KEY, JSON.stringify({
    events: [{ id: 'event-1', name: 'WEDDING', header: '', details: [], thankYou: 'MERCI', brandingEnabled: true, brandingText: 'Printed by Memorys' }, { id: 'event-2', name: 'BIRTHDAY', header: '', details: [], thankYou: 'SEE YOU', brandingEnabled: false, brandingText: '' }],
    activeEventId: 'event-1', printer: 'usb', paperWidthMm: 80, share: { enabled: true, publicBaseUrl: 'https://booth.example.com' }
  }));
  const saved = () => JSON.parse(localStorage.getItem(KEY)!);
  const mount = () => RTL.render(<AdminPanel onChangePin={noop} initialSection="events" />);
  const label = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim();
  const btn = (name: string) => { const b = RTL.screen.getAllByRole('button').find((x: HTMLElement) => label(x) === name); if (!b) throw new Error(`no button "${name}"`); return b as HTMLButtonElement; };
  const maybeBtn = (name: string) => RTL.screen.queryAllByRole('button').find((x: HTMLElement) => label(x) === name) as HTMLButtonElement | undefined;
  const click = (el: Element) => RTL.fireEvent.click(el);
  const type = (el: HTMLInputElement, v: string) => RTL.fireEvent.change(el, { target: { value: v } });
  const input = (placeholder: string) => RTL.screen.getByPlaceholderText(placeholder) as HTMLInputElement;
  const pick = (name = 'frame.png') => RTL.fireEvent.change(document.querySelector('input[type="file"][aria-label="CHOOSE PICTURE"]')!, { target: { files: [new File(['png'], name, { type: 'image/png' })] } });
  const eventItem = (name: string) => { const el = [...document.querySelectorAll('.ev-item .ev-name')].find((x) => x.textContent?.trim() === name); if (!el) throw new Error(`no event "${name}" in the list`); return el; }; // the list item, not the ACTIVE EVENT banner
  const tiles = () => [...document.querySelectorAll('[data-event-frame]')] as HTMLElement[];
  const mk = async (name: string, eventId: string | undefined, special = true) => { const r = await rt.createCustomFrame(name, special, eventId); if (!r.ok) throw new Error('create'); await rt.setCustomLayoutArt(r.value.id, 'single', art()); return r.value.id; };
  const addFrame = async (name: string) => { click(btn('ADD FRAME')); type(input('E.G. DANCE FLOOR'), name); pick(); click(btn('SAVE FRAME')); };

  it('CREATE with just a name makes a new, inactive, selected event whose group is empty', () => {
    seed(); mount();
    type(input('E.G. ANNIVERSARY NIGHT'), 'Gala Night');
    click(btn('CREATE'));
    expect(saved().events.map((e: { name: string }) => e.name)).toEqual(['WEDDING', 'BIRTHDAY', 'Gala Night']);
    expect(saved().activeEventId).toBe('event-1');
    expect(document.querySelector('.lv-h')?.textContent).toContain('FRAME GROUP: GALA NIGHT');
    expect(RTL.screen.getByText('No frames in this event yet. Press ADD FRAME.')).toBeTruthy();
  });

  it('ADD FRAME with a valid picture puts a tile in this event only, opens the editor, and BACK TO GRID shows the tile', async () => {
    seed(); mount();
    click(btn('ADD FRAME'));
    expect(btn('SAVE FRAME').disabled).toBe(true); // needs a name and a picture
    type(input('E.G. DANCE FLOOR'), 'Dance Floor');
    expect(btn('SAVE FRAME').disabled).toBe(true); // a name alone is not enough
    pick('dance.png');
    expect(RTL.screen.getByText('PICTURE CHOSEN: dance.png')).toBeTruthy();
    click(btn('SAVE FRAME'));
    await RTL.waitFor(() => expect(maybeBtn('BACK TO GRID')).toBeTruthy());
    const rec = rt.customRecords()[0];
    expect(rec).toMatchObject({ name: 'Dance Floor', special: true, eventId: 'event-1' });
    expect(Object.keys(rec.layouts)).toEqual(['strip-3']); // the layout picked in the panel (default THREE STRIP)
    expect(RTL.screen.getByText(/DANCE FLOOR ADDED: 2 PHOTO WINDOWS FOUND/)).toBeTruthy();
    click(btn('BACK TO GRID'));
    expect(tiles()).toHaveLength(1);
    expect(tiles()[0].textContent).toContain('DANCE FLOOR');
    click(eventItem('BIRTHDAY'));
    expect(tiles()).toHaveLength(0); // the other event's grid is empty: frames of A never appear in B
    click(eventItem('WEDDING'));
    expect(tiles()).toHaveLength(1);
  });

  it('an invalid picture shows the readable error and creates nothing (no frame, nothing stored)', async () => {
    seed(); mount();
    prep.fn = async () => ({ ok: false, errors: ['This picture is only 300 pixels wide.'] });
    await addFrame('Bad One');
    await RTL.waitFor(() => expect(RTL.screen.getByText('This picture is only 300 pixels wide.')).toBeTruthy());
    expect(rt.customRecords()).toEqual([]);
    const stored = await store.listFrames(); expect(stored.ok && stored.value).toEqual([]);
    expect(tiles()).toHaveLength(0);
    expect(maybeBtn('BACK TO GRID')).toBeUndefined();
    expect(document.querySelector('[data-add-panel]')).toBeTruthy(); // the panel stays so the owner can pick another file
  });

  it('if the picture passes but cannot be saved, the empty frame is removed again (no ghost tile)', async () => {
    seed(); mount();
    idb.inject({ op: 'put', error: { name: 'QuotaExceededError' }, kind: 'abort' });
    await addFrame('Gala');
    await RTL.waitFor(() => expect(RTL.screen.getAllByText(store.MESSAGES.quota).length).toBeGreaterThan(0));
    expect(rt.customRecords()).toEqual([]);
    const stored = await store.listFrames(); expect(stored.ok && stored.value).toEqual([]);
    click(btn('CANCEL'));
    expect(tiles()).toHaveLength(0);
    expect(RTL.screen.getByText('No frames in this event yet. Press ADD FRAME.')).toBeTruthy();
  });

  it('each tile has a SHOWN / HIDDEN switch: HIDDEN takes the frame out of the guest tray and keeps the pictures', async () => {
    seed(); const id = await mk('Rings', 'event-1'); mount();
    const sw = () => RTL.screen.getByRole('switch', { name: 'SHOW FRAME RINGS' });
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(guestFramesForLayout('single', [], null).map((f) => f.id)).toContain(id);
    click(sw());
    await RTL.waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('false'));
    expect(sw().textContent).toBe('HIDDEN');
    expect(tiles()[0].getAttribute('data-shown')).toBe('false');
    expect(guestFramesForLayout('single', [], null).map((f) => f.id)).not.toContain(id);
    expect(rt.customLayouts(id)).toEqual(['single']);
    click(sw());
    await RTL.waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('true'));
    expect(guestFramesForLayout('single', [], null).map((f) => f.id)).toContain(id);
  });

  it('SHOW ALL and HIDE ALL change every frame of this event, and only this event', async () => {
    seed(); const a = await mk('A', 'event-1'), b = await mk('B', 'event-1'), other = await mk('Other', 'event-2'); mount();
    click(btn('HIDE ALL'));
    await RTL.waitFor(() => expect(rt.customEnabled(a) || rt.customEnabled(b)).toBe(false));
    expect(rt.customEnabled(other)).toBe(true);
    expect(btn('HIDE ALL').disabled).toBe(true);
    click(btn('SHOW ALL'));
    await RTL.waitFor(() => expect(rt.customEnabled(a) && rt.customEnabled(b)).toBe(true));
  });

  it('tapping a tile opens its editor (rename, delete, per layout pictures) and BACK TO GRID returns', async () => {
    seed(); await mk('Rings', 'event-1'); mount();
    click(RTL.screen.getByRole('button', { name: 'EDIT FRAME RINGS' }));
    expect(maybeBtn('BACK TO GRID')).toBeTruthy();
    expect(maybeBtn('RENAME')).toBeTruthy(); expect(maybeBtn('DELETE FRAME')).toBeTruthy();
    expect(document.querySelectorAll('[data-layout]')).toHaveLength(6);
    click(btn('BACK TO GRID'));
    expect(tiles()).toHaveLength(1);
  });

  it('DELETE FRAME in the editor removes the frame and returns to the grid', async () => {
    seed(); await mk('Rings', 'event-1'); mount();
    click(RTL.screen.getByRole('button', { name: 'EDIT FRAME RINGS' }));
    click(btn('DELETE FRAME'));
    click(RTL.screen.getAllByRole('button').filter((b: HTMLElement) => label(b) === 'DELETE FRAME').at(-1)!);
    await RTL.waitFor(() => expect(rt.customRecords()).toEqual([]));
    await RTL.waitFor(() => expect(tiles()).toHaveLength(0));
    expect(RTL.screen.getByText('No frames in this event yet. Press ADD FRAME.')).toBeTruthy();
  });

  it('deleting an event with frames asks first (naming the count), then deletes its frames and the event; other events keep theirs', async () => {
    seed(); await mk('Cake', 'event-2'); await mk('Toast', 'event-2'); const keep = await mk('Rings', 'event-1'); mount();
    click(eventItem('BIRTHDAY'));
    click(btn('DELETE'));
    expect(RTL.screen.getByRole('alertdialog').textContent).toContain('This event has 2 frames. They will be deleted with it.');
    click(btn('CANCEL'));
    expect(saved().events).toHaveLength(2); expect(rt.customRecords()).toHaveLength(3); // cancelling deletes nothing
    click(btn('DELETE'));
    click(RTL.screen.getAllByRole('button').filter((b: HTMLElement) => label(b) === 'DELETE').at(-1)!);
    await RTL.waitFor(() => expect(saved().events.map((e: { id: string }) => e.id)).toEqual(['event-1']));
    expect(rt.customRecords().map((f) => f.id)).toEqual([keep]);
    const stored = await store.listFrames(); expect(stored.ok && stored.value.map((f) => f.id)).toEqual([keep]);
  });

  it('if a frame cannot be deleted, the event is kept and an error says so', async () => {
    seed(); await mk('Cake', 'event-2'); mount();
    click(eventItem('BIRTHDAY'));
    click(btn('DELETE'));
    idb.inject({ op: 'delete', error: { name: 'UnknownError' }, kind: 'request' });
    click(RTL.screen.getAllByRole('button').filter((b: HTMLElement) => label(b) === 'DELETE').at(-1)!);
    await RTL.waitFor(() => expect(RTL.screen.getByText(/THE EVENT WAS KEPT/)).toBeTruthy());
    expect(saved().events).toHaveLength(2);
    expect(rt.customRecords()).toHaveLength(1);
  });

  it('an event without frames deletes exactly as before', async () => {
    seed(); mount();
    click(eventItem('BIRTHDAY')); click(btn('DELETE'));
    expect(RTL.screen.getByRole('alertdialog').textContent).not.toContain('This event has');
    click(RTL.screen.getAllByRole('button').filter((b: HTMLElement) => label(b) === 'DELETE').at(-1)!);
    await RTL.waitFor(() => expect(saved().events).toHaveLength(1));
  });

  it('old special frames show under UNASSIGNED FRAMES and MOVE TO THIS EVENT puts them in the group (nothing moves by itself)', async () => {
    seed(); const old = await mk('From Before', undefined); const own = await mk('Own Frame', undefined, false); mount();
    expect(tiles()).toHaveLength(0);
    expect(document.querySelector(`[data-unassigned-frame="${old}"]`)).toBeTruthy();
    expect(document.querySelector(`[data-unassigned-frame="${own}"]`)).toBeNull(); // a normal "own" frame is never offered here
    click(RTL.screen.getByRole('button', { name: 'MOVE FROM BEFORE TO THIS EVENT' }));
    await RTL.waitFor(() => expect(tiles()).toHaveLength(1));
    expect(rt.customRecord(old)?.eventId).toBe('event-1');
    expect(document.querySelector('[data-unassigned-frames]')).toBeNull();
    click(eventItem('BIRTHDAY'));
    expect(tiles()).toHaveLength(0); // it moved into WEDDING only
  });

  it('CANCEL closes the ADD FRAME panel and forgets what was typed', () => {
    seed(); mount();
    click(btn('ADD FRAME')); type(input('E.G. DANCE FLOOR'), 'Half typed'); click(btn('CANCEL'));
    expect(document.querySelector('[data-add-panel]')).toBeNull();
    click(btn('ADD FRAME'));
    expect(input('E.G. DANCE FLOOR').value).toBe('');
  });
});
