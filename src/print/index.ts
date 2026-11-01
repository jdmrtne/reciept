import { loadSettings } from '../config/settings';
import { MockPrinterAdapter } from './adapters/mock';
import { NetworkPrinterAdapter } from './adapters/network';
import { USBPrinterAdapter } from './adapters/usb';
import { BluetoothPrinterAdapter } from './adapters/bluetooth';
import { SystemPrinterAdapter } from './adapters/system';
import { WindowsPrinterAdapter } from './adapters/windows';
import { PrinterManager } from './manager';

export * from './types';
export * from './errors';
export { PrinterManager } from './manager';
export { toThermalBitmap, normalizeThermal } from './pipeline';

let manager: PrinterManager | null = null;
/** App-wide manager, built from BoothSettings on first use (the mock's simulated failures live for the page's lifetime). */
export function getPrinterManager(): PrinterManager {
  if (!manager) {
    const s = loadSettings();
    manager = new PrinterManager({
      mock: () => new MockPrinterAdapter({ failures: s.mockFailures }),
      // options are read lazily so ADMIN changes to chunk size/delay apply without a reload
      bluetooth: () => new BluetoothPrinterAdapter(() => loadSettings().bluetooth),
      usb: () => new USBPrinterAdapter(),
      windows: () => new WindowsPrinterAdapter(() => ({ bridgeUrl: loadSettings().network.bridgeUrl, printer: loadSettings().windowsPrinter })),
      system: () => new SystemPrinterAdapter(() => loadSettings().paperWidthMm),
      network: () => new NetworkPrinterAdapter(() => loadSettings().network)
    }, s.printer);
  }
  return manager;
}
