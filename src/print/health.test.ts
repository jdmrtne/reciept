import { describe, expect, it } from 'vitest';
import { PrinterManager } from './manager';
import { PrinterError } from './errors';
import { MockPrinterAdapter } from './adapters/mock';
import { DEFAULT_THERMAL, type PrinterAdapter, type PrinterKind, type PrinterStatus, type RGBAImage } from './types';

/** Minimal adapter: starts closed, connect() opens (or throws), status() is scripted once open. */
function stub(o: { connect?: () => Promise<void>; open?: PrinterStatus; kind?: PrinterKind } = {}) {
  let connected = false, connects = 0;
  const a: PrinterAdapter & { connects: () => number } = {
    kind: o.kind ?? 'usb', label: 'stub',
    connects: () => connects,
    async connect() { connects++; if (o.connect) await o.connect(); connected = true; },
    async disconnect() { connected = false; },
    async status() { return connected ? (o.open ?? { state: 'ready' }) : { state: 'disconnected' }; },
    async print() {}
  };
  return a;
}
const mgr = (a: PrinterAdapter, kind: PrinterKind = 'usb') => new PrinterManager({ [kind]: () => a }, kind);

describe('PrinterManager.health (Standby dot)', () => {
  it('an idle but reachable printer is ready (lazy connect must not read as offline)', async () => {
    const a = stub();
    expect(await mgr(a).health()).toEqual({ level: 'ready' });
    expect(a.connects()).toBe(1);
  });
  it('a printer that cannot be opened is offline', async () => {
    const a = stub({ connect: async () => { throw new PrinterError('unavailable'); } });
    expect((await mgr(a).health()).level).toBe('offline');
  });
  it('a hanging connect gives up and reads offline', async () => {
    const a = stub({ connect: () => new Promise(() => {}) });
    expect((await mgr(a).health(30)).level).toBe('offline');
  });
  it('paper low / paper out need attention; other reported errors are offline', async () => {
    expect(await mgr(stub({ open: { state: 'ready', detail: 'paper low' } })).health()).toEqual({ level: 'attention', detail: 'paper low' });
    expect((await mgr(stub({ open: { state: 'error', detail: 'paper' } })).health()).level).toBe('attention');
    expect((await mgr(stub({ open: { state: 'error', detail: 'connection-lost' } })).health()).level).toBe('offline');
  });
  it('the mock is always ready and is never opened, so its simulated failures survive for real prints', async () => {
    const m = new MockPrinterAdapter({ stepMs: 0, failures: ['unavailable'] });
    expect(await mgr(m, 'mock').health()).toEqual({ level: 'ready' });
    await expect(m.status()).resolves.toMatchObject({ state: 'disconnected' });
  });
  it('does not touch the printer while a print is in flight', async () => {
    let release!: () => void;
    const a = stub(); a.print = () => new Promise<void>((r) => { release = r; });
    const m = mgr(a), img: RGBAImage = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(255) };
    const job = m.print(img, { thermal: DEFAULT_THERMAL, paperDots: 8 });
    await new Promise((r) => setTimeout(r, 0));
    const before = a.connects();
    expect(await m.health()).toEqual({ level: 'ready' });
    expect(a.connects()).toBe(before);
    release(); await job;
  });
});
