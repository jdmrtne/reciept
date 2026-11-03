// @vitest-environment node
/**
 * Real taps against PREVIEW (copies stepper), PRINT (N copies, failure then RETRY) and SUCCESS (PRINT ANOTHER COPY).
 * Like standby.interaction.test.tsx these need a DOM, so they run only when `jsdom` and `@testing-library/react` are installed
 * (`npm i -D jsdom @testing-library/react @testing-library/dom`) and are SKIPPED otherwise. A skipped run is not a pass.
 * The renderer and the printer are replaced by fakes: what is checked is the screen logic (how many times the printer is asked, what is shown).
 */
import { createRequire } from 'module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionStore } from '../state/session';

const printCalls: number[] = [];
let failOnCall = 0; // 1-based call number that rejects once (0 = never)
vi.mock('../render/render', () => ({
  browserEnv: {}, canvasToBlob: async () => new Blob(['x']),
  renderPrint: async () => ({}), renderPreview: async () => ({})
}));
vi.mock('../render/orient', () => ({ forReading: (c: unknown) => c, isSideways: () => false }));
vi.mock('../print/browser', () => ({ bitmapToCanvas: () => ({}), canvasToRGBA: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }) }));
vi.mock('../qr/sessionQr', () => ({ frameQrForSession: () => null, qrErrorText: () => null }));
vi.mock('../autosave/autosave', () => ({ autoSaveSession: vi.fn() }));
vi.mock('../print', () => ({
  PRINTER_MESSAGES: { offline: { title: 'PRINTER OFFLINE', hint: 'Check the printer.' } },
  toPrinterError: () => ({ code: 'offline' }),
  toThermalBitmap: () => ({}),
  getPrinterManager: () => ({
    select: async () => undefined,
    print: async () => { printCalls.push(printCalls.length + 1); if (printCalls.length === failOnCall) { failOnCall = 0; throw new Error('usb'); } return { ok: true }; }
  })
}));

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (m: string): Promise<any> => import(/* @vite-ignore */ m);
const has = (m: string) => { try { req.resolve(m); return true; } catch { return false; } };
const available = has('jsdom') && has('@testing-library/react') && has('@testing-library/dom');
const KEY = 'booth.settings.v1';
const noop = () => {};

describe.skipIf(!available)('Copies: real interaction', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;
  let RTL: Any;
  let dom: Any;
  let PreviewScreen: typeof import('./PreviewScreen').PreviewScreen;
  let PrintScreen: typeof import('./PrintScreen').PrintScreen;
  let SuccessScreen: typeof import('./SuccessScreen').SuccessScreen;

  beforeAll(async () => {
    const { JSDOM } = await load('jsdom');
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
    const w = dom.window as unknown as Record<string, unknown>;
    for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'InputEvent', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      vi.stubGlobal(k, k === 'window' ? dom.window : w[k]);
    }
    (dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: noop }));
    RTL = await load('@testing-library/react');
    ({ PreviewScreen } = await import('./PreviewScreen'));
    ({ PrintScreen } = await import('./PrintScreen'));
    ({ SuccessScreen } = await import('./SuccessScreen'));
  });
  afterAll(async () => { RTL?.cleanup(); await new Promise((r) => setTimeout(r, 80)); vi.unstubAllGlobals(); dom?.window.close(); });
  beforeEach(() => { localStorage.clear(); sessionStore.reset(); printCalls.length = 0; failOnCall = 0; });
  afterEach(() => { RTL.cleanup(); sessionStore.reset(); });

  const withSession = (patch: Record<string, unknown> = {}) => sessionStore.update({
    editor: { past: [], future: [], initial: {}, present: { layoutId: 'single' } } as Any, stamp: { serial: '000001' } as Any, ...patch
  });
  const setMax = (maxCopies: number) => localStorage.setItem(KEY, JSON.stringify({ maxCopies }));
  const text = (t: string | RegExp) => RTL.screen.getByText(t);

  describe('PREVIEW stepper', () => {
    it('starts at 1 copy, + and − change the number, the button says how many', async () => {
      withSession();
      RTL.render(<PreviewScreen />);
      await RTL.waitFor(() => expect(RTL.screen.getByRole('button', { name: /^print$/i })).toBeTruthy());
      RTL.fireEvent.click(RTL.screen.getByLabelText('More copies')); RTL.fireEvent.click(RTL.screen.getByLabelText('More copies'));
      expect(RTL.screen.getByLabelText('Copies').textContent).toBe('3');
      expect(text('PRINT 3 COPIES')).toBeTruthy();
      RTL.fireEvent.click(RTL.screen.getByLabelText('Fewer copies'));
      expect(text('PRINT 2 COPIES')).toBeTruthy();
    });

    it('cannot go below 1 or above the owner maximum', async () => {
      setMax(3); withSession();
      RTL.render(<PreviewScreen />);
      const minus = RTL.screen.getByLabelText('Fewer copies'), plus = RTL.screen.getByLabelText('More copies');
      expect(minus.disabled).toBe(true);
      for (let i = 0; i < 6; i++) RTL.fireEvent.click(plus);
      expect(RTL.screen.getByLabelText('Copies').textContent).toBe('3');
      expect(plus.disabled).toBe(true);
    });

    it('is hidden when the owner allows only 1 copy', () => {
      setMax(1); withSession();
      RTL.render(<PreviewScreen />);
      expect(RTL.screen.queryByLabelText('More copies')).toBeNull();
    });

    it('PRINT stores the count, starts a fresh run and opens the print screen', async () => {
      withSession({ printed: 2, printReturn: 'success' });
      RTL.render(<PreviewScreen />);
      RTL.fireEvent.click(RTL.screen.getByLabelText('More copies'));
      const btn = await RTL.waitFor(() => { const b = RTL.screen.getByRole('button', { name: /print 2 copies/i }); expect(b.disabled).toBe(false); return b; });
      RTL.fireEvent.click(btn);
      expect(sessionStore.get()).toMatchObject({ screen: 'print', copies: 2, printed: 0, printReturn: null });
    });

    it('when the limit is already used up PRINT is off and the guest is told', async () => {
      withSession({ printedTotal: 10 });
      RTL.render(<PreviewScreen />);
      expect(text('COPY LIMIT REACHED')).toBeTruthy();
      await RTL.waitFor(() => expect(RTL.screen.getByRole('button', { name: /^print$/i }).disabled).toBe(true));
    });
  });

  describe('PRINT screen', () => {
    it('prints every copy once, counts them, then goes to the receipt screen', async () => {
      withSession({ copies: 3 });
      RTL.render(<PrintScreen />);
      await RTL.waitFor(() => expect(sessionStore.get().screen).toBe('success'), { timeout: 5000 });
      expect(printCalls).toHaveLength(3);
      expect(sessionStore.get()).toMatchObject({ printed: 3, printedTotal: 3 });
    });

    it('a failure on copy 2 stops, says 1 OF 3 printed, and RETRY prints only the 2 missing ones', async () => {
      withSession({ copies: 3 }); failOnCall = 2;
      RTL.render(<PrintScreen />);
      await RTL.waitFor(() => expect(text('PRINT FAILED')).toBeTruthy(), { timeout: 5000 });
      expect(sessionStore.get()).toMatchObject({ printed: 1, printedTotal: 1 });
      expect(text(/1 OF 3 COPIES PRINTED/)).toBeTruthy();
      RTL.fireEvent.click(RTL.screen.getByRole('button', { name: /retry/i }));
      await RTL.waitFor(() => expect(sessionStore.get().screen).toBe('success'), { timeout: 5000 });
      expect(printCalls).toHaveLength(4); // copy 1, copy 2 (failed), copy 2 again, copy 3: never a copy twice
      expect(sessionStore.get()).toMatchObject({ printed: 3, printedTotal: 3 });
    });

    it('PRINT ANOTHER COPY returns to the receipt screen, not through the whole flow', async () => {
      withSession({ copies: 1, printedTotal: 1, printReturn: 'success' });
      RTL.render(<PrintScreen />);
      await RTL.waitFor(() => expect(sessionStore.get().screen).toBe('success'), { timeout: 5000 });
      expect(printCalls).toHaveLength(1);
      expect(sessionStore.get()).toMatchObject({ printedTotal: 2, printReturn: null });
    });
  });

  describe('SUCCESS screen', () => {
    it('offers PRINT ANOTHER COPY after a print and starts a one-copy run', () => {
      withSession({ printedTotal: 1 });
      RTL.render(<SuccessScreen />);
      RTL.fireEvent.click(RTL.screen.getByRole('button', { name: /print another copy/i }));
      expect(sessionStore.get()).toMatchObject({ screen: 'print', copies: 1, printed: 0, printReturn: 'success' });
    });

    it('puts PRINT ANOTHER COPY below DONE, in one stacked group', () => {
      withSession({ printedTotal: 1 });
      const { container } = RTL.render(<SuccessScreen />);
      const group = container.querySelector('.done-actions')!;
      const labels = (Array.from(group.querySelectorAll('button')) as HTMLElement[]).map((b) => b.textContent);
      expect(labels).toEqual(['DONE', 'PRINT ANOTHER COPY']);
    });

    it('shows how many copies came out when more than one', () => {
      withSession({ printedTotal: 4 });
      RTL.render(<SuccessScreen />);
      expect(text('4 COPIES PRINTED')).toBeTruthy();
    });

    it('at the limit: no button, a plain notice instead', () => {
      withSession({ printedTotal: 10 });
      RTL.render(<SuccessScreen />);
      expect(RTL.screen.queryByRole('button', { name: /print another copy/i })).toBeNull();
      expect(text('COPY LIMIT REACHED')).toBeTruthy();
    });

    it('no button when nothing was printed in this session', () => {
      withSession({ printedTotal: 0 });
      RTL.render(<SuccessScreen />);
      expect(RTL.screen.queryByRole('button', { name: /print another copy/i })).toBeNull();
    });
  });
});
