// @vitest-environment node
/**
 * Real clicks and typing against the real ADMIN panel (EP-3).
 *
 * These need a DOM, which the project does not install by default. They run only when `jsdom` and `@testing-library/react` are
 * present (`npm i -D jsdom @testing-library/react @testing-library/dom`), and are SKIPPED otherwise, so a clean `npm test` never breaks.
 * A skipped run is not a pass: the skip is reported by vitest and docs/HANDOFF.md says which run had them enabled.
 */
import { createRequire } from 'module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionStore } from '../../state/session';
import { eventEditorStore } from './eventEditor';

// Only RESOLVE the packages here: importing Testing Library before the DOM globals exist would freeze its `screen` without a document.
const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (m: string): Promise<any> => import(/* @vite-ignore */ m);
const has = (m: string) => { try { req.resolve(m); return true; } catch { return false; } };
const available = has('jsdom') && has('@testing-library/react') && has('@testing-library/dom');

const KEY = 'booth.settings.v1';
const noop = () => {};

describe.skipIf(!available)('Events section: real interaction', () => {
  // Loosely typed on purpose: these packages are optional, so no type from them may appear in this file.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;
  let RTL: Any;
  let AdminPanel: typeof import('./AdminPanel').AdminPanel;
  let dom: Any;
  const stubbed: string[] = [];

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
  beforeEach(() => { localStorage.clear(); eventEditorStore.reset(); });
  afterEach(() => { RTL.cleanup(); vi.restoreAllMocks(); eventEditorStore.reset(); });

  const seed = (extra: Record<string, unknown> = {}) => localStorage.setItem(KEY, JSON.stringify({
    events: [{ id: 'event-1', name: 'WEDDING', header: 'RECEPTION', details: ['BALLROOM'], thankYou: 'MERCI', brandingEnabled: true, brandingText: 'Printed by Memorys' }, { id: 'event-2', name: 'BIRTHDAY', header: '', details: [], thankYou: 'SEE YOU', brandingEnabled: false, brandingText: '' }],
    activeEventId: 'event-1', printer: 'usb', paperWidthMm: 80, share: { enabled: true, publicBaseUrl: 'https://booth.example.com' }, ...extra
  }));
  const saved = () => JSON.parse(localStorage.getItem(KEY)!);
  const mount = () => RTL.render(<AdminPanel onChangePin={noop} initialSection="events" />);
  const text = (s: string) => RTL.screen.getAllByText((_: unknown, el: Element | null) => el?.tagName !== 'SCRIPT' && !!el && el.children.length === 0 && el.textContent?.trim() === s);
  const btn = (name: string) => { const b = RTL.screen.getAllByRole('button').find((x: HTMLElement) => x.textContent?.replace(/\s+/g, ' ').trim() === name); if (!b) throw new Error(`no button "${name}"`); return b as HTMLButtonElement; };
  const maybeBtn = (name: string) => RTL.screen.queryAllByRole('button').find((x: HTMLElement) => x.textContent?.replace(/\s+/g, ' ').trim() === name) as HTMLButtonElement | undefined;
  const input = (placeholder: string) => RTL.screen.getByPlaceholderText(placeholder) as HTMLInputElement;
  const type = (el: HTMLInputElement, v: string) => RTL.fireEvent.change(el, { target: { value: v } });
  const click = (el: Element) => RTL.fireEvent.click(el);
  const dialog = () => RTL.screen.queryByRole('alertdialog');
  /** Events now has sub-tabs (Event List / Event Details / Uploads & Media): open the one a step needs. Visited tabs stay mounted. */
  const tab = (name: string) => click(RTL.screen.getByRole('tab', { name: new RegExp(`^${name}`) }));

  it('typing changes only the draft: the saved event, and so what the next customer gets, is untouched until SAVE', () => {
    seed(); mount(); tab('Event Details');
    expect(btn('SAVE').disabled).toBe(true);
    type(input('MARIA & JOSE'), 'WEDDING 2');
    expect(RTL.screen.getByText('UNSAVED CHANGES')).toBeTruthy();
    expect(btn('SAVE').disabled).toBe(false);
    expect(saved().events[0].name).toBe('WEDDING');
  });

  it('SAVE writes the profile, clears the unsaved state and confirms; other settings are untouched', () => {
    seed(); mount(); tab('Event Details');
    type(input('MARIA & JOSE'), 'NEW NAME');
    type(input('WEDDING RECEPTION'), 'NEW HEADER');
    click(btn('SAVE'));
    const s = saved();
    expect(s.events[0]).toMatchObject({ id: 'event-1', name: 'NEW NAME', header: 'NEW HEADER' });
    expect(s.activeEventId).toBe('event-1');
    expect(s.printer).toBe('usb');
    expect(s.paperWidthMm).toBe(80);
    expect(s.share).toEqual({ enabled: true, publicBaseUrl: 'https://booth.example.com' });
    expect(RTL.screen.getByText('NO UNSAVED CHANGES')).toBeTruthy();
    expect(RTL.screen.getByText(/EVENT SAVED/)).toBeTruthy();
    expect(btn('SAVE').disabled).toBe(true);
  });

  it('a double tap on SAVE writes once', () => {
    seed(); mount(); tab('Event Details');
    type(input('MARIA & JOSE'), 'ONCE');
    const spy = vi.spyOn(dom.window.Storage.prototype, 'setItem');
    const save = btn('SAVE');
    click(save); click(save);
    expect(spy.mock.calls.filter((c: unknown[]) => c[0] === KEY)).toHaveLength(1);
  });

  it('CANCEL restores the saved text and writes nothing', () => {
    seed(); mount(); tab('Event Details');
    const before = localStorage.getItem(KEY);
    type(input('MARIA & JOSE'), 'NOPE');
    click(btn('CANCEL'));
    expect(input('MARIA & JOSE').value).toBe('WEDDING');
    expect(RTL.screen.getByText('NO UNSAVED CHANGES')).toBeTruthy();
    expect(localStorage.getItem(KEY)).toBe(before);
  });

  it('too-long text stays as typed, is flagged, and cannot be saved', () => {
    seed(); mount(); tab('Event Details');
    const long = 'L'.repeat(55);
    type(input('MARIA & JOSE'), long);
    expect(input('MARIA & JOSE').value).toBe(long);
    expect(RTL.screen.getByText(/TOO LONG: 55 OF 40/)).toBeTruthy();
    expect(btn('SAVE').disabled).toBe(true);
    expect(saved().events[0].name).toBe('WEDDING');
  });

  it('an empty name is refused; clearing every optional field is fine', () => {
    seed(); mount(); tab('Event Details');
    type(input('MARIA & JOSE'), '');
    expect(RTL.screen.getByText('EVENT NAME IS REQUIRED')).toBeTruthy();
    expect(btn('SAVE').disabled).toBe(true);
    type(input('MARIA & JOSE'), 'OK');
    type(input('WEDDING RECEPTION'), '');
    type(input('THANK YOU'), '');
    expect(btn('SAVE').disabled).toBe(false);
    click(btn('SAVE'));
    expect(saved().events[0]).toMatchObject({ name: 'OK', header: '', thankYou: '' });
  });

  it('switching profiles with unsaved changes asks first: KEEP EDITING stays, DISCARD AND SWITCH drops the draft', () => {
    seed(); mount();
    tab('Event Details'); type(input('MARIA & JOSE'), 'CHANGED'); tab('Event List');
    click(text('BIRTHDAY')[0]);
    expect(dialog()).toBeTruthy();
    click(btn('KEEP EDITING'));
    expect(dialog()).toBeNull();
    expect(input('MARIA & JOSE').value).toBe('CHANGED');
    click(text('BIRTHDAY')[0]);
    click(btn('DISCARD AND SWITCH'));
    expect(dialog()).toBeNull();
    expect(input('MARIA & JOSE').value).toBe('BIRTHDAY');
    expect(saved().events[0].name).toBe('WEDDING'); // never saved
  });

  it('switching with no unsaved changes needs no question', () => {
    seed(); mount();
    click(text('BIRTHDAY')[0]);
    expect(dialog()).toBeNull();
    tab('Event Details');
    expect(input('MARIA & JOSE').value).toBe('BIRTHDAY');
  });

  it('leaving the section, searching, or pressing EXIT with unsaved changes asks first', () => {
    seed(); mount(); tab('Event Details');
    const reset = vi.spyOn(sessionStore, 'reset').mockImplementation(noop);
    type(input('MARIA & JOSE'), 'CHANGED');
    click(RTL.screen.getAllByRole('button').find((b: HTMLElement) => /Printer/i.test(b.textContent ?? ''))!);
    expect(dialog()).toBeTruthy();
    click(btn('KEEP EDITING'));
    expect(input('MARIA & JOSE').value).toBe('CHANGED');
    click(btn('EXIT'));
    expect(dialog()).toBeTruthy();
    expect(reset).not.toHaveBeenCalled();
    click(btn('KEEP EDITING'));
    RTL.fireEvent.change(RTL.screen.getByLabelText('Search settings'), { target: { value: 'printer' } });
    expect(dialog()).toBeTruthy();
    click(btn('KEEP EDITING'));
    click(btn('EXIT'));
    click(btn('DISCARD AND LEAVE'));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(eventEditorStore.get().edit).toBeNull();
  });

  it('the browser is asked to confirm closing the page only while there are unsaved changes', () => {
    seed(); mount(); tab('Event Details');
    const fire = () => { const e = new dom.window.Event('beforeunload', { cancelable: true }); dom.window.dispatchEvent(e); return e.defaultPrevented; };
    expect(fire()).toBe(false);
    type(input('MARIA & JOSE'), 'CHANGED');
    expect(fire()).toBe(true);
    click(btn('CANCEL'));
    expect(fire()).toBe(false);
  });

  it('an unsaved draft survives the panel being re-mounted (inactivity reset) and is still unsaved', () => {
    seed();
    const first = mount(); tab('Event Details');
    type(input('MARIA & JOSE'), 'HALF TYPED');
    first.unmount();
    mount(); tab('Event Details');
    expect(input('MARIA & JOSE').value).toBe('HALF TYPED');
    expect(RTL.screen.getByText('UNSAVED CHANGES')).toBeTruthy();
    expect(saved().events[0].name).toBe('WEDDING');
  });

  it('typing a name and pressing CREATE adds a profile with a new stable id, selects it, and does NOT make it active', () => {
    seed(); mount();
    type(input('E.G. ANNIVERSARY NIGHT'), '  Gala   Night ');
    click(btn('CREATE'));
    const s = saved();
    expect(s.events.map((e: { id: string }) => e.id)).toEqual(['event-1', 'event-2', 'event-3']);
    expect(s.events[2].name).toBe('Gala Night');
    expect(s.activeEventId).toBe('event-1');
    tab('Event Details');
    expect(input('MARIA & JOSE').value).toBe('Gala Night');
    expect(input('E.G. ANNIVERSARY NIGHT').value).toBe(''); // the field is ready for the next one
  });

  it('CREATE needs a name: an empty or unprintable name shows a message and creates nothing', () => {
    seed(); mount();
    click(btn('CREATE'));
    expect(RTL.screen.getByText('TYPE A NAME FOR THE EVENT')).toBeTruthy();
    type(input('E.G. ANNIVERSARY NIGHT'), 'PARTY \u{1F389}');
    click(btn('CREATE'));
    expect(RTL.screen.getByRole('alert').textContent).toContain('CANNOT BE PRINTED');
    expect(saved().events).toHaveLength(2);
  });

  it('MAKE ACTIVE saves the choice for the next customer and moves the ACTIVE tag', () => {
    seed(); mount();
    click(text('BIRTHDAY')[0]);
    expect(btn('MAKE ACTIVE').disabled).toBe(false);
    click(btn('MAKE ACTIVE'));
    expect(saved().activeEventId).toBe('event-2');
    expect(btn('MAKE ACTIVE').disabled).toBe(true);
    expect(RTL.screen.getByText(/NEXT CUSTOMER USES IT/)).toBeTruthy();
  });

  it('DUPLICATE copies the selected event into a new, inactive profile', () => {
    seed(); mount();
    click(btn('DUPLICATE'));
    const s = saved();
    expect(s.events).toHaveLength(3);
    expect(s.events[2]).toMatchObject({ id: 'event-3', name: 'WEDDING COPY', header: 'RECEPTION', details: ['BALLROOM'] });
    expect(s.activeEventId).toBe('event-1');
  });

  it('DELETE asks first; cancelling keeps it, confirming removes it; the active event can never be deleted', async () => {
    seed(); mount();
    expect(btn('DELETE').disabled).toBe(true); // event-1 is active
    click(text('BIRTHDAY')[0]);
    click(btn('DELETE'));
    expect(dialog()).toBeTruthy();
    click(btn('CANCEL'));
    expect(saved().events).toHaveLength(2);
    click(btn('DELETE'));
    click(RTL.screen.getAllByRole('button').filter((b: HTMLElement) => b.textContent === 'DELETE').at(-1)!);
    await RTL.waitFor(() => expect(saved().events.map((e: { id: string }) => e.id)).toEqual(['event-1'])); // frames (none here) go first, so the delete finishes a moment later
    expect(saved().activeEventId).toBe('event-1');
    expect(btn('DELETE').disabled).toBe(true); // now the last one
    expect(RTL.screen.getByText(/AT LEAST ONE EVENT/)).toBeTruthy();
  });

  it('RESET TEXT asks first, then puts the defaults back and keeps the id and active state', () => {
    seed(); mount();
    click(btn('RESET TEXT'));
    expect(dialog()).toBeTruthy();
    click(btn('CANCEL'));
    expect(saved().events[0].name).toBe('WEDDING');
    click(btn('RESET TEXT'));
    click(btn('RESET'));
    expect(saved().events[0]).toMatchObject({ id: 'event-1', name: 'PHOTOBOOTH', header: '', details: [], thankYou: 'THANK YOU', brandingEnabled: true, brandingText: 'Printed by Memorys' });
    expect(saved().activeEventId).toBe('event-1');
  });

  it('profile actions are blocked while there are unsaved changes', () => {
    seed(); mount();
    tab('Event Details'); type(input('MARIA & JOSE'), 'CHANGED'); tab('Event List');
    for (const l of ['CREATE', 'DUPLICATE', 'RESET TEXT', 'DELETE']) expect(btn(l).disabled, l).toBe(true);
    expect(RTL.screen.getByText('SAVE OR CANCEL YOUR CHANGES FIRST')).toBeTruthy();
  });

  it('a refused write shows the error and the owner keeps the text on screen', () => {
    seed(); mount(); tab('Event Details');
    type(input('MARIA & JOSE'), 'KEEP THIS');
    vi.spyOn(dom.window.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    click(btn('SAVE'));
    expect(RTL.screen.getByText(/COULD NOT SAVE/)).toBeTruthy();
    expect(input('MARIA & JOSE').value).toBe('KEEP THIS');
    expect(saved().events[0].name).toBe('WEDDING'); // nothing reached storage
  });

  it('the branding switch toggles the draft and its text box', () => {
    seed(); mount(); tab('Event Details');
    const sw = RTL.screen.getByRole('switch', { name: 'SHOW BRANDING' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect((input('Printed by Memorys') as HTMLInputElement).disabled).toBe(true);
    click(btn('SAVE'));
    expect(saved().events[0].brandingEnabled).toBe(false);
  });

  it('other sections still work next to Events: the printer section renders and its settings still autosave', () => {
    seed(); mount();
    click(RTL.screen.getAllByRole('button').find((b: HTMLElement) => /Printer/i.test(b.textContent ?? ''))!);
    expect(RTL.screen.getAllByText(/TEST PRINT|PAIR PRINTER|CHECK PRINTER/).length).toBeGreaterThan(0);
    expect(RTL.screen.getByText('AUTO-SAVE ON')).toBeTruthy();
  });

  it('the preview says it is unavailable (instead of crashing) when the device has no canvas', async () => {
    seed(); mount(); tab('Event Details');
    await RTL.waitFor(() => expect(RTL.screen.getByText(/PREVIEW UNAVAILABLE|DRAWING PREVIEW/)).toBeTruthy(), { timeout: 2000 });
  });
});
