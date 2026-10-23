// @vitest-environment node
/**
 * Phase 4: the real layout picker (CHOOSE YOUR STRIP) with real clicks: the four NCL boarding-pass layouts are listed, drawn landscape,
 * selectable, lock their own frame, and switching between them and ordinary layouts never throws or leaks the pass frame.
 *
 * Needs a DOM, which the project does not install by default: runs only when `jsdom` and `@testing-library/react` are present
 * (`npm i -D jsdom @testing-library/react @testing-library/dom`) and is SKIPPED otherwise. A skipped run is not a pass.
 */
import { createRequire } from 'module';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sessionStore } from '../state/session';
import { LAYOUTS, PASS_LAYOUTS, STANDARD_LAYOUTS } from '../layouts/registry';
import { PASS_FRAME_ID } from '../frames/registry';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (m: string): Promise<any> => import(/* @vite-ignore */ m);
const has = (m: string) => { try { req.resolve(m); return true; } catch { return false; } };
const available = has('jsdom') && has('@testing-library/react') && has('@testing-library/dom');

describe.skipIf(!available)('layout picker: NCL boarding-pass family, real clicks', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;
  let RTL: Any, dom: Any, LayoutScreen: typeof import('./Layout').Layout;
  const stubbed: string[] = [];

  beforeAll(async () => {
    const { JSDOM } = await load('jsdom');
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
    const w = dom.window as unknown as Record<string, unknown>;
    for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      vi.stubGlobal(k, k === 'window' ? dom.window : w[k]); stubbed.push(k);
    }
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    RTL = await load('@testing-library/react');
    ({ Layout: LayoutScreen } = await import('./Layout'));
  });
  afterAll(() => { vi.unstubAllGlobals(); dom?.window.close(); });
  afterEach(() => { RTL.cleanup(); sessionStore.reset(); });

  const cards = () => (RTL.screen.getAllByRole('button') as HTMLElement[]).filter((b) => b.className.includes('lay-card'));
  const label = (b: HTMLElement) => b.querySelector(':scope > span')?.textContent?.trim(); // not textContent: vector thumbnails contain SVG text
  const cardFor = (name: string) => { const c = cards().find((b) => label(b) === name.toUpperCase()); if (!c) throw new Error(`no card ${name}`); return c; };

  it('lists every layout, the four pass layouts last, after all six ordinary ones', () => {
    RTL.render(<LayoutScreen />);
    const names = cards().map(label);
    expect(names).toEqual(LAYOUTS.map((l) => l.name.toUpperCase()));
    expect(names.slice(0, 6)).toEqual(STANDARD_LAYOUTS.map((l) => l.name.toUpperCase()));
    expect(names.slice(-4)).toEqual(PASS_LAYOUTS.map((l) => l.name.toUpperCase()));
  });

  it('pass thumbnails are drawn LANDSCAPE (as the ticket is read); ordinary ones stay portrait or as before', () => {
    RTL.render(<LayoutScreen />);
    for (const l of PASS_LAYOUTS) {
      const vb = cardFor(l.name).querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
      expect(vb[2] / vb[3], `${l.id} thumbnail aspect`).toBeGreaterThan(2.2);
    }
    const single = cardFor('Single').querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
    expect(single[2] / single[3]).toBeLessThan(1);
  });

  it('tapping each pass card selects that layout with the NCL frame and goes to the camera', () => {
    for (const l of PASS_LAYOUTS) {
      sessionStore.reset();
      RTL.render(<LayoutScreen />);
      RTL.fireEvent.click(cardFor(l.name));
      const s = sessionStore.get();
      expect(s.layoutId, l.id).toBe(l.id);
      expect(s.frameId, l.id).toBe(PASS_FRAME_ID);
      expect(s.screen, l.id).toBe('camera');
      RTL.cleanup();
    }
  });

  it('switching pass -> ordinary -> pass -> pass never throws, and an ordinary layout never keeps the pass frame', () => {
    const seq = ['pass-4', 'single', 'pass-2', 'strip-3', 'pass-1', 'pass-3', 'classic', 'pass-4', 'grid-2x2'];
    for (const id of seq) {
      RTL.render(<LayoutScreen />);
      const l = LAYOUTS.find((x) => x.id === id)!;
      expect(() => RTL.fireEvent.click(cardFor(l.name)), id).not.toThrow();
      const s = sessionStore.get();
      expect(s.layoutId).toBe(id);
      if (id.startsWith('pass')) expect(s.frameId).toBe(PASS_FRAME_ID); else expect(s.frameId).not.toBe(PASS_FRAME_ID);
      RTL.cleanup();
    }
  });
});
