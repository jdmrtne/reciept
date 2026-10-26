import { PrinterError } from '../errors';
import type { ByteTransport } from '../adapters/escpos-adapter';
import { withTimeout } from './web-types';

/** Either a LAN printer (host + port) or a Windows print queue (printer). The bridge does the rest. */
export interface NetworkOptions { bridgeUrl: string; host?: string; port?: number; printer?: string }

type FetchLike = (input: string, init?: { method?: string; body?: BodyInit; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Sends printer bytes to a tiny local "print bridge" (bridge/server.mjs) over HTTP; the bridge relays them to the
 * network printer's raw port (9100). Browsers can't open raw TCP themselves, which is why the bridge exists.
 * open() = ask the bridge whether the printer accepts a connection; write() = POST the bytes.
 */
export class HttpBridgeTransport implements ByteTransport {
  private open_ = false;
  constructor(private readonly opts: () => NetworkOptions, private readonly fetcher: FetchLike | undefined = typeof fetch === 'undefined' ? undefined : (fetch as unknown as FetchLike)) {}

  get isOpen() { return this.open_; }

  private endpoint(path: string): string {
    const { bridgeUrl, host, port, printer } = this.opts();
    const base = `${bridgeUrl.replace(/\/+$/, '')}${path}`;
    if (printer !== undefined) {
      if (!printer.trim()) throw new PrinterError('unavailable', 'no Windows printer name set — enter it in ADMIN');
      return `${base}?printer=${encodeURIComponent(printer.trim())}`;
    }
    if (!host?.trim()) throw new PrinterError('unavailable', 'no printer address set — enter it in ADMIN');
    return `${base}?host=${encodeURIComponent(host.trim())}&port=${port ?? 9100}`;
  }

  private async call(path: string, init: { method?: string; body?: BodyInit; headers?: Record<string, string> }, ms: number) {
    if (!this.fetcher) throw new PrinterError('unsupported', 'fetch is not available');
    // Call through a local variable: browsers throw "Illegal invocation" if fetch is called as a method of another object.
    const doFetch = this.fetcher;
    return withTimeout(doFetch(this.endpoint(path), init), ms, 'print bridge');
  }

  async open(): Promise<void> {
    let r;
    try { r = await this.call('/status', { method: 'GET' }, 6000); }
    catch (e) {
      if (e instanceof PrinterError) throw e;
      const why = e instanceof Error ? e.message : String(e);
      throw new PrinterError('unavailable', `cannot reach the print bridge at ${this.opts().bridgeUrl} (${why})`, e);
    }
    if (!r.ok) {
      let why = `HTTP ${r.status}`;
      try { const j = (await r.json()) as { error?: string }; if (j?.error) why = j.error; } catch { /* not JSON */ }
      throw new PrinterError('disconnected', why);
    }
    this.open_ = true;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.open_) throw new PrinterError('disconnected');
    let r;
    try { r = await this.call('/print', { method: 'POST', body: bytes.slice(), headers: { 'Content-Type': 'application/octet-stream' } }, 30000); }
    catch (e) { this.open_ = false; throw new PrinterError('connection-lost', 'lost the print bridge', e); }
    if (!r.ok) { this.open_ = false; throw new PrinterError('connection-lost', `bridge refused the job (${r.status})`); }
  }

  async close(): Promise<void> { this.open_ = false; }

  /** ADMIN "check connection": succeeds only if the bridge is up AND the printer answers. */
  async pair(): Promise<void> { await this.open(); }
}
