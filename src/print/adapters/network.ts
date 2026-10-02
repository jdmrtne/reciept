import { EscPosAdapter, type EscPosAdapterOptions } from './escpos-adapter';
import { HttpBridgeTransport, type NetworkOptions } from '../transports/bridge';

/** Network (LAN/Wi-Fi) ESC/POS printer via the local print bridge. One POST per job: no chunking or pacing needed. */
export class NetworkPrinterAdapter extends EscPosAdapter {
  constructor(opts: () => NetworkOptions, escpos: EscPosAdapterOptions = { chunkSize: 64 * 1024 * 1024 }, fetcher?: ConstructorParameters<typeof HttpBridgeTransport>[1]) {
    super('network', 'Network printer', new HttpBridgeTransport(opts, fetcher), escpos);
  }
}
