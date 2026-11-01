import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRINTER_CHANGED, startPrinterAutoConnect } from './autoconnect';
import type { PrinterHealth } from './types';

type L = () => void;
class FakePlug {
  l: Record<string, L[]> = { connect: [], disconnect: [] };
  addEventListener(t: 'connect' | 'disconnect', f: L) { this.l[t].push(f); }
  removeEventListener(t: 'connect' | 'disconnect', f: L) { this.l[t] = this.l[t].filter((x) => x !== f); }
  fire(t: 'connect' | 'disconnect') { this.l[t].forEach((f) => f()); }
}
class FakeDoc {
  visibilityState: 'visible' | 'hidden' = 'visible'; fs: L[] = [];
  addEventListener(_t: 'visibilitychange', f: L) { this.fs.push(f); }
  removeEventListener(_t: 'visibilitychange', f: L) { this.fs = this.fs.filter((x) => x !== f); }
  fire() { this.fs.forEach((f) => f()); }
}
const setup = (selected = 'usb', levels: PrinterHealth['level'][] = ['ready']) => {
  const usb = new FakeUsbLike(), doc = new FakeDoc(), target = new EventTarget();
  let calls = 0, announced = 0;
  target.addEventListener(PRINTER_CHANGED, () => announced++);
  const manager = { selected, health: async (): Promise<PrinterHealth> => ({ level: levels[Math.min(calls++, levels.length - 1)] }) };
  const stop = startPrinterAutoConnect({ usb, doc, target, manager, settleMs: 10, retryMs: 50 });
  return { usb, doc, stop, calls: () => calls, announced: () => announced };
};
const FakeUsbLike = FakePlug;
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('startPrinterAutoConnect', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('checks once at launch and tells the UI', async () => {
    const t = setup(); await tick(20);
    expect(t.calls()).toBe(1); expect(t.announced()).toBe(1); t.stop();
  });
  it('plugging the printer in connects again (after a short settle) and refreshes the dot', async () => {
    const t = setup(); await tick(20);
    t.usb.fire('connect'); await tick(5); expect(t.calls()).toBe(1); // still settling
    await tick(20); expect(t.calls()).toBe(2); expect(t.announced()).toBe(2); t.stop();
  });
  it('unplugging refreshes the dot once and does not keep retrying', async () => {
    const t = setup('usb', ['offline']); await tick(1000); // launch + 3 retries, then quiet
    const before = t.calls();
    t.usb.fire('disconnect'); await tick(1000);
    expect(t.calls() - before).toBe(1); t.stop();
  });
  it('an offline printer is retried a few times, then it stops (no endless loop)', async () => {
    const t = setup('usb', ['offline']); await tick(1000);
    expect(t.calls()).toBe(4); // launch + 3 retries
    t.stop();
  });
  it('retrying stops as soon as the printer is ready', async () => {
    const t = setup('usb', ['offline', 'ready']); await tick(1000);
    expect(t.calls()).toBe(2); t.stop();
  });
  it('coming back to the foreground re-checks; going to the background does not', async () => {
    const t = setup(); await tick(20);
    t.doc.visibilityState = 'hidden'; t.doc.fire(); await tick(100); expect(t.calls()).toBe(1);
    t.doc.visibilityState = 'visible'; t.doc.fire(); await tick(100); expect(t.calls()).toBe(2); t.stop();
  });
  it('does nothing when the selected printer is not USB', async () => {
    const t = setup('bluetooth'); await tick(20); t.usb.fire('connect'); await tick(100);
    expect(t.calls()).toBe(0); expect(t.announced()).toBe(0); t.stop();
  });
  it('stop() removes every listener and cancels pending work', async () => {
    const t = setup(); t.stop(); await tick(100);
    t.usb.fire('connect'); t.doc.fire(); await tick(100);
    expect(t.calls()).toBe(0); expect(t.usb.l.connect.length + t.usb.l.disconnect.length + t.doc.fs.length).toBe(0);
  });
  it('works without WebUSB (iOS/desktop Safari): no throw, no listeners', async () => {
    const stop = startPrinterAutoConnect({ usb: undefined, doc: new FakeDoc(), target: new EventTarget(), manager: { selected: 'usb', health: async () => ({ level: 'offline' as const }) }, settleMs: 1, retryMs: 1 });
    await tick(20); stop();
  });
});
