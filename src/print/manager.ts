import { PrinterError, toPrinterError } from './errors';
import { normalizeThermal, toThermalBitmap } from './pipeline';
import type { PrintOptions, PrintResult, PrinterAdapter, PrinterHealth, PrinterKind, PrinterStatus, RGBAImage } from './types';
import { encodeRaster } from './escpos';

export type AdapterFactory = () => PrinterAdapter;

/**
 * The ONLY thing the UI calls to print. Owns the selected adapter, runs the thermal pipeline on the
 * composition (never mutating it), connects if needed, and turns every failure into a PrinterError.
 */
export class PrinterManager {
  private adapter: PrinterAdapter | null = null;
  private inflight: Promise<PrintResult> | null = null;

  constructor(private readonly factories: Partial<Record<PrinterKind, AdapterFactory>>, private kind: PrinterKind) {}

  get selected(): PrinterKind { return this.kind; }
  /** Switching printer drops the old connection. */
  async select(kind: PrinterKind): Promise<void> {
    if (kind === this.kind && this.adapter) return;
    await this.adapter?.disconnect().catch(() => {});
    this.adapter = null; this.kind = kind;
  }
  /** Current adapter (created lazily). Exposed for diagnostics/tests, not for the print flow. */
  current(): PrinterAdapter {
    if (!this.adapter) {
      const make = this.factories[this.kind];
      if (!make) throw new PrinterError('unsupported', `no adapter for ${this.kind}`);
      this.adapter = make();
    }
    return this.adapter;
  }

  async status(): Promise<PrinterStatus> {
    try { return await this.current().status(); }
    catch (e) { return { state: 'error', detail: toPrinterError(e).code }; }
  }

  /**
   * Pre-flight check for the Standby dot. Connections are lazy (nothing opens until the first print), so a plain
   * `status()` would call every idle printer 'disconnected'. This quietly tries to open the link first (no chooser,
   * no tap needed; a printer that was never paired simply reads as offline). Never touches a print in flight, and
   * never opens the mock (so its simulated failures are kept for real prints).
   */
  async health(connectTimeoutMs = 4000): Promise<PrinterHealth> {
    if (this.inflight || this.kind === 'mock') return { level: 'ready' };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let st = await this.status();
      if (st.state === 'disconnected') {
        const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new PrinterError('unavailable', 'connect timed out')), connectTimeoutMs); });
        await Promise.race([this.current().connect(), timeout]);
        st = await this.status();
      }
      if (st.state === 'error') return { level: st.detail === 'paper' ? 'attention' : 'offline', detail: st.detail };
      if (st.state === 'disconnected') return { level: 'offline' };
      return st.detail === 'paper low' ? { level: 'attention', detail: st.detail } : { level: 'ready' };
    } catch {
      return { level: 'offline' };
    } finally { clearTimeout(timer); }
  }

  /** Owner pairing step (call from a tap). No-op for adapters that don't need it. */
  async pair(): Promise<void> {
    try { await this.current().pair?.(); } catch (e) { throw toPrinterError(e); }
  }

  /** Full pipeline + send. A second call while one is running returns the SAME job (a double tap never prints twice). */
  print(image: RGBAImage, options: PrintOptions): Promise<PrintResult> {
    if (this.inflight) return this.inflight;
    const job = this.run(image, options).finally(() => { this.inflight = null; });
    this.inflight = job;
    return job;
  }

  private async run(image: RGBAImage, o: PrintOptions): Promise<PrintResult> {
    const thermal = normalizeThermal(o.thermal);
    let bitmap;
    try { bitmap = toThermalBitmap(image, thermal, o.paperDots); }
    catch (e) { throw new PrinterError('failed', 'could not prepare image', e); }

    const send = async () => {
      const a = this.current();
      const st = await a.status();
      if (st.state !== 'ready') await a.connect();
      await a.print(bitmap, { thermal, onProgress: o.onProgress });
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new PrinterError('failed', 'print timed out')), o.timeoutMs ?? 60_000);
    });
    try { await Promise.race([send(), timeout]); }
    catch (e) {
      const err = toPrinterError(e);
      // A dead link must not be reused: drop the adapter's connection so RETRY reconnects.
      if (err.code === 'connection-lost' || err.message === 'print timed out') await this.adapter?.disconnect().catch(() => {});
      throw err;
    } finally { clearTimeout(timer); }
    return { bitmap, bytes: encodeRaster(bitmap, { feedLines: thermal.feedLines, cut: thermal.cut }).length };
  }
}
