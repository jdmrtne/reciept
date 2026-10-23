// @vitest-environment node
/**
 * The real layout picker (CHOOSE YOUR STRIP) with real clicks. The six ordinary layouts are cards; the four NCL boarding-pass layouts are
 * ONE group card, "JLC 20th Anniv. Special", that opens a modal with the four passes (data-driven: layouts/groups.ts). Picking a pass
 * there behaves exactly as picking a layout did before; CLOSE / Escape / backdrop leave the session untouched; a session wipe closes it.
 *
 * Needs a DOM, which the project does not install by default: runs only when `jsdom` and `@testing-library/react` are present
 * (`npm i -D jsdom @testing-library/react @testing-library/dom`) and is SKIPPED otherwise. A skipped run is not a pass.
 */
import { createRequire } from 'module';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sessionStore } from '../state/session';
import { LAYOUTS, NCL_GROUP, PASS_LAYOUTS, STANDARD_LAYOUTS } from '../layouts/registry';
import { PASS_FRAME_ID } from '../frames/registry';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (m: string): Promise<any> => import(/* @vite-ignore */ m);
const has = (m: string) => { try { req.resolve(m); return true; } catch { return false; } };
const available = has('jsdom') && has('@testing-library/react') && has('@testing-library/dom');

const GROUP_NAME = 'JLC 20th Anniv. Special';

describe.skipIf(!available)('layout picker: ordinary cards + the JLC 20th Anniv. Special group modal, real clicks', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;
  let RTL: Any, dom: Any, LayoutScreen: typeof import('./Layout').Layout, AppRoot: typeof import('../App').default;

  beforeAll(async () => {
    const { JSDOM } = await load('jsdom');
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
    const w = dom.window as unknown as Record<string, unknown>;
    for (const k of ['window', 'document', 'navigator', 'localStorage', 'location', 'history', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      vi.stubGlobal(k, k === 'window' ? dom.window : w[k]);
    }
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    RTL = await load('@testing-library/react');
    ({ Layout: LayoutScreen } = await import('./Layout'));
    ({ default: AppRoot } = await import('../App'));
  });
  afterAll(() => { vi.unstubAllGlobals(); dom?.window.close(); });
  afterEach(() => { RTL.cleanup(); sessionStore.reset(); });

  const label = (b: HTMLElement) => b.querySelector(':scope > span')?.textContent?.trim(); // not textContent: vector thumbnails contain SVG text
  const dialog = (): HTMLElement | null => RTL.screen.queryByRole('dialog');
  const inDialog = (b: HTMLElement) => b.closest('[role="dialog"]') !== null;
  const allCards = () => (RTL.screen.getAllByRole('button') as HTMLElement[]).filter((b) => b.className.includes('lay-card'));
  const gridCards = () => allCards().filter((b) => !inDialog(b));
  const modalCards = () => allCards().filter(inDialog);
  const groupCard = () => { const c = gridCards().find((b) => label(b) === GROUP_NAME); if (!c) throw new Error('no group card'); return c; };
  const gridCard = (name: string) => { const c = gridCards().find((b) => label(b) === name.toUpperCase()); if (!c) throw new Error(`no card ${name}`); return c; };
  const modalCard = (name: string) => { const c = modalCards().find((b) => label(b) === name.toUpperCase()); if (!c) throw new Error(`no modal card ${name}`); return c; };
  const closeBtn = (): HTMLElement => RTL.within(dialog()!).getByRole('button', { name: /close/i });
  const openModal = () => RTL.fireEvent.click(groupCard());
  const active = () => dom.window.document.activeElement as HTMLElement | null;
  const aspect = (b: HTMLElement) => { const vb = b.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number); return vb[2] / vb[3]; };
  const untouched = () => { const s = sessionStore.get(); expect([s.layoutId, s.frameId, s.screen]).toEqual([null, null, 'standby']); };
  /** Pick a layout the way a customer does: pass layouts through the group modal, the rest straight from the grid. */
  const pick = (id: string) => {
    const l = LAYOUTS.find((x) => x.id === id)!;
    if (l.group) { openModal(); RTL.fireEvent.click(modalCard(l.name)); } else RTL.fireEvent.click(gridCard(l.name));
  };

  describe('main grid', () => {
    it('shows the 6 ordinary layouts in order, then ONE group card; no pass layout is a separate card', () => {
      RTL.render(<LayoutScreen />);
      const names = gridCards().map(label);
      expect(names).toHaveLength(7);
      expect(names.slice(0, 6)).toEqual(STANDARD_LAYOUTS.map((l) => l.name.toUpperCase()));
      expect(names[6]).toBe(GROUP_NAME);
      for (const l of PASS_LAYOUTS) expect(names, l.id).not.toContain(l.name.toUpperCase());
      expect(NCL_GROUP.name).toBe(GROUP_NAME);
      expect(dialog()).toBeNull();
    });
    it('thumbnails: ordinary stay as before, the group card previews a (landscape) pass ticket', () => {
      RTL.render(<LayoutScreen />);
      expect(aspect(gridCard('Single'))).toBeLessThan(1);
      expect(aspect(groupCard())).toBeGreaterThan(2.2);
    });
    it('clicking an ordinary layout still selects it, goes to the camera, and never leaks the pass frame', () => {
      for (const l of STANDARD_LAYOUTS) {
        sessionStore.reset();
        RTL.render(<LayoutScreen />);
        RTL.fireEvent.click(gridCard(l.name));
        const s = sessionStore.get();
        expect([s.layoutId, s.screen], l.id).toEqual([l.id, 'camera']);
        expect(s.frameId, l.id).not.toBe(PASS_FRAME_ID);
        RTL.cleanup();
      }
    });
  });

  describe('group modal', () => {
    it('opens on the group card: role=dialog, aria-modal, aria-label, four pass cards with photo counts; session untouched', () => {
      RTL.render(<LayoutScreen />);
      openModal();
      const d = dialog()!;
      expect(d).not.toBeNull();
      expect(d.getAttribute('aria-modal')).toBe('true');
      expect(d.getAttribute('aria-label')).toBe(GROUP_NAME);
      expect(modalCards().map(label)).toEqual(PASS_LAYOUTS.map((l) => l.name.toUpperCase()));
      expect(modalCards().map((b) => b.querySelector('.lay-sub')?.textContent)).toEqual(['1 PHOTO', '2 PHOTOS', '3 PHOTOS', '4 PHOTOS']);
      for (const b of modalCards()) expect(aspect(b)).toBeGreaterThan(2.2);
      untouched();
    });
    it('moves focus into the dialog, locks page scroll, and releases the lock on close', () => {
      RTL.render(<LayoutScreen />);
      openModal();
      expect(dialog()!.contains(active())).toBe(true);
      expect(dom.window.document.body.style.overflow).toBe('hidden');
      RTL.fireEvent.click(closeBtn());
      expect(dom.window.document.body.style.overflow).toBe('');
    });
    it('tapping each pass card sets layoutId, the NCL frame and screen "camera", and closes the dialog', () => {
      for (const l of PASS_LAYOUTS) {
        sessionStore.reset();
        RTL.render(<LayoutScreen />);
        openModal();
        RTL.fireEvent.click(modalCard(l.name));
        const s = sessionStore.get();
        expect(s.layoutId, l.id).toBe(l.id);
        expect(s.frameId, l.id).toBe(PASS_FRAME_ID);
        expect(s.screen, l.id).toBe('camera');
        expect(dialog(), `${l.id} dialog closed`).toBeNull();
        expect(dom.window.document.body.style.overflow).toBe('');
        RTL.cleanup();
      }
    });
    it('CLOSE returns to the grid with the session untouched, and focus goes back to the group card', () => {
      RTL.render(<LayoutScreen />);
      openModal();
      RTL.fireEvent.click(closeBtn());
      expect(dialog()).toBeNull();
      untouched();
      expect(active()).toBe(groupCard());
    });
    it('Escape closes it, session untouched, focus back on the group card', () => {
      RTL.render(<LayoutScreen />);
      openModal();
      RTL.fireEvent.keyDown(dialog()!, { key: 'Escape' });
      expect(dialog()).toBeNull();
      untouched();
      expect(active()).toBe(groupCard());
    });
    it('a backdrop tap closes it; a tap inside the card does not', () => {
      RTL.render(<LayoutScreen />);
      openModal();
      RTL.fireEvent.click(RTL.within(dialog()!).getByRole('heading'));
      expect(dialog()).not.toBeNull();
      RTL.fireEvent.click(dialog()!.parentElement!); // .modal-back
      expect(dialog()).toBeNull();
      untouched();
    });
    it('a drag that starts inside the card and is released on the backdrop does not close it', () => {
      RTL.render(<LayoutScreen />);
      openModal();
      RTL.fireEvent.pointerDown(RTL.within(dialog()!).getByRole('heading'));
      RTL.fireEvent.click(dialog()!.parentElement!);
      expect(dialog()).not.toBeNull();
    });
    it('traps focus: Tab on the last control wraps to the first, Shift+Tab on the first wraps to the last, a stray focus is pulled back', () => {
      RTL.render(<LayoutScreen />);
      openModal();
      const first = closeBtn(), last = modalCards()[3];
      last.focus();
      RTL.fireEvent.keyDown(last, { key: 'Tab' });
      expect(active()).toBe(first);
      RTL.fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
      expect(active()).toBe(last);
      groupCard().focus();
      RTL.fireEvent.keyDown(groupCard(), { key: 'Tab' });
      expect(dialog()!.contains(active())).toBe(true);
    });
    it('switching pass -> ordinary -> pass -> pass never throws; ordinary layouts never keep the pass frame', () => {
      for (const id of ['pass-4', 'single', 'pass-2', 'strip-3', 'pass-1', 'pass-3', 'classic', 'pass-4', 'grid-2x2']) {
        RTL.render(<LayoutScreen />);
        expect(() => pick(id), id).not.toThrow();
        const s = sessionStore.get();
        expect(s.layoutId).toBe(id);
        if (id.startsWith('pass')) expect(s.frameId).toBe(PASS_FRAME_ID); else expect(s.frameId).not.toBe(PASS_FRAME_ID);
        RTL.cleanup();
      }
    });
  });

  describe('current selection (customer came back from camera / edit)', () => {
    it('a pass layout in the session: the group card looks selected and the modal highlights exactly that layout', () => {
      sessionStore.update({ layoutId: 'pass-3', frameId: PASS_FRAME_ID });
      RTL.render(<LayoutScreen />);
      expect(groupCard().className).toContain('on');
      expect(groupCard().getAttribute('aria-current')).toBe('true');
      expect(gridCards().filter((b) => b !== groupCard() && b.className.includes(' on'))).toHaveLength(0);
      openModal();
      expect(modalCards().filter((b) => b.className.includes(' on')).map(label)).toEqual(['NCL PASS 3']);
      expect(modalCards().filter((b) => b.getAttribute('aria-current') === 'true').map(label)).toEqual(['NCL PASS 3']);
      RTL.fireEvent.click(closeBtn());
      expect(sessionStore.get().layoutId).toBe('pass-3'); // closing keeps the existing choice
    });
    it('an ordinary layout (or none) in the session: the group card is not selected', () => {
      RTL.render(<LayoutScreen />);
      expect(groupCard().className).not.toContain(' on');
      RTL.cleanup();
      sessionStore.update({ layoutId: 'strip-3' });
      RTL.render(<LayoutScreen />);
      expect(groupCard().className).not.toContain(' on');
    });
  });

  describe('inactivity', () => {
    it('a session wipe (what useInactivity calls) closes an open modal and releases the scroll lock', () => {
      RTL.render(<AppRoot />);
      RTL.act(() => sessionStore.update({ screen: 'layout' }));
      openModal();
      expect(dialog()).not.toBeNull();
      RTL.act(() => sessionStore.reset());
      expect(dialog()).toBeNull();
      expect(sessionStore.get().screen).toBe('standby');
      expect(dom.window.document.body.style.overflow).toBe('');
    });
    it('taps and keys inside the modal still reach window, so the idle timer sees a busy customer', () => {
      RTL.render(<LayoutScreen />);
      openModal();
      const seen: string[] = [];
      const on = (e: Event) => seen.push(e.type);
      for (const t of ['pointerdown', 'keydown']) dom.window.addEventListener(t, on);
      RTL.fireEvent.pointerDown(modalCards()[0]);
      RTL.fireEvent.keyDown(modalCards()[0], { key: 'ArrowRight' });
      for (const t of ['pointerdown', 'keydown']) dom.window.removeEventListener(t, on);
      expect(seen).toEqual(['pointerdown', 'keydown']);
    });
  });
});
