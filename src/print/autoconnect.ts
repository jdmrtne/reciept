import { getPrinterManager } from './index';
import type { PrinterHealth } from './types';

/** Fired on `window` whenever an automatic check finished, so the Standby dot can refresh immediately. */
export const PRINTER_CHANGED = 'booth:printer-changed';

type PlugListener = () => void;
interface PlugSource { addEventListener(t: 'connect' | 'disconnect', l: PlugListener): void; removeEventListener(t: 'connect' | 'disconnect', l: PlugListener): void }
interface DocLike { readonly visibilityState: string; addEventListener(t: 'visibilitychange', l: () => void): void; removeEventListener(t: 'visibilitychange', l: () => void): void }
interface Checker { readonly selected: string; health(): Promise<PrinterHealth> }
export interface AutoConnectDeps {
  usb?: PlugSource; manager?: Checker; target?: EventTarget; doc?: DocLike;
  /** Wait after a plug event before opening (Android needs a moment to enumerate the device). */
  settleMs?: number; retryMs?: number;
}

/**
 * Keeps a USB printer connected without anyone tapping anything: tries at launch, when the printer is plugged in or unplugged,
 * and when the app comes back to the foreground. It only ever reuses a printer that was paired once in ADMIN (getDevices(), no chooser).
 * Does nothing unless PRINTER = USB. Never throws. Returns a stop function.
 */
export function startPrinterAutoConnect(d: AutoConnectDeps = {}): () => void {
  const usb = d.usb ?? (typeof navigator === 'undefined' ? undefined : (navigator as unknown as { usb?: PlugSource }).usb);
  const target = d.target ?? (typeof window === 'undefined' ? undefined : window);
  const doc = d.doc ?? (typeof document === 'undefined' ? undefined : document);
  const settleMs = d.settleMs ?? 600, retryMs = d.retryMs ?? 2000;
  let timer: ReturnType<typeof setTimeout> | undefined, stopped = false;

  const attempt = async (retries: number): Promise<void> => {
    if (stopped) return;
    try {
      const m = d.manager ?? getPrinterManager();
      if (m.selected !== 'usb') return;
      const h = await m.health();
      if (stopped) return;
      target?.dispatchEvent(new Event(PRINTER_CHANGED));
      if (h.level === 'offline' && retries > 0) timer = setTimeout(() => void attempt(retries - 1), retryMs);
    } catch { /* never interrupts the booth */ }
  };
  const soon = (retries: number) => { clearTimeout(timer); timer = setTimeout(() => void attempt(retries), settleMs); };

  const onPlug = () => soon(3);      // plugged in: keep trying for a few seconds while the OS finishes enumerating
  const onUnplug = () => soon(0);    // unplugged: just refresh the dot
  const onVisible = () => { if (doc?.visibilityState === 'visible') soon(2); };
  usb?.addEventListener('connect', onPlug);
  usb?.addEventListener('disconnect', onUnplug);
  doc?.addEventListener('visibilitychange', onVisible);
  soon(3); // launch

  return () => {
    stopped = true; clearTimeout(timer);
    usb?.removeEventListener('connect', onPlug); usb?.removeEventListener('disconnect', onUnplug);
    doc?.removeEventListener('visibilitychange', onVisible);
  };
}
