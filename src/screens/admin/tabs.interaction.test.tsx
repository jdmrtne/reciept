// @vitest-environment node
/**
 * Real clicks, keys, touches and typing against the real ADMIN panel's sub-tabs.
 * Like the other *.interaction tests, these run only when jsdom + Testing Library are installed and are SKIPPED otherwise.
 */
import { createRequire } from 'module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventEditorStore } from './eventEditor';
import { frameTextEditorStore } from './frameTextEditor';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (m: string): Promise<any> => import(/* @vite-ignore */ m);
const has = (m: string) => { try { req.resolve(m); return true; } catch { return false; } };
const available = has('jsdom') && has('@testing-library/react') && has('@testing-library/dom');
const KEY = 'booth.settings.v1';
const noop = () => {};

describe.skipIf(!available)('Sub-tabs: real interaction', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;
  let RTL: Any;
  let AdminPanel: typeof import('./AdminPanel').AdminPanel;
  let dom: Any;

  beforeAll(async () => {
    const { JSDOM } = await load('jsdom');
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
    const w = dom.window as unknown as Record<string, unknown>;
    for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'InputEvent', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLButtonElement', 'SVGElement']) {
      vi.stubGlobal(k, k === 'window' ? dom.window : w[k]);
    }
    (dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    RTL = await load('@testing-library/react');
    ({ AdminPanel } = await import('./AdminPanel'));
  });
  afterAll(() => { vi.unstubAllGlobals(); dom?.window.close(); });
  beforeEach(() => { localStorage.clear(); eventEditorStore.reset(); frameTextEditorStore.reset(); });
  afterEach(() => { RTL.cleanup(); vi.restoreAllMocks(); eventEditorStore.reset(); frameTextEditorStore.reset(); });

  const seed = (extra: Record<string, unknown> = {}) => localStorage.setItem(KEY, JSON.stringify({
    events: [{ id: 'event-1', name: 'WEDDING', header: 'RECEPTION', details: ['BALLROOM'], thankYou: 'MERCI', brandingEnabled: true, brandingText: 'Printed by Memorys' }],
    activeEventId: 'event-1', printer: 'usb', paperWidthMm: 80, share: { enabled: true, publicBaseUrl: 'https://booth.example.com' }, ...extra
  }));
  const saved = () => JSON.parse(localStorage.getItem(KEY)!);
  const mount = (section = 'printer', tab?: string) => RTL.render(<AdminPanel onChangePin={noop} initialSection={section as never} initialTab={tab} />);
  const click = (el: Element) => RTL.fireEvent.click(el);
  const tabs = () => RTL.screen.queryAllByRole('tab') as HTMLElement[];
  const tabNamed = (n: string) => RTL.screen.getByRole('tab', { name: new RegExp(`^${n}`) }) as HTMLElement;
  const selected = () => (RTL.screen.getByRole('tab', { selected: true }) as HTMLElement).textContent?.replace(/\s+/g, ' ').trim();
  const nav = (label: RegExp) => RTL.screen.getByRole('navigation', { name: 'Settings sections' }).querySelectorAll('button')[0] && ([...RTL.screen.getByRole('navigation', { name: 'Settings sections' }).querySelectorAll('button')] as HTMLElement[]).find((b) => label.test(b.textContent ?? ''))!;
  const body = () => document.querySelector('.adm-body') as HTMLElement;
  const touch = (el: Element, type: 'touchstart' | 'touchend', x: number, y: number) => {
    const e = new dom.window.Event(type, { bubbles: true, cancelable: true });
    const pt = [{ clientX: x, clientY: y }];
    Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : pt });
    Object.defineProperty(e, 'changedTouches', { value: pt });
    el.dispatchEvent(e);
  };
  const swipe = (el: Element, dx: number, dy = 5) => RTL.act(() => { touch(el, 'touchstart', 300, 200); touch(el, 'touchend', 300 + dx, 200 + dy); });

  it('the sidebar is still there: every category, and the selected one is marked', () => {
    seed(); mount('printer');
    const n = RTL.screen.getByRole('navigation', { name: 'Settings sections' });
    expect(n.querySelectorAll('button')).toHaveLength(10);
    expect(n.querySelector('[aria-current="page"]')?.textContent).toContain('Printer');
  });

  it('shows the right tabs per category and only the selected tab\'s content', () => {
    seed(); mount('printer');
    expect(tabs().map((t) => t.textContent)).toEqual(['Printer Setup', 'Connection', 'Testing']);
    expect(selected()).toBe('Printer Setup');
    expect(RTL.screen.getByText('Printer type')).toBeTruthy();
    expect(RTL.screen.queryByText('Check & test')).toBeNull();
    click(tabNamed('Testing'));
    expect(selected()).toBe('Testing');
    expect(RTL.screen.getByText('Check & test')).toBeTruthy();
    expect(RTL.screen.getByText('Printer type').closest('[hidden]')).toBeTruthy(); // visited, kept mounted, hidden
  });

  it('switching tabs does not change the sidebar category', () => {
    seed(); mount('quality');
    click(tabNamed('Paper'));
    expect(document.querySelector('.adm-nav [aria-current="page"]')?.textContent).toContain('Print quality');
  });

  it('exposes tab semantics and keyboard navigation (arrows, Home, End; roving tabindex)', () => {
    seed(); mount('quality');
    const list = RTL.screen.getByRole('tablist');
    expect(list.getAttribute('aria-label')).toBeTruthy();
    expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    const key = (k: string) => RTL.fireEvent.keyDown(RTL.screen.getByRole('tab', { selected: true }), { key: k });
    key('ArrowRight'); expect(selected()).toBe('Paper & Cutting');
    key('End'); expect(selected()).toBe('Test Print');
    key('ArrowRight'); expect(selected()).toBe('Test Print'); // no wrap
    key('Home'); expect(selected()).toBe('Photo Quality');
    key('ArrowLeft'); expect(selected()).toBe('Photo Quality');
    const t = RTL.screen.getByRole('tab', { selected: true });
    expect(document.getElementById(t.getAttribute('aria-controls')!)?.getAttribute('role')).toBe('tabpanel');
  });

  it('single-tab categories (Layouts, Frame text, Security) show no tab bar', () => {
    seed();
    for (const s of ['layouts', 'frameText', 'security']) { mount(s); expect(tabs(), s).toHaveLength(0); RTL.cleanup(); }
  });

  it('each category remembers its own tab when you come back', () => {
    seed(); mount('printer');
    click(tabNamed('Testing'));
    click(nav(/Print quality/)); expect(selected()).toBe('Photo Quality');
    click(tabNamed('Paper'));
    click(nav(/^Printer/)); expect(selected()).toBe('Testing');
    click(nav(/Print quality/)); expect(selected()).toBe('Paper & Cutting');
  });

  it('swipe left goes to the next tab, swipe right to the previous, and the ends do not wrap', () => {
    seed(); mount('quality');
    swipe(body(), -120); expect(selected()).toBe('Paper & Cutting');
    swipe(body(), -120); expect(selected()).toBe('Test Print');
    swipe(body(), -120); expect(selected()).toBe('Test Print');
    swipe(body(), 120); expect(selected()).toBe('Paper & Cutting');
    swipe(body(), 120); swipe(body(), 120); expect(selected()).toBe('Photo Quality');
  });

  it('vertical scrolling, short moves and swipes that start on controls never change the tab', () => {
    seed(); mount('quality');
    swipe(body(), -40, 160); expect(selected()).toBe('Photo Quality'); // a scroll
    swipe(body(), -30); expect(selected()).toBe('Photo Quality'); // too short
    const control = body().querySelector('button, input, [role="radio"], [role="switch"]') as HTMLElement;
    expect(control).toBeTruthy();
    swipe(control, -150); expect(selected()).toBe('Photo Quality'); // started on a control
    const tab = tabNamed('Photo Quality');
    swipe(tab, -150); expect(selected()).toBe('Photo Quality'); // the tab bar scrolls itself
  });

  it('settings stay saved after moving between tabs and categories', () => {
    seed({ share: { enabled: false, publicBaseUrl: '' } }); mount('sharing');
    click(RTL.screen.getByRole('switch', { name: 'SHARE QR' }));
    expect(saved().share.enabled).toBe(true);
    click(tabNamed('Photo Links')); click(tabNamed('QR Sharing'));
    expect(RTL.screen.getByRole('switch', { name: 'SHARE QR' }).getAttribute('aria-checked')).toBe('true');
    click(nav(/Appearance/)); click(nav(/Photo sharing/));
    expect(RTL.screen.getByRole('switch', { name: 'SHARE QR' }).getAttribute('aria-checked')).toBe('true');
    expect(saved().share.enabled).toBe(true);
  });

  it('a visited tab keeps what was typed in it while another tab is open', () => {
    seed(); mount('events');
    const field = () => RTL.screen.getByPlaceholderText('E.G. ANNIVERSARY NIGHT') as HTMLInputElement;
    RTL.fireEvent.change(field(), { target: { value: 'Half typed' } });
    click(tabNamed('Event Details')); click(tabNamed('Event List'));
    expect(field().value).toBe('Half typed');
  });

  it('unsaved event text survives tab switches, is marked on its tab, and is protected from leaving', () => {
    seed(); mount('events');
    click(tabNamed('Event Details'));
    RTL.fireEvent.change(RTL.screen.getByPlaceholderText('MARIA & JOSE'), { target: { value: 'CHANGED' } });
    expect(tabNamed('Event Details').querySelector('[aria-label="unsaved changes"]')).toBeTruthy();
    click(tabNamed('Event List'));
    expect(tabNamed('Event Details').querySelector('[aria-label="unsaved changes"]')).toBeTruthy(); // visible from another tab
    swipe(body(), -150); // the swipe moves on to Event Details (not a discard) ...
    expect((RTL.screen.getByPlaceholderText('MARIA & JOSE') as HTMLInputElement).value).toBe('CHANGED');
    // ... but changing category still asks first
    click(nav(/Printer/));
    expect(RTL.screen.getByRole('alertdialog')).toBeTruthy();
    click(RTL.screen.getByRole('button', { name: 'KEEP EDITING' }));
    expect(selected()).toBe('Event Details');
    expect((RTL.screen.getByPlaceholderText('MARIA & JOSE') as HTMLInputElement).value).toBe('CHANGED');
    expect(saved().events[0].name).toBe('WEDDING');
  });

  it('the event list offers a shortcut to Event Details while text is unsaved', () => {
    seed(); mount('events');
    click(tabNamed('Event Details'));
    RTL.fireEvent.change(RTL.screen.getByPlaceholderText('MARIA & JOSE'), { target: { value: 'CHANGED' } });
    click(tabNamed('Event List'));
    click(RTL.screen.getByRole('button', { name: 'GO TO EVENT DETAILS TO SAVE OR CANCEL' }));
    expect(selected()).toBe('Event Details');
  });

  it('a search result opens its own category AND tab, and clears the search', () => {
    seed(); mount('printer');
    RTL.fireEvent.change(RTL.screen.getByLabelText('Search settings'), { target: { value: 'wallpaper' } });
    const open = RTL.screen.getByRole('button', { name: 'OPEN STANDBY SCREEN' });
    click(open);
    expect(document.querySelector('.adm-nav [aria-current="page"]')?.textContent).toContain('Appearance');
    expect(selected()).toBe('Standby Screen');
    expect((RTL.screen.getByLabelText('Search settings') as HTMLInputElement).value).toBe('');
  });

  it('search never silently discards unsaved text: opening a result asks first', () => {
    seed(); mount('events');
    click(tabNamed('Event Details'));
    RTL.fireEvent.change(RTL.screen.getByPlaceholderText('MARIA & JOSE'), { target: { value: 'CHANGED' } });
    RTL.fireEvent.change(RTL.screen.getByLabelText('Search settings'), { target: { value: 'wallpaper' } });
    expect(RTL.screen.getByRole('alertdialog')).toBeTruthy(); // starting the search already asks
    click(RTL.screen.getByRole('button', { name: 'KEEP EDITING' }));
    expect((RTL.screen.getByLabelText('Search settings') as HTMLInputElement).value).toBe('');
    expect((RTL.screen.getByPlaceholderText('MARIA & JOSE') as HTMLInputElement).value).toBe('CHANGED');
  });
});
