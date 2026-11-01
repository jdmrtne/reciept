// @vitest-environment node
/**
 * Real clicks against the real ADMIN > Events page, for the event layouts card (EL-4).
 * Needs a DOM, which the project does not install by default: runs only when `jsdom` and `@testing-library/react` are present
 * (`npm i -D jsdom @testing-library/react @testing-library/dom`) and is SKIPPED otherwise. A skip is not a pass.
 * Pictures are not decoded here (no canvas in jsdom): `prepareEventLayoutUpload` is replaced by a stub that accepts or rejects.
 */
import { createRequire } from 'module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventEditorStore } from './eventEditor';
import { FakeIndexedDB } from '../../frames/custom/fakeIdb';
import * as store from '../../frames/custom/store';
import * as ev from '../../frames/custom/eventRuntime';
import type { CustomLayoutArt } from '../../frames/custom/types';

const prep = vi.hoisted(() => ({ fn: null as null | ((f: Blob) => Promise<unknown>) }));
vi.mock('../../frames/custom/upload', async (orig) => ({ ...(await orig<typeof import('../../frames/custom/upload')>()), prepareEventLayoutUpload: (f: Blob) => prep.fn!(f) }));

const req = createRequire(import.meta.url);
const load = (m: string): Promise<any> => import(/* @vite-ignore */ m); // eslint-disable-line @typescript-eslint/no-explicit-any
const has = (m: string) => { try { req.resolve(m); return true; } catch { return false; } };
const available = has('jsdom') && has('@testing-library/react') && has('@testing-library/dom');
const KEY = 'booth.settings.v1';
const noop = () => {};
const art = (windows = 2): CustomLayoutArt => ({ blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152, windows: [{ x: 100, y: 100, w: 900, h: 400 }], slots: Array.from({ length: windows }, (_, i) => ({ x: 0.08, y: 0.08 + i * 0.3, w: 0.84, h: 0.25 })) });
const OK = (w = 2, warnings: string[] = []) => async () => ({ ok: true, art: art(w), warnings });

describe.skipIf(!available)('Events section: event layouts, real interaction', () => {
  type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let RTL: Any, AdminPanel: typeof import('./AdminPanel').AdminPanel, dom: Any, idb: FakeIndexedDB;
  let n = 0;

  beforeAll(async () => {
    const { JSDOM } = await load('jsdom');
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
    const w = dom.window as unknown as Record<string, unknown>;
    for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'InputEvent', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLButtonElement', 'File', 'DocumentFragment', 'SVGElement']) vi.stubGlobal(k, k === 'window' ? dom.window : w[k]);
    (dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    RTL = await load('@testing-library/react');
    ({ AdminPanel } = await import('./AdminPanel'));
  });
  afterAll(() => { vi.unstubAllGlobals(); dom?.window.close(); });
  beforeEach(async () => {
    localStorage.clear(); eventEditorStore.reset(); prep.fn = OK(); n = 0;
    idb = new FakeIndexedDB(); (globalThis as Any).indexedDB = idb; store.resetStore(); ev.resetEventRuntime();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${++n}`); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await ev.initEventLayouts();
  });
  afterEach(() => { RTL.cleanup(); vi.restoreAllMocks(); eventEditorStore.reset(); store.resetStore(); ev.resetEventRuntime(); delete (globalThis as Any).indexedDB; });

  const seed = (events = ['WEDDING', 'BIRTHDAY']) => localStorage.setItem(KEY, JSON.stringify({
    events: events.map((name, i) => ({ id: `event-${i + 1}`, name, header: '', details: [], thankYou: 'MERCI', brandingEnabled: true, brandingText: 'Printed by Memorys' })),
    activeEventId: 'event-1', printer: 'usb', paperWidthMm: 80, share: { enabled: true, publicBaseUrl: 'https://booth.example.com' }
  }));
  const tab = (name: string) => RTL.fireEvent.click(RTL.screen.getByRole('tab', { name: new RegExp(`^${name}`) }));
  const mount = () => { const r = RTL.render(<AdminPanel onChangePin={noop} initialSection="events" />); tab('Uploads & Media'); return r; };
  const label = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim();
  const btn = (name: string) => { const b = RTL.screen.getAllByRole('button').find((x: HTMLElement) => label(x) === name || x.getAttribute('aria-label') === name); if (!b) throw new Error(`no button "${name}"`); return b as HTMLButtonElement; };
  const sw = (name: string) => { const b = RTL.screen.getAllByRole('switch').find((x: HTMLElement) => x.getAttribute('aria-label') === name); if (!b) throw new Error(`no switch "${name}"`); return b as HTMLButtonElement; };
  const click = (el: Element) => RTL.fireEvent.click(el);
  const type = (el: Element, v: string) => RTL.fireEvent.change(el, { target: { value: v } });
  const tiles = () => [...document.querySelectorAll('[data-event-layout]')] as HTMLElement[];
  const pickFile = (aria: string, name = 'layout.png') => RTL.fireEvent.change(document.querySelector(`input[type="file"][aria-label="${aria}"]`)!, { target: { files: [new File(['png'], name, { type: 'image/png' })] } });
  const openSettings = (name: string) => click(btn(`OPEN SETTINGS OF ${name}`));
  const mk = async (name: string, eventId: string, w = 2) => { const r = await ev.createEventLayoutRecord({ name, eventId, art: art(w) }); if (!r.ok) throw new Error('create'); return r.value.id; };

  it('ADD LAYOUT needs a name and a picture, then a tile appears in this event only', async () => {
    seed(); mount();
    click(btn('ADD LAYOUT'));
    expect(btn('SAVE LAYOUT').disabled).toBe(true);
    type(document.querySelector('input[aria-label="LAYOUT NAME"]')!, 'Dance Floor');
    expect(btn('SAVE LAYOUT').disabled).toBe(true);
    pickFile('CHOOSE PICTURE', 'dance.png');
    expect(RTL.screen.getByText('PICTURE CHOSEN: dance.png')).toBeTruthy();
    click(btn('SAVE LAYOUT'));
    await RTL.waitFor(() => expect(tiles()).toHaveLength(1));
    expect(ev.eventLayoutRecords()[0]).toMatchObject({ name: 'Dance Floor', eventId: 'event-1' });
    expect(tiles()[0].textContent).toContain('DANCE FLOOR');
    expect(tiles()[0].textContent).toContain('DANCE FLOOR');
  });

  it('a picture that fails the check shows its plain sentences and creates nothing', async () => {
    seed(); mount();
    prep.fn = async () => ({ ok: false, errors: ['No photo windows were found. The image has no see through area.'] });
    click(btn('ADD LAYOUT'));
    type(document.querySelector('input[aria-label="LAYOUT NAME"]')!, 'Bad');
    pickFile('CHOOSE PICTURE');
    click(btn('SAVE LAYOUT'));
    await RTL.waitFor(() => expect(document.querySelector('ul.cf-err')?.textContent).toContain('No photo windows were found.'));
    expect(ev.eventLayoutRecords()).toHaveLength(0);
  });

  it('picture warnings are shown after a successful add', async () => {
    seed(); mount();
    prep.fn = OK(1, ['One transparent area touches the edge of the image and is ignored.']);
    click(btn('ADD LAYOUT'));
    type(document.querySelector('input[aria-label="LAYOUT NAME"]')!, 'Cake');
    pickFile('CHOOSE PICTURE');
    click(btn('SAVE LAYOUT'));
    await RTL.waitFor(() => expect(RTL.screen.getByText(/touches the edge of the image/)).toBeTruthy());
  });

  it('the SHOWN switch flips the stored flag, and SHOW ALL / HIDE ALL follow', async () => {
    seed(); const a = await mk('Dance floor', 'event-1'); await mk('Cake', 'event-1'); mount();
    click(sw('SHOW LAYOUT DANCE FLOOR'));
    await RTL.waitFor(() => expect(ev.eventLayoutEnabled(a)).toBe(false));
    expect(tiles()[0].getAttribute('data-shown')).toBe('false');
    click(btn('HIDE ALL LAYOUTS OF WEDDING'));
    await RTL.waitFor(() => expect(ev.eventLayoutRecords().every((d) => d.enabled === false)).toBe(true));
    click(btn('SHOW ALL LAYOUTS OF WEDDING'));
    await RTL.waitFor(() => expect(ev.eventLayoutRecords().every((d) => d.enabled !== false)).toBe(true));
  });

  it('the grid tile has only the picture, the name and the switch; tapping it opens the QR view with the buttons under the QR preview, and BACK returns to the grid', async () => {
    seed(); await mk('Dance floor', 'event-1'); mount();
    const t = tiles()[0];
    expect([...t.querySelectorAll('button:not([role="switch"])')].map((b) => b.getAttribute('aria-label') ?? label(b))).toEqual(['OPEN SETTINGS OF DANCE FLOOR', 'DANCE FLOOR']);
    expect(t.querySelectorAll('[role="switch"]')).toHaveLength(1);
    expect(document.querySelector('[data-layout-settings]')).toBeNull();
    openSettings('DANCE FLOOR');
    const page = document.querySelector('[data-layout-settings]')!;
    expect(page).toBeTruthy();
    expect(page.querySelector('[data-qr-editor]')).toBeTruthy();          // the QR view is the default
    expect(page.textContent).toContain('HOW IT PRINTS');                   // with the QR preview
    const how = page.querySelector('.cf-how')!;                            // the column beside the picture
    expect(how.textContent).toContain('HOW IT PRINTS');
    expect(how.querySelector('.el-side')).toBeTruthy();                    // the buttons sit in it, under the sample QR preview
    expect(how.innerHTML.indexOf('el-side')).toBeGreaterThan(how.innerHTML.indexOf('lv-thumb'));
    for (const b of ['RENAME DANCE FLOOR', 'MOVE DANCE FLOOR TO ANOTHER EVENT', 'DELETE DANCE FLOOR']) expect(btn(b)).toBeTruthy();
    click(btn('BACK TO LAYOUTS'));
    expect(document.querySelector('[data-layout-settings]')).toBeNull();
    expect(tiles()).toHaveLength(1);
  });

  it('RENAME saves a new name, and an empty name is refused with a sentence', async () => {
    seed(); const a = await mk('Dance floor', 'event-1'); mount();
    openSettings('DANCE FLOOR');
    click(btn('RENAME DANCE FLOOR'));
    const field = document.querySelector('input[aria-label="NEW NAME FOR DANCE FLOOR"]')!;
    type(field, '   ');
    expect(btn('SAVE NAME').disabled).toBe(true);
    type(field, 'Photo wall');
    click(btn('SAVE NAME'));
    await RTL.waitFor(() => expect(ev.eventLayoutById(a)!.name).toBe('Photo wall'));
    click(btn('BACK TO LAYOUTS'));
    await RTL.waitFor(() => expect(tiles()[0].textContent).toContain('PHOTO WALL'));
  });

  it('REPLACE PICTURE swaps the art and drops the QR spot with a note; a bad picture changes nothing', async () => {
    seed(); const a = await mk('Dance floor', 'event-1', 2); await ev.setEventLayoutRecordQr(a, { x: 0.5, y: 0.8, w: 0.2, h: 0.1 }); mount();
    openSettings('DANCE FLOOR');
    prep.fn = async () => ({ ok: false, errors: ['This picture could not be opened. Save it again as a PNG and try again.'] });
    pickFile('REPLACE PICTURE OF DANCE FLOOR');
    await RTL.waitFor(() => expect(document.querySelector('ul.cf-err')?.textContent).toContain('could not be opened'));
    expect(ev.eventLayoutById(a)!.art.slots).toHaveLength(2);
    expect(ev.eventLayoutById(a)!.art.qr).toBeTruthy();
    prep.fn = OK(3);
    pickFile('REPLACE PICTURE OF DANCE FLOOR');
    await RTL.waitFor(() => expect(ev.eventLayoutById(a)!.art.slots).toHaveLength(3));
    expect(ev.eventLayoutById(a)!.art.qr).toBeUndefined();
    await RTL.waitFor(() => expect(RTL.screen.getByText(/saved QR code spot was cleared/)).toBeTruthy());
    await RTL.waitFor(() => expect(document.querySelector('[data-layout-photos="3"]')).toBeTruthy());
  });

  it('MOVE sends a layout to another event and it leaves this grid', async () => {
    seed(); const a = await mk('Dance floor', 'event-1'); mount();
    openSettings('DANCE FLOOR');
    click(btn('MOVE DANCE FLOOR TO ANOTHER EVENT'));
    expect(btn('MOVE LAYOUT').disabled).toBe(true); // nothing picked yet
    type(document.querySelector('select[aria-label="MOVE DANCE FLOOR TO"]')!, 'event-2');
    click(btn('MOVE LAYOUT'));
    await RTL.waitFor(() => expect(ev.eventLayoutById(a)!.eventId).toBe('event-2'));
    await RTL.waitFor(() => expect(tiles()).toHaveLength(0)); // the page closes by itself and the grid is back
  });

  it('DELETE asks first: KEEP LAYOUT changes nothing, DELETE LAYOUT removes it', async () => {
    seed(); await mk('Dance floor', 'event-1'); mount();
    openSettings('DANCE FLOOR');
    click(btn('DELETE DANCE FLOOR'));
    expect(RTL.screen.getByText('DELETE THIS LAYOUT?')).toBeTruthy();
    click(btn('KEEP LAYOUT'));
    expect(ev.eventLayoutRecords()).toHaveLength(1);
    click(btn('DELETE DANCE FLOOR'));
    click(btn('DELETE LAYOUT'));
    await RTL.waitFor(() => expect(ev.eventLayoutRecords()).toHaveLength(0));
  });

  it('an unassigned layout can be given an event and then shows in that grid', async () => {
    seed(); const a = await mk('Old party', 'event-gone'); mount();
    expect(tiles()).toHaveLength(0);
    expect(document.querySelector('[data-unassigned-layout]')).toBeTruthy();
    click(btn('ASSIGN OLD PARTY TO AN EVENT')); // the list defaults to the event picked above
    await RTL.waitFor(() => expect(ev.eventLayoutById(a)!.eventId).toBe('event-1'));
    await RTL.waitFor(() => expect(tiles()).toHaveLength(1));
    expect(document.querySelector('[data-unassigned-layouts]')).toBeNull();
  });
});
