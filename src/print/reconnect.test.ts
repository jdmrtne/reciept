import { describe, expect, it } from 'vitest';
import { canOfferReconnect, canOfferReconnectAfterError, reconnectUsbPrinter } from './reconnect';
import { PRINTER_CHANGED } from './autoconnect';
import { PrinterError } from './errors';
import type { PrinterHealth } from './types';

const fake = (o: { pair?: () => Promise<void>; level?: PrinterHealth['level'] } = {}) => {
  const log: string[] = [];
  return {
    log,
    pair: async () => { log.push('pair'); await o.pair?.(); },
    health: async (): Promise<PrinterHealth> => { log.push('health'); return { level: o.level ?? 'ready' }; }
  };
};

describe('reconnectUsbPrinter (one-tap chooser)', () => {
  it('opens the chooser FIRST (needs the tap), then checks the printer and tells the UI', async () => {
    const m = fake(), target = new EventTarget(); let changed = 0;
    target.addEventListener(PRINTER_CHANGED, () => changed++);
    expect(await reconnectUsbPrinter(m, target)).toEqual({ ok: true });
    expect(m.log).toEqual(['pair', 'health']); expect(changed).toBe(1);
  });
  it('a cancelled chooser is a quiet "cancelled" (no health check, no error)', async () => {
    const m = fake({ pair: async () => { throw new PrinterError('disconnected', 'no printer chosen'); } });
    expect(await reconnectUsbPrinter(m, new EventTarget())).toEqual({ ok: false, reason: 'cancelled' });
    expect(m.log).toEqual(['pair']);
  });
  it('no WebUSB in this browser → unsupported', async () => {
    const m = fake({ pair: async () => { throw new PrinterError('unsupported'); } });
    expect(await reconnectUsbPrinter(m, new EventTarget())).toEqual({ ok: false, reason: 'unsupported' });
  });
  it('chosen but still cannot be opened (e.g. another app holds it) → unavailable', async () => {
    expect(await reconnectUsbPrinter(fake({ level: 'offline' }), new EventTarget())).toEqual({ ok: false, reason: 'unavailable' });
  });
  it('paper low / out still counts as reconnected (the printer answered)', async () => {
    expect(await reconnectUsbPrinter(fake({ level: 'attention' }), new EventTarget())).toEqual({ ok: true });
  });
});

describe('when the reconnect button is offered', () => {
  it('Standby: only a USB printer that is offline', () => {
    expect(canOfferReconnect('usb', 'offline')).toBe(true);
    expect(canOfferReconnect('usb', 'ready')).toBe(false);
    expect(canOfferReconnect('usb', 'attention')).toBe(false);
    expect(canOfferReconnect('usb', undefined)).toBe(false);
    for (const k of ['bluetooth', 'network', 'windows', 'system', 'mock'] as const) expect(canOfferReconnect(k, 'offline')).toBe(false);
  });
  it('print error: only USB and only connection-type failures (never paper, never unsupported)', () => {
    for (const c of ['disconnected', 'connection-lost', 'unavailable'] as const) expect(canOfferReconnectAfterError('usb', c)).toBe(true);
    for (const c of ['paper', 'failed', 'unsupported'] as const) expect(canOfferReconnectAfterError('usb', c)).toBe(false);
    expect(canOfferReconnectAfterError('usb', null)).toBe(false);
    expect(canOfferReconnectAfterError('bluetooth', 'disconnected')).toBe(false);
  });
});
