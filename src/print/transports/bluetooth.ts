import { PrinterError } from '../errors';
import type { ByteTransport } from '../adapters/escpos-adapter';
import { withTimeout, sleep, type BtCharacteristic, type BtDeviceLike, type BtLike, type BtServer } from './web-types';

/**
 * GATT services that cheap ESC/POS printers commonly use. Web Bluetooth only exposes services listed at pairing time,
 * so this list must cover the printer. Add more here if a printer pairs but reports "no writable characteristic".
 */
export const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
];

/** First writable characteristic, preferring write-without-response (fast). Pure. */
export function pickWritable(chars: BtCharacteristic[]): BtCharacteristic | null {
  return chars.find((c) => c.properties.writeWithoutResponse) ?? chars.find((c) => c.properties.write) ?? null;
}

/**
 * Web Bluetooth (BLE GATT) byte pipe. NOTE: only BLE printers are reachable. A printer that is Bluetooth Classic
 * (SPP) only will never appear in the chooser. Long-lived pairing depends on `bluetooth.getDevices()` (Chrome-version dependent).
 */
export class WebBluetoothTransport implements ByteTransport {
  private device: BtDeviceLike | null = null;
  private server: BtServer | null = null;
  private char: BtCharacteristic | null = null;
  private lost = false;
  private readonly onLost = () => { this.lost = true; };
  constructor(private readonly bt: BtLike | undefined = (typeof navigator === 'undefined' ? undefined : (navigator as unknown as { bluetooth?: BtLike }).bluetooth)) {}

  get isOpen() { return !!this.char && !!this.server?.connected && !this.lost; }

  private api(): BtLike {
    if (!this.bt) throw new PrinterError('unsupported', 'Web Bluetooth is not available in this browser');
    return this.bt;
  }

  async pair(): Promise<void> {
    try { this.device = await this.api().requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES }); this.lost = false; }
    catch (e) { throw e instanceof PrinterError ? e : new PrinterError('disconnected', 'no printer chosen', e); }
  }

  async open(): Promise<void> {
    const bt = this.api();
    if (this.isOpen) return;
    try {
      let dev = this.device;
      if (!dev && bt.getDevices) dev = (await bt.getDevices()).find((d) => d.gatt) ?? null;
      if (!dev?.gatt) throw new PrinterError('disconnected', 'no paired Bluetooth printer — pair it in ADMIN');
      dev.removeEventListener('gattserverdisconnected', this.onLost);
      dev.addEventListener('gattserverdisconnected', this.onLost);
      const server = await withTimeout(dev.gatt.connect(), 12000, 'Bluetooth connect');
      let char: BtCharacteristic | null = null;
      for (const s of await server.getPrimaryServices()) { char = pickWritable(await s.getCharacteristics()); if (char) break; }
      if (!char) { server.disconnect(); throw new PrinterError('unsupported', 'no writable characteristic on this printer'); }
      this.device = dev; this.server = server; this.char = char; this.lost = false;
    } catch (e) {
      this.char = null;
      throw e instanceof PrinterError ? e : new PrinterError('unavailable', 'could not connect to Bluetooth printer', e);
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.isOpen) throw new PrinterError('disconnected');
    const c = this.char!, data = bytes.slice();
    for (let attempt = 0; ; attempt++) {
      try { await (c.properties.writeWithoutResponse ? c.writeValueWithoutResponse(data) : c.writeValueWithResponse(data)); return; }
      catch (e) { // "GATT operation already in progress" clears within a few ms; anything else (or a dropped link) is fatal
        if (attempt >= 5 || this.lost || !this.server?.connected) throw e;
        await sleep(15);
      }
    }
  }

  async close(): Promise<void> {
    this.char = null;
    this.device?.removeEventListener('gattserverdisconnected', this.onLost);
    try { this.server?.disconnect(); } catch { /* already gone */ }
    this.server = null;
  }
}
