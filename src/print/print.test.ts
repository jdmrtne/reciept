import { describe, expect, it } from 'vitest';
import { blackRatio, bitmapToRGBA, createBitmap, getDot, padBitmap, setDot } from './bitmap';
import { ditherToBitmap, normalizeThermal, resizeGray, toGray, toneLut, toThermalBitmap } from './pipeline';
import { chunkBytes, decodeRaster, encodeRaster } from './escpos';
import { PrinterError, PRINTER_MESSAGES, toPrinterError } from './errors';
import { MockPrinterAdapter } from './adapters/mock';
import { EscPosAdapter, type ByteTransport } from './adapters/escpos-adapter';
import { BluetoothPrinterAdapter } from './adapters/bluetooth';
import { USBPrinterAdapter } from './adapters/usb';
import { WebUsbTransport, pickEndpoints } from './transports/usb';
import { WebBluetoothTransport, pickWritable, PRINTER_SERVICES } from './transports/bluetooth';
import type { UsbDeviceLike, UsbLike, BtCharacteristic, BtDeviceLike, BtLike } from './transports/web-types';
import { PrinterManager } from './manager';
import { DEFAULT_THERMAL, type PrinterAdapter, type RGBAImage } from './types';
import { mergeSettings } from '../config/settings';
import { interpretStatus } from './status';
import { makeTestPage } from './testpage';

const solid = (w: number, h: number, r: number, g = r, b = r, a = 255): RGBAImage => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([r, g, b, a], i * 4);
  return { width: w, height: h, data };
};
const gradient = (w: number, h: number): RGBAImage => { // left black → right white
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = Math.round((x / (w - 1)) * 255), i = (y * w + x) * 4; data.set([v, v, v, 255], i); }
  return { width: w, height: h, data };
};
const bits = (rows: string[]) => { // '#' = black
  const b = createBitmap(rows[0].length, rows.length);
  rows.forEach((r, y) => [...r].forEach((c, x) => c === '#' && setDot(b, x, y, true)));
  return b;
};
const show = (b: ReturnType<typeof createBitmap>) => Array.from({ length: b.height }, (_, y) => Array.from({ length: b.width }, (_, x) => (getDot(b, x, y) ? '#' : '.')).join(''));

describe('bitmap', () => {
  it('packs MSB-first with 1 = black and pads rows to whole bytes', () => {
    const b = bits(['#.......', '.......#', '#.#']);
    expect(b.rowBytes).toBe(1);
    expect([...b.data]).toEqual([0x80, 0x01, 0xa0]);
    expect(createBitmap(9, 1).rowBytes).toBe(2);
  });
  it('padBitmap adds blank margins without touching dots', () => {
    const p = padBitmap(bits(['#']), 2, 1, 1, 2);
    expect(show(p)).toEqual(['....', '..#.', '....', '....']);
  });
  it('bitmapToRGBA is black where burned, white elsewhere, opaque', () => {
    const img = bitmapToRGBA(bits(['#.']));
    expect([...img.data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
  it('blackRatio', () => { expect(blackRatio(bits(['##..', '....']))).toBe(0.25); });
});

describe('pipeline: gray / resize / tone', () => {
  it('toGray uses Rec.601 and composites transparency over white paper', () => {
    expect(toGray(solid(1, 1, 200, 100, 50))[0]).toBe(Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50));
    expect(toGray(solid(1, 1, 0, 0, 0, 0))[0]).toBe(255);
    expect(toGray(solid(1, 1, 0, 0, 0, 128))[0]).toBe(127);
  });
  it('resizeGray: identity when sizes match, exact box average when halving, input untouched', () => {
    const src = Uint8Array.from([0, 100, 200, 100]);
    const same = resizeGray(src, 2, 2, 2, 2); expect([...same]).toEqual([...src]); expect(same).not.toBe(src);
    expect([...resizeGray(src, 2, 2, 1, 1)]).toEqual([100]);
    expect([...resizeGray(Uint8Array.from([0, 255, 0, 255]), 4, 1, 2, 1)]).toEqual([128, 128]);
    expect([...src]).toEqual([0, 100, 200, 100]);
  });
  it('resizeGray handles non-integer ratios and upscaling', () => {
    const out = resizeGray(Uint8Array.from([10, 20, 30]), 3, 1, 2, 1);
    expect(out.length).toBe(2); expect(out[0]).toBeGreaterThan(9); expect(out[1]).toBeLessThan(31);
    expect([...resizeGray(Uint8Array.from([0, 255]), 2, 1, 4, 1)]).toEqual([0, 0, 255, 255]);
  });
  it('tone LUT: neutral settings keep the mid range monotonic; white and ink are pinned', () => {
    for (const t of [{ brightness: 0, contrast: 0, density: 3 }, { brightness: -80, contrast: -100, density: 5 }, { brightness: 80, contrast: 100, density: 1 }]) {
      const l = toneLut(t);
      expect(l[0]).toBe(0); expect(l[255]).toBe(255);
      for (let i = 1; i < 256; i++) expect(l[i]).toBeGreaterThanOrEqual(l[i - 1]);
    }
    const id = toneLut({ brightness: 0, contrast: 0, density: 3 });
    expect(Math.abs(id[128] - 128)).toBeLessThan(2);
  });
  it('brightness/density move mid-gray the expected way; contrast spreads it', () => {
    const base = toneLut({ brightness: 0, contrast: 0, density: 3 })[100];
    expect(toneLut({ brightness: 40, contrast: 0, density: 3 })[100]).toBeGreaterThan(base);
    expect(toneLut({ brightness: 0, contrast: 0, density: 5 })[100]).toBeLessThan(base);
    expect(toneLut({ brightness: 0, contrast: 0, density: 1 })[100]).toBeGreaterThan(base);
    const hc = toneLut({ brightness: 0, contrast: 60, density: 3 });
    expect(hc[90]).toBeLessThan(90); expect(hc[170]).toBeGreaterThan(170);
  });
});

describe('pipeline: dithering', () => {
  const flat = (v: number, w = 16, h = 16) => new Uint8Array(w * h).fill(v);
  it('threshold: exact cut-off', () => {
    const b = ditherToBitmap(Uint8Array.from([0, 127, 128, 255]), 4, 1, 'threshold', 128);
    expect(show(b)).toEqual(['##..']);
    expect(show(ditherToBitmap(Uint8Array.from([0, 127, 128, 255]), 4, 1, 'threshold', 200))).toEqual(['###.']);
  });
  for (const mode of ['floyd-steinberg', 'atkinson', 'ordered'] as const) {
    it(`${mode}: pure white stays white, pure black stays black, mid-gray is ~half ink`, () => {
      expect(blackRatio(ditherToBitmap(flat(255), 16, 16, mode))).toBe(0);
      expect(blackRatio(ditherToBitmap(flat(0), 16, 16, mode))).toBe(1);
      const r = blackRatio(ditherToBitmap(flat(128, 64, 64), 64, 64, mode));
      if (mode === 'atkinson') { expect(r).toBeGreaterThan(0.3); expect(r).toBeLessThan(0.6); } // Atkinson drops 1/4 of the error
      else { expect(r).toBeGreaterThan(0.44); expect(r).toBeLessThan(0.56); }
    });
    it(`${mode}: darker input → more ink (monotonic) and deterministic`, () => {
      const rs = [220, 160, 100, 40].map((v) => blackRatio(ditherToBitmap(flat(v, 48, 48), 48, 48, mode)));
      for (let i = 1; i < rs.length; i++) expect(rs[i]).toBeGreaterThan(rs[i - 1]);
      const a = ditherToBitmap(flat(90, 32, 32), 32, 32, mode), b = ditherToBitmap(flat(90, 32, 32), 32, 32, mode);
      expect([...a.data]).toEqual([...b.data]);
    });
  }
  it('Floyd–Steinberg matches a hand-computed 2×1 case', () => {
    // 100 → black (err 100), pushes 7/16*100 = 43.75 to the right: 100+43.75 = 143.75 → white
    expect(show(ditherToBitmap(Uint8Array.from([100, 100]), 2, 1, 'floyd-steinberg'))).toEqual(['#.']);
  });
  it('ordered dither uses the Bayer 8×8 pattern (cell 0,0 has the lowest threshold, so it turns white first)', () => {
    const b = ditherToBitmap(flat(4, 8, 8), 8, 8, 'ordered'); // level 4 clears only the lowest threshold (≈2) of 64 cells
    expect(blackRatio(b)).toBeCloseTo(63 / 64, 5);
    expect(getDot(b, 0, 0)).toBe(0);
  });
});

describe('toThermalBitmap', () => {
  it('outputs exactly the paper width, a whole number of bytes, and never mutates the input', () => {
    const img = gradient(384, 100), copy = Uint8ClampedArray.from(img.data);
    const b = toThermalBitmap(img, DEFAULT_THERMAL, 384);
    expect([b.width, b.rowBytes]).toEqual([384, 48]);
    expect(b.height).toBe(100 + DEFAULT_THERMAL.marginBottom);
    expect([...img.data]).toEqual([...copy]);
  });
  it('resizes any input width to the paper width keeping aspect', () => {
    const b = toThermalBitmap(gradient(768, 200), { marginBottom: 0, marginTop: 0 }, 384);
    expect([b.width, b.height]).toEqual([384, 100]);
    const wide = toThermalBitmap(gradient(384, 100), { marginBottom: 0 }, 576);
    expect([wide.width, wide.height]).toEqual([576, 150]);
  });
  it('a white page prints nothing; a black block prints solid; frame ink survives any tuning', () => {
    for (const dither of ['threshold', 'floyd-steinberg', 'atkinson', 'ordered'] as const) {
      const t = { dither, brightness: -60, contrast: -100, density: 5 };
      expect(blackRatio(toThermalBitmap(solid(64, 64, 255), t, 64))).toBe(0);
      expect(blackRatio(toThermalBitmap(solid(64, 64, 0), { ...t, marginBottom: 0 }, 64))).toBe(1);
    }
  });
  it('gradient: ink density falls left → right', () => {
    const b = toThermalBitmap(gradient(128, 64), { dither: 'floyd-steinberg', marginBottom: 0 }, 128);
    const col = (x0: number, x1: number) => { let n = 0; for (let y = 0; y < b.height; y++) for (let x = x0; x < x1; x++) n += getDot(b, x, y); return n; };
    expect(col(0, 32)).toBeGreaterThan(col(32, 64)); expect(col(32, 64)).toBeGreaterThan(col(64, 96)); expect(col(64, 96)).toBeGreaterThan(col(96, 128));
  });
  it('margins: blank columns left/right, blank rows top/bottom, content still fits the width', () => {
    const b = toThermalBitmap(solid(100, 10, 0), { marginX: 8, marginTop: 3, marginBottom: 2 }, 64);
    expect(b.width).toBe(64); expect(b.height).toBe(3 + 5 + 2); // content is 48 wide (64 − 2×8) → 10 × 48/100 = 4.8 → 5 rows
    for (let y = 0; y < 3; y++) for (let x = 0; x < 64; x++) expect(getDot(b, x, y)).toBe(0); // top margin blank
    for (let y = 3; y < 8; y++) { expect(getDot(b, 7, y)).toBe(0); expect(getDot(b, 8, y)).toBe(1); expect(getDot(b, 55, y)).toBe(1); expect(getDot(b, 56, y)).toBe(0); }
  });
  it('brightness lightens, density darkens the printed result', () => {
    const g = gradient(64, 32);
    const ink = (t: object) => blackRatio(toThermalBitmap(g, { dither: 'floyd-steinberg', marginBottom: 0, ...t }, 64));
    expect(ink({ brightness: 40 })).toBeLessThan(ink({}));
    expect(ink({ density: 5 })).toBeGreaterThan(ink({}));
  });
  it('rejects an empty image', () => { expect(() => toThermalBitmap({ width: 0, height: 0, data: new Uint8ClampedArray() }, {}, 64)).toThrow(); });
});

describe('normalizeThermal / settings', () => {
  it('fills defaults, clamps and repairs junk', () => {
    expect(normalizeThermal(undefined)).toEqual(DEFAULT_THERMAL);
    const n = normalizeThermal({ brightness: 999, contrast: -999, density: 0, dither: 'nope' as any, threshold: NaN as any, marginX: -5, feedLines: 99, cut: 'yes' as any });
    expect(n).toMatchObject({ brightness: 100, contrast: -100, density: 1, dither: DEFAULT_THERMAL.dither, threshold: 128, marginX: 0, feedLines: 20, cut: false });
  });
  it('mergeSettings keeps old stored settings valid and deep-merges thermal', () => {
    const s = mergeSettings({ eventName: 'X', thermal: { contrast: 40 }, printer: 'laser', paperWidthMm: 99 });
    expect(s.eventName).toBe('X'); expect(s.thermal.contrast).toBe(40); expect(s.thermal.dither).toBe(DEFAULT_THERMAL.dither);
    expect(s.printer).toBe('mock'); expect(s.paperWidthMm).toBe(58); expect(s.inactivitySeconds).toBe(60);
    expect(mergeSettings(null).printer).toBe('mock');
    expect(mergeSettings({ paperWidthMm: 80 }).paperWidthMm).toBe(80);
  });
});

describe('ESC/POS encoder', () => {
  it('exact bytes for a known 8×2 bitmap', () => {
    const b = bits(['#.#.#.#.', '.#.#.#.#']);
    expect([...encodeRaster(b)]).toEqual([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x02, 0x00, 0xaa, 0x55]);
  });
  it('feed and cut commands, and init can be omitted', () => {
    const b = bits(['########']);
    expect([...encodeRaster(b, { init: false, feedLines: 3, cut: true })]).toEqual([0x1d, 0x76, 0x30, 0, 1, 0, 1, 0, 0xff, 0x1b, 0x64, 3, 0x1d, 0x56, 0x42, 0]);
  });
  it('header encodes width bytes and height little-endian (384 wide × 300 rows)', () => {
    const b = createBitmap(384, 300);
    const out = encodeRaster(b, { bandRows: 1000, init: false });
    expect([...out.slice(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0, 48, 0, 44, 1]); // 300 = 0x012c
    expect(out.length).toBe(8 + 48 * 300);
  });
  it('bands split rows into contiguous blocks; decoding rebuilds the identical bitmap', () => {
    const b = createBitmap(64, 300);
    for (let y = 0; y < 300; y++) for (let x = 0; x < 64; x++) if ((x * 7 + y * 13) % 5 < 2) setDot(b, x, y, true);
    const out = encodeRaster(b, { bandRows: 128, feedLines: 4, cut: true });
    const d = decodeRaster(out);
    expect([d.bitmap.width, d.bitmap.height, d.feedLines, d.cut]).toEqual([64, 300, 4, true]);
    expect([...d.bitmap.data]).toEqual([...b.data]);
    // 3 bands: 128 + 128 + 44 rows → headers say so
    expect(out[2 + 6]).toBe(128); expect(out[2 + 8 + 8 * 128 + 6]).toBe(128); expect(out[2 + 2 * (8 + 8 * 128) + 6]).toBe(44);
  });
  it('decode rejects truncated or unknown data', () => {
    const out = encodeRaster(bits(['########', '########']));
    expect(() => decodeRaster(out.slice(0, out.length - 1))).toThrow();
    expect(() => decodeRaster(Uint8Array.from([0x00]))).toThrow();
  });
  it('chunkBytes splits without copying and covers everything', () => {
    const c = chunkBytes(Uint8Array.from([1, 2, 3, 4, 5]), 2);
    expect(c.map((x) => [...x])).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('full path: pixels → 1-bit → bytes → back equals the bitmap', () => {
    const b = toThermalBitmap(gradient(384, 40), DEFAULT_THERMAL, 384);
    const d = decodeRaster(encodeRaster(b, { feedLines: DEFAULT_THERMAL.feedLines }));
    expect([...d.bitmap.data]).toEqual([...b.data]);
  });
});

describe('errors', () => {
  it('every error code has short plain copy', () => {
    for (const [code, m] of Object.entries(PRINTER_MESSAGES)) { expect(m.title.length).toBeGreaterThan(3); expect(m.hint.length).toBeLessThan(90); expect(code).toBeTruthy(); }
  });
  it('toPrinterError wraps unknown errors as failed and keeps PrinterErrors', () => {
    expect(toPrinterError(new Error('x')).code).toBe('failed');
    expect(toPrinterError('boom').code).toBe('failed');
    const e = new PrinterError('paper'); expect(toPrinterError(e)).toBe(e);
  });
});

const job = { thermal: { feedLines: 2, cut: false, density: 3 } };
class FakeTransport implements ByteTransport {
  isOpen = false; written: Uint8Array[] = []; failOnWrite = -1; failOpen = false; closed = 0;
  async open() { if (this.failOpen) throw new Error('nope'); this.isOpen = true; }
  async write(b: Uint8Array) { if (this.written.length === this.failOnWrite) throw new Error('link down'); this.written.push(b.slice()); }
  async close() { this.isOpen = false; this.closed++; }
}

describe('MockPrinterAdapter', () => {
  const b = toThermalBitmap(gradient(64, 20), DEFAULT_THERMAL, 64);
  it('prints through the real encoder: lastJob.bitmap equals what was sent', async () => {
    const m = new MockPrinterAdapter({ stepMs: 0 });
    await m.connect();
    const seen: number[] = [];
    await m.print(b, { ...job, onProgress: (p) => seen.push(p) });
    expect([...m.lastJob!.bitmap.data]).toEqual([...b.data]);
    expect(m.lastJob!.feedLines).toBe(2);
    expect(seen[seen.length - 1]).toBe(1); expect(seen).toEqual([...seen].sort((a, c) => a - c));
  });
  it('refuses to print while disconnected; status follows connect/disconnect', async () => {
    const m = new MockPrinterAdapter({ stepMs: 0 });
    expect((await m.status()).state).toBe('disconnected');
    await expect(m.print(b, job)).rejects.toMatchObject({ code: 'disconnected' });
    await m.connect(); expect((await m.status()).state).toBe('ready');
    await m.disconnect(); expect((await m.status()).state).toBe('disconnected');
  });
  it('failures fire in order, part-way through, then it works', async () => {
    const m = new MockPrinterAdapter({ stepMs: 0, failures: ['failed', 'connection-lost'] });
    await m.connect();
    await expect(m.print(b, job)).rejects.toMatchObject({ code: 'failed' });
    await expect(m.print(b, job)).rejects.toMatchObject({ code: 'connection-lost' });
    expect((await m.status()).state).toBe('disconnected'); // a lost link really drops
    await m.connect(); await m.print(b, job);
    expect(m.jobs.length).toBe(1);
  });
});

describe('EscPosAdapter (transport-agnostic)', () => {
  const b = toThermalBitmap(gradient(384, 60), DEFAULT_THERMAL, 384);
  it('streams the exact ESC/POS bytes in chunks, reporting progress to 1', async () => {
    const t = new FakeTransport(), a = new EscPosAdapter('usb', 'x', t, { chunkSize: 1000 });
    await a.connect();
    const seen: number[] = [];
    await a.print(b, { ...job, onProgress: (p) => seen.push(p) });
    const sent = new Uint8Array(t.written.reduce((n, c) => n + c.length, 0)); let o = 0; for (const c of t.written) { sent.set(c, o); o += c.length; }
    expect([...sent]).toEqual([...encodeRaster(b, { feedLines: 2, cut: false })]);
    expect(t.written.every((c) => c.length <= 1000)).toBe(true);
    expect(seen[seen.length - 1]).toBe(1);
  });
  it('maps failures: open error → unavailable, write error → connection-lost (and closes), not open → disconnected', async () => {
    const t = new FakeTransport(), a = new EscPosAdapter('usb', 'x', t, { chunkSize: 500 });
    await expect(a.print(b, job)).rejects.toMatchObject({ code: 'disconnected' });
    t.failOpen = true; await expect(a.connect()).rejects.toMatchObject({ code: 'unavailable' });
    t.failOpen = false; await a.connect(); expect((await a.status()).state).toBe('ready');
    t.failOnWrite = 2; await expect(a.print(b, job)).rejects.toMatchObject({ code: 'connection-lost' });
    expect((await a.status()).state).toBe('disconnected');
  });
});

describe('Unsupported browsers / unbuilt network printer', () => {
  it('report unsupported honestly and never pretend to print', async () => {
    const a = new BluetoothPrinterAdapter();
    await expect(a.connect()).rejects.toBeInstanceOf(PrinterError); // node has no navigator.bluetooth → unsupported
    await expect(a.connect()).rejects.toMatchObject({ code: 'unsupported' });
    expect((await a.status()).state).toBe('disconnected');
    await expect(a.print(createBitmap(8, 1), job)).rejects.toMatchObject({ code: 'disconnected' });
  });
});

describe('PrinterManager', () => {
  const img = gradient(128, 40), opts = (extra = {}) => ({ thermal: DEFAULT_THERMAL, paperDots: 128, ...extra });
  const make = (m: MockPrinterAdapter) => new PrinterManager({ mock: () => m }, 'mock');

  it('runs the pipeline, connects on demand and prints exactly the pipeline bitmap', async () => {
    const m = new MockPrinterAdapter({ stepMs: 0 }), mgr = make(m);
    const r = await mgr.print(img, opts());
    expect([...m.lastJob!.bitmap.data]).toEqual([...toThermalBitmap(img, DEFAULT_THERMAL, 128).data]);
    expect([...r.bitmap.data]).toEqual([...m.lastJob!.bitmap.data]);
    expect(r.bytes).toBeGreaterThan(r.bitmap.data.length);
  });
  it('never mutates the composition', async () => {
    const before = Uint8ClampedArray.from(img.data);
    await make(new MockPrinterAdapter({ stepMs: 0 })).print(img, opts());
    expect([...img.data]).toEqual([...before]);
  });
  it('a failure surfaces as PrinterError and RETRY on the same manager succeeds', async () => {
    const m = new MockPrinterAdapter({ stepMs: 0, failures: ['failed'] }), mgr = make(m);
    await expect(mgr.print(img, opts())).rejects.toMatchObject({ code: 'failed' });
    await mgr.print(img, opts());
    expect(m.jobs.length).toBe(1);
  });
  it('connection-lost drops the link and retry reconnects', async () => {
    const m = new MockPrinterAdapter({ stepMs: 0, failures: ['connection-lost'] }), mgr = make(m);
    await expect(mgr.print(img, opts())).rejects.toMatchObject({ code: 'connection-lost' });
    expect((await mgr.status()).state).toBe('disconnected');
    await mgr.print(img, opts());
    expect(m.jobs.length).toBe(1);
  });
  it('unavailable at connect time is reported as such', async () => {
    const mgr = make(new MockPrinterAdapter({ stepMs: 0, failures: ['unavailable'] }));
    await expect(mgr.print(img, opts())).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('non-PrinterError exceptions become "failed"; bad images become "failed" too', async () => {
    const boom: PrinterAdapter = { kind: 'usb', label: 'b', connect: async () => {}, disconnect: async () => {}, status: async () => ({ state: 'ready' }), print: async () => { throw new TypeError('x'); } };
    await expect(new PrinterManager({ usb: () => boom }, 'usb').print(img, opts())).rejects.toMatchObject({ code: 'failed' });
    await expect(make(new MockPrinterAdapter({ stepMs: 0 })).print({ width: 0, height: 0, data: new Uint8ClampedArray() }, opts())).rejects.toMatchObject({ code: 'failed' });
  });
  it('a hung printer times out as "failed" instead of freezing the kiosk', async () => {
    const hang: PrinterAdapter = { kind: 'usb', label: 'h', connect: async () => {}, disconnect: async () => {}, status: async () => ({ state: 'ready' }), print: () => new Promise(() => {}) };
    await expect(new PrinterManager({ usb: () => hang }, 'usb').print(img, opts({ timeoutMs: 30 }))).rejects.toMatchObject({ code: 'failed' });
  });
  it('a double tap while printing returns the same job (prints once)', async () => {
    const m = new MockPrinterAdapter({ stepMs: 2, steps: 4 }), mgr = make(m);
    const a = mgr.print(img, opts()), b = mgr.print(img, opts());
    expect(a).toBe(b);
    await a; expect(m.jobs.length).toBe(1);
    await mgr.print(img, opts()); expect(m.jobs.length).toBe(2); // and it is free again afterwards
  });
  it('unknown / unbuilt printer kinds report unsupported; select() switches adapters', async () => {
    const mgr = new PrinterManager({}, 'network');
    await expect(mgr.print(img, opts())).rejects.toMatchObject({ code: 'unsupported' });
    expect((await mgr.status()).state).toBe('error');
    const m = new MockPrinterAdapter({ stepMs: 0 }), two = new PrinterManager({ mock: () => m, usb: () => new BluetoothPrinterAdapter() }, 'usb');
    await two.select('mock'); expect(two.selected).toBe('mock');
    await two.print(img, opts()); expect(m.jobs.length).toBe(1);
  });
  it('reports progress from the adapter', async () => {
    const seen: number[] = [];
    await make(new MockPrinterAdapter({ stepMs: 0, steps: 5 })).print(img, opts({ onProgress: (p: number) => seen.push(p) }));
    expect(seen).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
  });
});

describe('ESC/POS real-time status', () => {
  it('no answers → unknown, never an error (silent printers must still print)', () => {
    expect(interpretStatus({})).toEqual({ error: null, nearEnd: false, unknown: true });
  });
  it('healthy printer bytes → no error', () => {
    expect(interpretStatus({ printer: 0x12, offline: 0x12, paper: 0x12 })).toEqual({ error: null, nearEnd: false, unknown: false });
  });
  it('paper end, cover open and paper-end stop all map to "paper"', () => {
    expect(interpretStatus({ paper: 0x72 }).error).toBe('paper');
    expect(interpretStatus({ offline: 0x16 }).error).toBe('paper');
    expect(interpretStatus({ offline: 0x32 }).error).toBe('paper');
  });
  it('paper near end is a warning only; offline → unavailable; error flag → failed', () => {
    const near = interpretStatus({ paper: 0x1e }); expect(near.error).toBe(null); expect(near.nearEnd).toBe(true);
    expect(interpretStatus({ printer: 0x1a }).error).toBe('unavailable');
    expect(interpretStatus({ offline: 0x52 }).error).toBe('failed');
  });
});

describe('EscPosAdapter status', () => {
  class Talking extends FakeTransport {
    replies: Record<number, number | 'silent'> = { 1: 0x12, 2: 0x12, 4: 0x12 };
    pending: number[] = [];
    async write(b: Uint8Array) { if (b[0] === 0x10 && b[1] === 0x04) { this.pending.push(b[2]); return; } return super.write(b); }
    async read() { const n = this.pending.shift()!; const r = this.replies[n]; if (r === 'silent') throw new Error('timeout'); return Uint8Array.from([r as number]); }
  }
  const b = toThermalBitmap(gradient(64, 16), DEFAULT_THERMAL, 64);
  it('ready when the printer reports OK; ready when it stays silent', async () => {
    const t = new Talking(), a = new EscPosAdapter('usb', 'x', t); await a.connect();
    expect((await a.status()).state).toBe('ready');
    t.replies = { 1: 'silent', 2: 'silent', 4: 'silent' };
    expect((await a.status()).state).toBe('ready');
    await a.print(b, job); expect(t.written.length).toBeGreaterThan(0);
  });
  it('reports paper problems as an error state and refuses to print into them', async () => {
    const t = new Talking(), a = new EscPosAdapter('usb', 'x', t); await a.connect();
    t.replies[4] = 0x72;
    expect(await a.status()).toEqual({ state: 'error', detail: 'paper' });
    await expect(a.print(b, job)).rejects.toMatchObject({ code: 'paper' });
    expect(t.written.length).toBe(0);
  });
  it('a low roll still prints and says so', async () => {
    const t = new Talking(), a = new EscPosAdapter('usb', 'x', t); await a.connect();
    t.replies[4] = 0x1e;
    expect(await a.status()).toEqual({ state: 'ready', detail: 'paper low' });
  });
  it('manager surfaces the paper error from a real status read', async () => {
    const t = new Talking(); t.replies[4] = 0x72;
    const mgr = new PrinterManager({ usb: () => new EscPosAdapter('usb', 'x', t) }, 'usb');
    await expect(mgr.print(gradient(64, 16), { thermal: DEFAULT_THERMAL, paperDots: 64 })).rejects.toMatchObject({ code: 'paper' });
  });
});

describe('test page', () => {
  it('is deterministic, paper-width wide, and prints a clear border, ramp and black bar', () => {
    const p = makeTestPage(384), q = makeTestPage(384);
    expect(p.width).toBe(384); expect([...p.data]).toEqual([...q.data]);
    const b = toThermalBitmap(p, DEFAULT_THERMAL, 384);
    expect(b.width).toBe(384);
    for (let x = 0; x < 384; x++) expect(getDot(b, x, 0)).toBe(1); // top border
    for (let y = 0; y < p.height; y++) expect(getDot(b, 0, y)).toBe(1); // left border
    for (let x = 12; x < 372; x++) expect(getDot(b, x, 190)).toBe(1); // solid bar
    const ink = (x0: number, x1: number) => { let n = 0; for (let y = 108; y < 164; y++) for (let x = x0; x < x1; x++) n += getDot(b, x, y); return n; };
    expect(ink(8, 100)).toBeLessThan(ink(290, 376)); // gradient white→black, so ink grows to the right
    expect(makeTestPage(576).width).toBe(576);
  });
});

// ---------- WebUSB ----------
const cfgPrinter = [{ configurationValue: 1, interfaces: [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 7, endpoints: [{ endpointNumber: 1, direction: 'out' as const, type: 'bulk' as const }, { endpointNumber: 2, direction: 'in' as const, type: 'bulk' as const }] }] }] }];
class FakeUsbDevice implements UsbDeviceLike {
  opened = false; configuration: UsbDeviceLike['configuration'] = null; productName = 'XP-T80A';
  calls: string[] = []; out: Uint8Array[] = []; failOut = false; inReply: number | null = 0x12; hang = false;
  constructor(public configurations: UsbDeviceLike['configurations'] = cfgPrinter) {}
  async open() { this.opened = true; this.calls.push('open'); }
  async close() { this.opened = false; this.calls.push('close'); }
  async selectConfiguration(v: number) { this.configuration = this.configurations.find((c) => c.configurationValue === v)!; this.calls.push('cfg' + v); }
  async claimInterface(n: number) { this.calls.push('claim' + n); }
  async releaseInterface(n: number) { this.calls.push('release' + n); }
  async selectAlternateInterface(n: number, a: number) { this.calls.push(`alt${n}.${a}`); }
  async transferOut(ep: number, d: BufferSource) { if (this.failOut) throw new Error('unplugged'); this.calls.push('out' + ep); this.out.push(new Uint8Array(d as ArrayBuffer | Uint8Array as any).slice()); return { status: 'ok', bytesWritten: (d as Uint8Array).byteLength }; }
  async transferIn(ep: number) { this.calls.push('in' + ep); if (this.hang) return new Promise<never>(() => {}); return this.inReply === null ? { status: 'stall' } : { status: 'ok', data: new DataView(Uint8Array.from([this.inReply]).buffer) }; }
}
class FakeUsb implements UsbLike {
  listeners: ((e: { device: UsbDeviceLike }) => void)[] = []; authorised: UsbDeviceLike[] = []; chooser: UsbDeviceLike | null = null; requests = 0;
  async getDevices() { return this.authorised; }
  async requestDevice() { this.requests++; if (!this.chooser) throw new Error('cancelled'); this.authorised.push(this.chooser); return this.chooser; }
  addEventListener(_t: 'disconnect', l: (e: { device: UsbDeviceLike }) => void) { this.listeners.push(l); }
  removeEventListener(_t: 'disconnect', l: (e: { device: UsbDeviceLike }) => void) { this.listeners = this.listeners.filter((x) => x !== l); }
  unplug(d: UsbDeviceLike) { this.listeners.forEach((l) => l({ device: d })); }
}

describe('WebUSB transport', () => {
  it('picks the printer-class bulk OUT (and IN) endpoint; skips protected classes; falls back to vendor class', () => {
    expect(pickEndpoints(cfgPrinter)).toMatchObject({ out: 1, inn: 2, config: 1 });
    const hid = [{ configurationValue: 1, interfaces: [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 3, endpoints: [{ endpointNumber: 1, direction: 'out' as const, type: 'bulk' as const }] }] }] }];
    expect(pickEndpoints(hid)).toBe(null);
    const vendor = [{ configurationValue: 1, interfaces: [{ interfaceNumber: 2, alternates: [{ alternateSetting: 0, interfaceClass: 0xff, endpoints: [{ endpointNumber: 3, direction: 'out' as const, type: 'bulk' as const }] }] }] }];
    expect(pickEndpoints(vendor)).toMatchObject({ out: 3, inn: null });
    expect(pickEndpoints([...vendor, ...cfgPrinter])).toMatchObject({ out: 1 }); // printer class wins over vendor class
  });
  it('unsupported without WebUSB; not paired → disconnected', async () => {
    await expect(new WebUsbTransport(undefined).open()).rejects.toMatchObject({ code: 'unsupported' });
    await expect(new WebUsbTransport(new FakeUsb()).open()).rejects.toMatchObject({ code: 'disconnected' });
  });
  it('pair() uses the chooser once; a fresh transport then reuses the permission via getDevices() with NO prompt', async () => {
    const usb = new FakeUsb(), dev = new FakeUsbDevice(); usb.chooser = dev;
    await new WebUsbTransport(usb).pair();
    expect(usb.requests).toBe(1);
    const t = new WebUsbTransport(usb); await t.open(); // "after a reload"
    expect(usb.requests).toBe(1); expect(t.isOpen).toBe(true);
    expect(dev.calls).toEqual(['open', 'cfg1', 'claim0']);
  });
  it('cancelled chooser → disconnected (not a crash)', async () => {
    await expect(new WebUsbTransport(new FakeUsb()).pair()).rejects.toMatchObject({ code: 'disconnected' });
  });
  it('full adapter path: prints exact ESC/POS bytes over bulk OUT, reads real status over bulk IN', async () => {
    const usb = new FakeUsb(), dev = new FakeUsbDevice(); usb.chooser = dev;
    const a = new USBPrinterAdapter({ chunkSize: 2000 }, usb); await a.pair(); await a.connect();
    expect((await a.status()).state).toBe('ready');
    const b = toThermalBitmap(gradient(384, 30), DEFAULT_THERMAL, 384);
    dev.out.length = 0; await a.print(b, job);
    const data = dev.out.filter((c) => !(c[0] === 0x10 && c[1] === 0x04)); // drop status queries
    const sent = new Uint8Array(data.reduce((n, c) => n + c.length, 0)); let o = 0; for (const c of data) { sent.set(c, o); o += c.length; }
    expect([...sent]).toEqual([...encodeRaster(b, { feedLines: 2, cut: false })]);
    expect(data.every((c) => c.length <= 2000)).toBe(true);
  });
  it('paper-out reported over USB blocks the print', async () => {
    const usb = new FakeUsb(), dev = new FakeUsbDevice(); usb.chooser = dev; dev.inReply = 0x72;
    const a = new USBPrinterAdapter({}, usb); await a.pair(); await a.connect();
    await expect(a.print(createBitmap(64, 8), job)).rejects.toMatchObject({ code: 'paper' });
  });
  it('a printer that never answers status still prints (stall / hang are "unknown")', async () => {
    const usb = new FakeUsb(), dev = new FakeUsbDevice(); usb.chooser = dev; dev.inReply = null;
    const a = new USBPrinterAdapter({ statusTimeoutMs: 20 }, usb); await a.pair(); await a.connect();
    await a.print(createBitmap(64, 8), job);
    dev.hang = true; await a.print(createBitmap(64, 8), job);
  });
  it('unplugging mid-session → not open; a write failure → connection-lost and the link is closed', async () => {
    const usb = new FakeUsb(), dev = new FakeUsbDevice(); usb.chooser = dev;
    const a = new USBPrinterAdapter({}, usb); await a.pair(); await a.connect();
    usb.unplug(dev); expect((await a.status()).state).toBe('disconnected');
    await a.connect(); // re-plug → reopen works
    dev.failOut = true; await expect(a.print(createBitmap(64, 8), job)).rejects.toMatchObject({ code: 'connection-lost' });
    expect(dev.calls).toContain('release0');
  });
  it('claim failure (e.g. another app holds the printer) → unavailable', async () => {
    const usb = new FakeUsb(), dev = new FakeUsbDevice(); usb.chooser = dev; dev.claimInterface = async () => { throw new Error('busy'); };
    const t = new WebUsbTransport(usb); await t.pair();
    await expect(t.open()).rejects.toMatchObject({ code: 'unavailable' });
  });
});

// ---------- Web Bluetooth ----------
class FakeChar implements BtCharacteristic {
  writes: Uint8Array[] = []; busyFor = 0; dead = false;
  constructor(public uuid: string, public properties: { write: boolean; writeWithoutResponse: boolean }, private onDead: () => void) {}
  private async put(d: BufferSource) { if (this.dead) { this.onDead(); throw new Error('link down'); } if (this.busyFor-- > 0) throw new Error('GATT operation already in progress'); this.writes.push(new Uint8Array(d as any).slice()); }
  writeValueWithoutResponse(d: BufferSource) { return this.put(d); }
  writeValueWithResponse(d: BufferSource) { return this.put(d); }
}
class FakeBt implements BtLike {
  connected = false; listeners: (() => void)[] = []; chooser = true; requests = 0; asked: string[] = []; remembered = false; chars: FakeChar[];
  constructor(props = { write: true, writeWithoutResponse: true }) { this.chars = [new FakeChar('info', { write: false, writeWithoutResponse: false }, () => this.drop()), new FakeChar('data', props, () => this.drop())]; }
  drop() { this.connected = false; this.listeners.forEach((l) => l()); }
  device: BtDeviceLike = {
    id: 'p1', name: 'XP-T80A',
    gatt: { connected: false, disconnect: () => this.drop(), connect: async () => { throw new Error('wired in wire()'); } },
    addEventListener: (_t, l) => { this.listeners.push(l); }, removeEventListener: (_t, l) => { this.listeners = this.listeners.filter((x) => x !== l); }
  };
  async requestDevice(o: { optionalServices: string[] }) { this.requests++; this.asked = o.optionalServices; if (!this.chooser) throw new Error('cancelled'); this.remembered = true; return this.wire(); }
  getDevices = async () => (this.remembered ? [this.wire()] : []);
  wire() { const self = this; this.device.gatt!.connect = async () => { self.connected = true; return { get connected() { return self.connected; }, disconnect: () => self.drop(), getPrimaryServices: async () => [{ uuid: 's', getCharacteristics: async () => self.chars }] }; }; return this.device; }
}

describe('Web Bluetooth transport', () => {
  it('pickWritable prefers write-without-response, then write, else null', () => {
    const c = (w: boolean, wr: boolean) => ({ properties: { write: w, writeWithoutResponse: wr } }) as BtCharacteristic;
    const a = c(true, false), b = c(true, true), n = c(false, false);
    expect(pickWritable([n, a, b])).toBe(b); expect(pickWritable([n, a])).toBe(a); expect(pickWritable([n])).toBe(null);
  });
  it('asks Chrome for the known printer services at pairing (otherwise GATT hides them)', async () => {
    const bt = new FakeBt(); await new WebBluetoothTransport(bt).pair();
    expect(bt.asked).toEqual(PRINTER_SERVICES); expect(PRINTER_SERVICES).toContain('49535343-fe7d-4ae5-8fa9-9fafd205e455');
  });
  it('unsupported without Web Bluetooth (e.g. iOS); not paired and no getDevices → disconnected', async () => {
    await expect(new WebBluetoothTransport(undefined).open()).rejects.toMatchObject({ code: 'unsupported' });
    const bt = new FakeBt(); (bt as any).getDevices = undefined;
    await expect(new WebBluetoothTransport(bt).open()).rejects.toMatchObject({ code: 'disconnected' });
  });
  it('prints exact bytes in paced chunks; survives transient "operation in progress"; reuses permission after reload', async () => {
    const bt = new FakeBt(); await new WebBluetoothTransport(bt).pair();
    const a = new BluetoothPrinterAdapter({ chunkSize: 100, chunkDelayMs: 1 }, bt); await a.connect(); // "reload": fresh transport, getDevices()
    expect(bt.requests).toBe(1);
    bt.chars[1].busyFor = 2;
    const b = toThermalBitmap(gradient(384, 12), DEFAULT_THERMAL, 384);
    await a.print(b, job);
    const w = bt.chars[1].writes, sent = new Uint8Array(w.reduce((n, c) => n + c.length, 0)); let o = 0; for (const c of w) { sent.set(c, o); o += c.length; }
    expect([...sent]).toEqual([...encodeRaster(b, { feedLines: 2, cut: false })]);
    expect(w.every((c) => c.length <= 100)).toBe(true);
    expect(bt.chars[0].writes.length).toBe(0); // never writes to the wrong characteristic
  });
  it('a dropped link mid-print → connection-lost; the next connect() rebuilds it', async () => {
    const bt = new FakeBt(); const a = new BluetoothPrinterAdapter({ chunkSize: 50, chunkDelayMs: 0 }, bt);
    await a.pair(); await a.connect();
    bt.chars[1].dead = true;
    await expect(a.print(toThermalBitmap(gradient(384, 12), DEFAULT_THERMAL, 384), job)).rejects.toMatchObject({ code: 'connection-lost' });
    expect((await a.status()).state).toBe('disconnected');
    bt.chars[1].dead = false; await a.connect(); expect((await a.status()).state).toBe('ready');
  });
  it('write-with-response printers work; a printer with no writable characteristic is "unsupported"', async () => {
    const bt = new FakeBt({ write: true, writeWithoutResponse: false }); const a = new BluetoothPrinterAdapter({ chunkSize: 200 }, bt);
    await a.pair(); await a.connect(); await a.print(createBitmap(64, 8), job); expect(bt.chars[1].writes.length).toBeGreaterThan(0);
    const bad = new FakeBt({ write: false, writeWithoutResponse: false }); const t = new WebBluetoothTransport(bad); await t.pair();
    await expect(t.open()).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('EscPosAdapter pacing + lazy options + manager pairing', () => {
  it('chunkDelayMs pauses between chunks but not after the last', async () => {
    const t = new FakeTransport(); await t.open();
    const a = new EscPosAdapter('usb', 'x', t, { chunkSize: 100, chunkDelayMs: 15 });
    const b = createBitmap(384, 6); const n = Math.ceil(encodeRaster(b, { feedLines: 2 }).length / 100);
    const t0 = Date.now(); await a.print(b, job); const dt = Date.now() - t0;
    expect(dt).toBeGreaterThanOrEqual(15 * (n - 1) - 5); expect(n).toBeGreaterThan(1);
  });
  it('options can be a function evaluated at print time', async () => {
    const t = new FakeTransport(); await t.open(); let size = 500;
    const a = new EscPosAdapter('usb', 'x', t, () => ({ chunkSize: size }));
    await a.print(createBitmap(384, 20), job); const first = t.written.length; t.written.length = 0;
    size = 50; await a.print(createBitmap(384, 20), job); expect(t.written.length).toBeGreaterThan(first);
  });
  it('PrinterManager.pair() reaches the transport; cancelled pairing is a PrinterError; mock pairing is a no-op', async () => {
    const usb = new FakeUsb(); usb.chooser = new FakeUsbDevice();
    const mgr = new PrinterManager({ usb: () => new USBPrinterAdapter({}, usb) }, 'usb');
    await mgr.pair(); expect(usb.requests).toBe(1);
    const none = new FakeUsb(); await expect(new PrinterManager({ usb: () => new USBPrinterAdapter({}, none) }, 'usb').pair()).rejects.toBeInstanceOf(PrinterError);
    await new PrinterManager({ mock: () => new MockPrinterAdapter() }, 'mock').pair();
  });
  it('bluetooth settings are clamped', () => {
    expect(mergeSettings({ bluetooth: { chunkSize: 5000, chunkDelayMs: -4 } }).bluetooth).toEqual({ chunkSize: 512, chunkDelayMs: 0 });
    expect(mergeSettings(null).bluetooth).toEqual({ chunkSize: 128, chunkDelayMs: 20 });
  });
});
