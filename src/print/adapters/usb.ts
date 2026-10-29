import { EscPosAdapter, type EscPosAdapterOptions } from './escpos-adapter';
import { WebUsbTransport } from '../transports/usb';
import type { UsbLike } from '../transports/web-types';

/** USB printer over WebUSB. Large chunks, no pacing: USB applies its own flow control. */
export class USBPrinterAdapter extends EscPosAdapter {
  constructor(opts: EscPosAdapterOptions | (() => EscPosAdapterOptions) = { chunkSize: 16384 }, usb?: UsbLike) {
    super('usb', 'USB printer', new WebUsbTransport(usb), opts);
  }
}
