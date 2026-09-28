import { PrinterError, type PrinterErrorCode } from '../errors';
import { decodeRaster, encodeRaster } from '../escpos';
import type { AdapterJob, Bitmap1, PrinterAdapter, PrinterStatus } from '../types';

export interface MockOptions {
  /** Delay per simulated step; 0 in tests. Default gives a visible ~1.5 s "print". */
  stepMs?: number;
  steps?: number;
  /** Errors to throw on the next print attempts, in order (then it works). Lets the UI show error + RETRY without hardware. */
  failures?: PrinterErrorCode[];
}

export interface MockJob { bitmap: Bitmap1; bytes: number; feedLines: number; cut: boolean }

/**
 * Pretends to be a thermal printer. It goes through the REAL encoder: the bitmap is encoded to ESC/POS bytes
 * and decoded back, so what it "prints" (lastJob.bitmap) is exactly what a printer would receive.
 */
export class MockPrinterAdapter implements PrinterAdapter {
  readonly kind = 'mock' as const;
  readonly label = 'Test printer (nothing is printed)';
  private connected = false;
  private queue: PrinterErrorCode[];
  readonly jobs: MockJob[] = [];
  constructor(private readonly o: MockOptions = {}) { this.queue = [...(o.failures ?? [])]; }

  get lastJob(): MockJob | undefined { return this.jobs[this.jobs.length - 1]; }
  /** Make the next print attempt fail with `code` (stackable). */
  failNext(code: PrinterErrorCode) { this.queue.push(code); }

  async connect() {
    if (this.queue[0] === 'unavailable' || this.queue[0] === 'unsupported') throw new PrinterError(this.queue.shift()!);
    this.connected = true;
  }
  async disconnect() { this.connected = false; }
  async status(): Promise<PrinterStatus> { return { state: this.connected ? 'ready' : 'disconnected' }; }

  async print(bitmap: Bitmap1, job: AdapterJob) {
    if (!this.connected) throw new PrinterError('disconnected');
    const steps = Math.max(1, this.o.steps ?? 12), ms = this.o.stepMs ?? 90;
    const bytes = encodeRaster(bitmap, { feedLines: job.thermal.feedLines, cut: job.thermal.cut });
    const failAt = this.queue.length ? Math.floor(steps / 2) : -1; // fail part-way, like a real drop-out
    const code = this.queue.shift();
    for (let s = 1; s <= steps; s++) {
      if (ms) await new Promise((r) => setTimeout(r, ms));
      if (s === failAt && code) {
        if (code === 'connection-lost') this.connected = false;
        throw new PrinterError(code);
      }
      job.onProgress?.(s / steps);
    }
    const d = decodeRaster(bytes);
    this.jobs.push({ bitmap: d.bitmap, bytes: bytes.length, feedLines: d.feedLines, cut: d.cut });
  }
}
