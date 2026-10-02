import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createBridge, isPrivateHost } from '../../bridge/server.mjs';
import { NetworkPrinterAdapter } from './adapters/network';
import { PrinterManager } from './manager';
import { decodeRaster } from './escpos';
import { createBitmap, setDot, getDot } from './bitmap';
import { DEFAULT_THERMAL } from './types';
import { mergeSettings } from '../config/settings';
import { WindowsPrinterAdapter } from './adapters/windows';
import { readFileSync } from 'node:fs';

const open: { close(cb?: () => void): unknown }[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map((s) => new Promise<void>((r) => s.close(() => r())))); });

/** A fake printer: a TCP server on 127.0.0.1 that records every byte it receives. */
async function fakePrinter() {
  const received: Buffer[] = [];
  const srv = net.createServer((s) => { s.on('data', (d: Buffer) => received.push(d)); s.on('error', () => {}); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  open.push(srv);
  return { port: (srv.address() as AddressInfo).port, bytes: () => new Uint8Array(Buffer.concat(received)) };
}
async function bridge(allowPorts: number[], powershell?: (script: string, env?: Record<string, string>) => Promise<string>) {
  const srv: Server = createBridge({ allowPorts, powershell });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  open.push(srv);
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('network printer via the print bridge', () => {
  it('delivers the exact ESC/POS bytes to the printer port', async () => {
    const p = await fakePrinter(), url = await bridge([p.port]);
    const bm = createBitmap(16, 4); setDot(bm, 0, 0, true); setDot(bm, 15, 3, true);
    const a = new NetworkPrinterAdapter(() => ({ bridgeUrl: url, host: '127.0.0.1', port: p.port }));
    const mgr = new PrinterManager({ network: () => a }, 'network');
    const r = await mgr.print({ width: 16, height: 4, data: new Uint8ClampedArray(16 * 4 * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 0)) },
      { thermal: { ...DEFAULT_THERMAL, marginBottom: 0 }, paperDots: 16 });
    await wait(300);
    const d = decodeRaster(p.bytes());
    expect(d.bitmap.width).toBe(16);
    expect(p.bytes().length).toBe(r.bytes);
    expect(getDot(d.bitmap, 0, 0)).toBe(1); // all-black image survives the trip
  });

  it('calls fetch the way browsers require (not as a method of the transport)', async () => {
    const p = await fakePrinter(), url = await bridge([p.port]);
    const strictFetch = function (this: unknown, input: string, init?: object) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      return fetch(input, init as RequestInit);
    };
    const a = new NetworkPrinterAdapter(() => ({ bridgeUrl: url, host: '127.0.0.1', port: p.port }), undefined, strictFetch as never);
    await a.connect();
    expect((await a.status()).state).toBe('ready');
  });

  it('reports the printer unreachable when nothing listens on the printer port', async () => {
    const dead = await fakePrinter(); const port = dead.port;
    await new Promise<void>((r) => (open.pop() as net.Server).close(() => r()));
    const url = await bridge([port]);
    const a = new NetworkPrinterAdapter(() => ({ bridgeUrl: url, host: '127.0.0.1', port }));
    await expect(a.connect()).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('reports the bridge missing when it is not running', async () => {
    const a = new NetworkPrinterAdapter(() => ({ bridgeUrl: 'http://127.0.0.1:1', host: '127.0.0.1', port: 9100 }));
    await expect(a.connect()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('refuses public hosts and ports that are not allowed', async () => {
    const url = await bridge([9100]);
    expect((await fetch(`${url}/status?host=8.8.8.8&port=9100`)).status).toBe(400);
    expect((await fetch(`${url}/status?host=127.0.0.1&port=22`)).status).toBe(400);
    expect((await fetch(`${url}/print?host=10.0.0.11&port=9100`, { method: 'POST', body: new Uint8Array(0) })).status).toBe(400);
    expect(isPrivateHost('10.0.0.11') && isPrivateHost('192.168.1.5') && isPrivateHost('172.20.0.1')).toBe(true);
    expect(isPrivateHost('172.32.0.1') || isPrivateHost('8.8.8.8') || isPrivateHost('example.com') || isPrivateHost('999.1.1.1')).toBe(false);
  });

  it('answers CORS preflight (the app and the bridge are different origins)', async () => {
    const url = await bridge([9100]);
    const r = await fetch(`${url}/print`, { method: 'OPTIONS' });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('access-control-allow-private-network')).toBe('true');
  });

  it('network settings are repaired', () => {
    expect(mergeSettings(null).network).toEqual({ bridgeUrl: 'http://localhost:9101', host: '10.0.0.11', port: 9100 });
    expect(mergeSettings({ network: { bridgeUrl: 5, host: ' 192.168.1.9 ', port: 99999 } }).network).toEqual({ bridgeUrl: 'http://localhost:9101', host: '192.168.1.9', port: 65535 });
  });

  it('Windows printer: bytes reach the print queue as a RAW job; the name travels in an env var, never in code', async () => {
    const calls: { script: string; env: Record<string, string>; sent?: Uint8Array }[] = [];
    const url = await bridge([9100], async (script, env = {}) => {
      const c: (typeof calls)[number] = { script, env };
      if (env.PB_FILE) c.sent = new Uint8Array(readFileSync(env.PB_FILE));
      calls.push(c);
      return env.PB_FILE ? 'OK' : JSON.stringify({ Name: env.PB_PRINTER, PortName: 'USB001', DriverName: 'Generic', PrinterStatus: 0 });
    });
    const evil = 'POS80 10.0.0.11"; calc #';
    const a = new WindowsPrinterAdapter(() => ({ bridgeUrl: url, printer: evil }));
    const mgr = new PrinterManager({ windows: () => a }, 'windows');
    const img = { width: 16, height: 4, data: new Uint8ClampedArray(16 * 4 * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 0)) };
    const r = await mgr.print(img, { thermal: { ...DEFAULT_THERMAL, marginBottom: 0 }, paperDots: 16 });
    const job = calls.find((c) => c.sent)!;
    expect(job.env.PB_PRINTER).toBe(evil);
    expect(job.script).not.toContain('calc');
    expect(job.script).toContain('RAW');
    expect(job.sent!.length).toBe(r.bytes);
    expect(decodeRaster(job.sent!).bitmap.width).toBe(16);
  });

  it('bridge lists Windows printers (one or many) and says plainly when it is not on Windows', async () => {
    const one = await bridge([9100], async () => JSON.stringify({ Name: 'A', PortName: 'USB001' }));
    expect(((await (await fetch(`${one}/printers`)).json()) as { printers: unknown[] }).printers).toHaveLength(1);
    const many = await bridge([9100], async () => JSON.stringify([{ Name: 'A' }, { Name: 'B' }]));
    expect(((await (await fetch(`${many}/printers`)).json()) as { printers: unknown[] }).printers).toHaveLength(2);
    const none = await bridge([9100], async () => '');
    expect(((await (await fetch(`${none}/printers`)).json()) as { printers: unknown[] }).printers).toHaveLength(0);
    const linux = await bridge([9100]); // real PowerShell runner: this test machine is not Windows
    if (process.platform !== 'win32') expect((await fetch(`${linux}/status?printer=X`)).status).toBe(501);
  });

  it('a missing Windows printer is reported with its name', async () => {
    const url = await bridge([9100], async () => { throw new Error('Cannot find printer'); });
    const r = await fetch(`${url}/status?printer=Nope`);
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: string }).error).toContain('Nope');
    expect((await fetch(`${url}/status?printer=%20`)).status).toBe(400);
  });

  it('Windows printer name keeps its spaces while typing', () => {
    expect(mergeSettings({ windowsPrinter: 'POS80 ' }).windowsPrinter).toBe('POS80 ');
    expect(mergeSettings(null).windowsPrinter).toBe('POS80 10.0.0.11');
    expect(mergeSettings({ printer: 'windows' }).printer).toBe('windows');
  });
});
