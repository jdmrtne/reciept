import { PrinterError } from '../errors';
import { bitmapToCanvas } from '../browser';
import type { AdapterJob, Bitmap1, PrinterAdapter, PrinterStatus } from '../types';

/**
 * Prints through the browser / Android print dialog, so ANY printer installed on the device works
 * (Android Print Service, CUPS, a Windows driver). The dialog needs a tap each time, so this suits setup and
 * bench testing more than an unattended kiosk. Raw ESC/POS (USB / Bluetooth) is the hands-free path.
 */
export class SystemPrinterAdapter implements PrinterAdapter {
  readonly kind = 'system' as const;
  readonly label = 'System print dialog';
  constructor(private readonly paperMm: () => number = () => 80) {}

  async connect(): Promise<void> {
    if (typeof window === 'undefined' || typeof window.print !== 'function') throw new PrinterError('unsupported', 'browser cannot print');
  }
  async disconnect(): Promise<void> {}
  async status(): Promise<PrinterStatus> { return { state: 'ready', detail: 'uses the system print dialog' }; }

  async print(bitmap: Bitmap1, job: AdapterJob): Promise<void> {
    const url = bitmapToCanvas(bitmap, 1).toDataURL('image/png');
    const mm = this.paperMm();
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc || !frame.contentWindow) { frame.remove(); throw new PrinterError('unavailable', 'no print frame'); }
    doc.open();
    doc.write(`<!doctype html><html><head><style>
      @page { size: ${mm}mm auto; margin: 0 }
      html, body { margin: 0; padding: 0; background: #fff }
      img { display: block; width: ${mm}mm; height: auto; image-rendering: pixelated }
    </style></head><body><img id="r" src="${url}" alt=""></body></html>`);
    doc.close();
    try {
      const img = doc.getElementById('r') as HTMLImageElement;
      if (!img.complete) await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('image failed to load')); });
      job.onProgress?.(0.5);
      const win = frame.contentWindow;
      await new Promise<void>((res) => {
        win.addEventListener('afterprint', () => res(), { once: true });
        win.focus(); win.print();
        setTimeout(res, 2000); // some Android WebViews never fire afterprint
      });
      job.onProgress?.(1);
    } catch (e) {
      throw e instanceof PrinterError ? e : new PrinterError('failed', 'print dialog failed', e);
    } finally { setTimeout(() => frame.remove(), 1000); }
  }
}
