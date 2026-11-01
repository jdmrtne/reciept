import { EscPosAdapter, type EscPosAdapterOptions } from './escpos-adapter';
import { HttpBridgeTransport, type NetworkOptions } from '../transports/bridge';

/** A printer installed in Windows (USB or otherwise), fed raw ESC/POS through the print bridge: no print dialog, no driver swap. */
export class WindowsPrinterAdapter extends EscPosAdapter {
  constructor(opts: () => NetworkOptions, escpos: EscPosAdapterOptions = { chunkSize: 64 * 1024 * 1024 }, fetcher?: ConstructorParameters<typeof HttpBridgeTransport>[1]) {
    super('windows', 'Windows printer', new HttpBridgeTransport(opts, fetcher), escpos);
  }
}
