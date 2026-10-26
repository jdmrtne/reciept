// @vitest-environment node
/**
 * Real taps against the real STANDBY screen and the standby-photo card in ADMIN.
 * Like eventSection.interaction.test.tsx these need a DOM, so they run only when `jsdom` and `@testing-library/react` are installed
 * (`npm i -D jsdom @testing-library/react @testing-library/dom`) and are SKIPPED otherwise. A skipped run is not a pass.
 */
import { createRequire } from 'module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionStore } from '../state/session';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (m: string): Promise<any> => import(/* @vite-ignore */ m);
const has = (m: string) => { try { req.resolve(m); return true; } catch { return false; } };
const available = has('jsdom') && has('@testing-library/react') && has('@testing-library/dom');
const KEY = 'booth.settings.v1';
const noop = () => {};

describe.skipIf(!available)('Standby + standby photo: real interaction', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;
  let RTL: Any;
  let dom: Any;
  let Standby: typeof import('./Standby').Standby;
  let AdminPanel: typeof import('./admin/AdminPanel').AdminPanel;

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
    ({ Standby } = await import('./Standby'));
    ({ AdminPanel } = await import('./admin/AdminPanel'));
  });
  afterAll(async () => { RTL?.cleanup(); await new Promise((r) => setTimeout(r, 80)); /* let React's last scheduled work finish while `window` still exists */ vi.unstubAllGlobals(); dom?.window.close(); });
  beforeEach(() => { localStorage.clear(); sessionStore.reset(); });
  afterEach(() => { RTL.cleanup(); vi.restoreAllMocks(); sessionStore.reset(); });

  const zone = () => document.querySelector('.admin-zone') as HTMLElement;
  const tap = (el: Element, x = 500, y = 20) => RTL.fireEvent.pointerDown(el, { clientX: x, clientY: y });
  const saved = () => JSON.parse(localStorage.getItem(KEY)!);

  it('three quick taps on the top-right zone open ADMIN', () => {
    RTL.render(<Standby />);
    tap(zone()); tap(zone()); expect(sessionStore.get().screen).toBe('standby');
    tap(zone());
    expect(sessionStore.get().screen).toBe('admin');
  });

  it('one or two taps on the zone do NOT start a session (the tap never reaches the start button)', () => {
    RTL.render(<Standby />);
    tap(zone()); RTL.fireEvent.click(zone());
    tap(zone()); RTL.fireEvent.click(zone());
    expect(sessionStore.get().screen).toBe('standby');
  });

  it('a tap anywhere else still starts the session', () => {
    RTL.render(<Standby />);
    RTL.fireEvent.click(RTL.screen.getByLabelText('Tap to start'));
    expect(sessionStore.get().screen).toBe('layout');
  });

  it('taps spread over a long time or far apart never open ADMIN', () => {
    vi.useFakeTimers();
    try {
      RTL.render(<Standby />);
      tap(zone(), 10, 10); tap(zone(), 300, 300); tap(zone(), 10, 10);
      expect(sessionStore.get().screen).toBe('standby');
    } finally { vi.useRealTimers(); }
  });

  it('with a photo flagged on but no stored image, standby silently keeps the normal look and the zone still works', async () => {
    localStorage.setItem(KEY, JSON.stringify({ standbyPhoto: { enabled: true, fit: 'cover', showReceipt: false, version: 1 } }));
    RTL.render(<Standby />);
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector('.standby-photo')).toBeNull();
    expect(document.querySelector('.receipt')).not.toBeNull();
    tap(zone()); tap(zone()); tap(zone());
    expect(sessionStore.get().screen).toBe('admin');
  });

  it('REMOVE PHOTO (after confirming) turns the photo off and the saved settings say so', async () => {
    localStorage.setItem(KEY, JSON.stringify({ standbyPhoto: { enabled: true, fit: 'contain', showReceipt: false, version: 4 } }));
    RTL.render(<AdminPanel onChangePin={noop} initialSection="appearance" />);
    const btn = (name: string) => RTL.screen.getAllByRole('button').find((x: HTMLElement) => x.textContent?.replace(/\s+/g, ' ').trim() === name) as HTMLButtonElement;
    RTL.fireEvent.click(btn('REMOVE PHOTO'));
    expect(saved().standbyPhoto.enabled).toBe(true); // nothing happens until the owner confirms
    RTL.fireEvent.click(btn('REMOVE'));
    await RTL.waitFor(() => expect(saved().standbyPhoto).toMatchObject({ enabled: false, fit: 'contain', version: 5 }));
    expect(btn('UPLOAD PHOTO')).toBeTruthy();
  });
});
