import { PRINTER_CHANGED } from './autoconnect';
import { getPrinterManager } from './index';
import { toPrinterError, type PrinterErrorCode } from './errors';
import type { PrinterHealth, PrinterKind } from './types';

/**
 * One-tap "choose the USB printer again" for when the automatic reconnect (autoconnect.ts) cannot find it, e.g. the booth was shaken and
 * Chrome forgot which port the printer is on. Chrome only opens the USB chooser from a real tap, so this must be called straight from a click handler.
 */
export type ReconnectResult = { ok: true } | { ok: false; reason: 'cancelled' | 'unsupported' | 'unavailable' };

interface Reconnectable { pair(): Promise<void>; health(): Promise<PrinterHealth> }

export async function reconnectUsbPrinter(mgr: Reconnectable = getPrinterManager(), target: EventTarget | undefined = typeof window === 'undefined' ? undefined : window): Promise<ReconnectResult> {
  try { await mgr.pair(); } // opens Chrome's chooser; the chosen device is remembered for later launches
  catch (e) { return { ok: false, reason: toPrinterError(e).code === 'unsupported' ? 'unsupported' : 'cancelled' }; }
  const h = await mgr.health();
  target?.dispatchEvent(new Event(PRINTER_CHANGED));
  return h.level === 'offline' ? { ok: false, reason: 'unavailable' } : { ok: true };
}

/** Standby dot: offer the button only for a USB printer that is offline. */
export const canOfferReconnect = (kind: PrinterKind, level: PrinterHealth['level'] | undefined): boolean => kind === 'usb' && level === 'offline';

/** Print error screen: offer the button only for a USB printer and for failures a new connection can fix (not paper, not unsupported). */
const FIXABLE: readonly PrinterErrorCode[] = ['disconnected', 'connection-lost', 'unavailable'];
export const canOfferReconnectAfterError = (kind: PrinterKind, code: PrinterErrorCode | null): boolean => kind === 'usb' && !!code && FIXABLE.includes(code);
