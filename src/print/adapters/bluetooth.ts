import { EscPosAdapter, type EscPosAdapterOptions } from './escpos-adapter';
import { WebBluetoothTransport } from '../transports/bluetooth';
import type { BtLike } from '../transports/web-types';

/** Defaults for BLE printers: small chunks (ATT payload) and a pause so the printer's UART bridge isn't flooded. Tune in ADMIN. */
export const BLE_DEFAULTS = { chunkSize: 128, chunkDelayMs: 20 };

export class BluetoothPrinterAdapter extends EscPosAdapter {
  constructor(opts: EscPosAdapterOptions | (() => EscPosAdapterOptions) = BLE_DEFAULTS, bt?: BtLike) {
    super('bluetooth', 'Bluetooth printer', new WebBluetoothTransport(bt), opts);
  }
}
