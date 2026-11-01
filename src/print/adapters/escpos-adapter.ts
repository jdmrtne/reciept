import { PrinterError } from '../errors';
import { encodeRaster, DEFAULT_BAND_ROWS } from '../escpos';
import { interpretStatus, STATUS_QUERY, type StatusBytes, type StatusReading } from '../status';
import type { AdapterJob, Bitmap1, PrinterAdapter, PrinterKind, PrinterStatus } from '../types';

/** The only thing that differs between Bluetooth / USB / network: how bytes reach the printer. */
export interface ByteTransport {
  readonly isOpen: boolean;
  open(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /** Optional. Read `count` bytes back within `timeoutMs` (rejects on timeout). Enables real printer status (paper out, cover open). */
  read?(count: number, timeoutMs: number): Promise<Uint8Array>;
  /** Optional. One-time user-gesture step that grants access to the device (USB/Bluetooth chooser). */
  pair?(): Promise<void>;
}

export interface EscPosAdapterOptions {
  chunkSize?: number; bandRows?: number; statusTimeoutMs?: number;
  /** Pause after each chunk. Cheap Bluetooth bridges feed the printer over a slow UART and drop data if flooded. */
  chunkDelayMs?: number;
}

/**
 * Shared ESC/POS adapter: encodes the bitmap and streams it over any ByteTransport.
 * Phase 10 implements a transport per connection type; this class (and its error mapping) is already tested.
 */
export class EscPosAdapter implements PrinterAdapter {
  constructor(
    readonly kind: PrinterKind,
    readonly label: string,
    private readonly transport: ByteTransport,
    private readonly optsIn: EscPosAdapterOptions | (() => EscPosAdapterOptions) = {}
  ) {}

  private get opts(): EscPosAdapterOptions { return typeof this.optsIn === 'function' ? this.optsIn() : this.optsIn; }

  async pair(): Promise<void> { await this.transport.pair?.(); }

  async connect(): Promise<void> {
    if (this.transport.isOpen) return;
    try { await this.transport.open(); }
    catch (e) { throw e instanceof PrinterError ? e : new PrinterError('unavailable', 'could not open printer', e); }
  }

  async disconnect(): Promise<void> {
    try { await this.transport.close(); } catch { /* already gone */ }
  }

  /** Asks the printer for real-time status. Silent printers (no read support / no answer) give `unknown`, never an error. */
  async readStatus(): Promise<StatusReading> {
    const t = this.transport, got: StatusBytes = {};
    if (!t.read || !t.isOpen) return interpretStatus(got);
    for (const [key, q] of Object.entries(STATUS_QUERY) as [keyof StatusBytes, readonly number[]][]) {
      try { await t.write(Uint8Array.from(q)); got[key] = (await t.read(1, this.opts.statusTimeoutMs ?? 300))[0]; } catch { /* no answer */ }
    }
    return interpretStatus(got);
  }

  async status(): Promise<PrinterStatus> {
    if (!this.transport.isOpen) return { state: 'disconnected' };
    const r = await this.readStatus();
    return r.error ? { state: 'error', detail: r.error } : { state: 'ready', detail: r.nearEnd ? 'paper low' : undefined };
  }

  async print(bitmap: Bitmap1, job: AdapterJob): Promise<void> {
    if (!this.transport.isOpen) throw new PrinterError('disconnected');
    const st = await this.readStatus(); // blocks on a REPORTED problem (paper out, cover open) so we never burn a job into nothing
    if (st.error) throw new PrinterError(st.error);
    const bytes = encodeRaster(bitmap, { bandRows: this.opts.bandRows ?? DEFAULT_BAND_ROWS, feedLines: job.thermal.feedLines, cut: job.thermal.cut });
    const size = Math.max(1, this.opts.chunkSize ?? 4096), delay = this.opts.chunkDelayMs ?? 0;
    try {
      for (let i = 0; i < bytes.length; i += size) {
        await this.transport.write(bytes.subarray(i, i + size));
        job.onProgress?.(Math.min(1, (i + size) / bytes.length));
        if (delay && i + size < bytes.length) await new Promise((r) => setTimeout(r, delay));
      }
    } catch (e) {
      await this.disconnect(); // next attempt must reconnect from scratch
      throw e instanceof PrinterError ? e : new PrinterError('connection-lost', 'write failed', e);
    }
  }
}
