import { PrinterError } from '../errors';
import type { ByteTransport } from '../adapters/escpos-adapter';
import { withTimeout, type UsbAlternate, type UsbDeviceLike, type UsbInterface, type UsbLike } from './web-types';

/** Interface classes Chrome refuses to let WebUSB claim. */
const PROTECTED = new Set([0x01, 0x03, 0x08, 0x0b, 0x0d, 0x0e, 0x10, 0xe0]);
const PRINTER_CLASS = 0x07;

interface Picked { iface: UsbInterface; alt: UsbAlternate; out: number; inn: number | null; config: number }

/** Finds where to write: prefer the printer-class interface, else any claimable interface with a bulk OUT endpoint. Pure. */
export function pickEndpoints(configs: UsbDeviceLike['configurations']): Picked | null {
  let fallback: Picked | null = null;
  for (const c of configs) for (const iface of c.interfaces) for (const alt of iface.alternates) {
    const out = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
    if (!out || PROTECTED.has(alt.interfaceClass)) continue;
    const inn = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in');
    const p = { iface, alt, out: out.endpointNumber, inn: inn ? inn.endpointNumber : null, config: c.configurationValue };
    if (alt.interfaceClass === PRINTER_CLASS) return p;
    fallback ??= p;
  }
  return fallback;
}

/**
 * WebUSB byte pipe (Chrome/Edge, Android needs a USB-OTG/host port). requestDevice() needs a user tap, so pairing
 * happens once in ADMIN (`pair()`); afterwards `open()` reuses the permission via getDevices() with no prompt.
 */
export class WebUsbTransport implements ByteTransport {
  private device: UsbDeviceLike | null = null;
  private picked: Picked | null = null;
  private lost = false;
  private readonly onDisconnect = (e: { device: UsbDeviceLike }) => { if (e.device === this.device) this.lost = true; };
  constructor(private readonly usb: UsbLike | undefined = (typeof navigator === 'undefined' ? undefined : (navigator as unknown as { usb?: UsbLike }).usb)) {}

  get isOpen() { return !!this.device?.opened && !!this.picked && !this.lost; }

  private api(): UsbLike {
    if (!this.usb) throw new PrinterError('unsupported', 'WebUSB is not available in this browser');
    return this.usb;
  }

  async pair(): Promise<void> {
    try { this.device = await this.api().requestDevice({ filters: [] }); this.lost = false; }
    catch (e) { throw e instanceof PrinterError ? e : new PrinterError('disconnected', 'no printer chosen', e); }
  }

  async open(): Promise<void> {
    const usb = this.api();
    if (this.isOpen) return;
    try {
      let dev = this.device;
      if (!dev) dev = (await usb.getDevices()).find((d) => pickEndpoints(d.configurations)) ?? null;
      if (!dev) throw new PrinterError('disconnected', 'no paired USB printer — pair it in ADMIN');
      const picked = pickEndpoints(dev.configurations);
      if (!picked) throw new PrinterError('unsupported', 'device has no writable printer interface');
      if (!dev.opened) await dev.open();
      if (!dev.configuration || dev.configuration.configurationValue !== picked.config) await dev.selectConfiguration(picked.config);
      await dev.claimInterface(picked.iface.interfaceNumber);
      if (picked.alt.alternateSetting !== 0) await dev.selectAlternateInterface(picked.iface.interfaceNumber, picked.alt.alternateSetting);
      usb.removeEventListener('disconnect', this.onDisconnect);
      usb.addEventListener('disconnect', this.onDisconnect);
      this.device = dev; this.picked = picked; this.lost = false;
    } catch (e) {
      this.picked = null;
      throw e instanceof PrinterError ? e : new PrinterError('unavailable', 'could not open USB printer', e);
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.isOpen) throw new PrinterError('disconnected');
    const r = await this.device!.transferOut(this.picked!.out, bytes.slice());
    if (r.status !== 'ok') throw new Error(`USB transfer ${r.status}`);
  }

  async read(count: number, timeoutMs: number): Promise<Uint8Array> {
    if (!this.isOpen || this.picked!.inn === null) throw new Error('no IN endpoint');
    const r = await withTimeout(this.device!.transferIn(this.picked!.inn, Math.max(64, count)), timeoutMs, 'status read');
    if (r.status !== 'ok' || !r.data || r.data.byteLength < count) throw new Error('no status data');
    return new Uint8Array(r.data.buffer, r.data.byteOffset, count).slice();
  }

  async close(): Promise<void> {
    const d = this.device, p = this.picked;
    this.picked = null;
    this.usb?.removeEventListener('disconnect', this.onDisconnect);
    if (!d) return;
    try { if (p && d.opened) await d.releaseInterface(p.iface.interfaceNumber); } catch { /* unplugged */ }
    try { if (d.opened) await d.close(); } catch { /* unplugged */ }
  }
}
