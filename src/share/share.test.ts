// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import jsQR from 'jsqr';
import { mkdtempSync, rmSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createBridge } from '../../bridge/server.mjs';
import { createShareServer, createShareStore } from '../../bridge/share.mjs';
import { buildSnapshot } from '../editor/model';
import { makeCtx } from '../frames/prims';
import type { RenderEnv } from '../render/render';
import { renderColorPhoto, renderGifVersion, GIF_SIZE, type JpegEncoder } from './assets';
import { newShareId } from './id';
import { qrMatrix, QUIET } from './qr';
import { checkShare, prepareShare, type ShareEnv } from './service';
import { normalizePublicBase, publicUrl } from './url';
import { mergeSettings } from '../config/settings';

/* ---------- helpers ---------- */
const listen = (s: Server) => new Promise<number>((res) => s.listen(0, '127.0.0.1', () => res((s.address() as AddressInfo).port)));
const close = (s: Server) => new Promise<void>((res) => { s.closeAllConnections?.(); s.close(() => res()); });
const png = (w: number, h: number, paint: (g: any) => void) => { const c = createCanvas(w, h); paint(c.getContext('2d')); return 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64'); };
const RED = png(1600, 900, (g) => { g.fillStyle = '#f00'; g.fillRect(0, 0, 1600, 900); });
const GREEN = png(1600, 900, (g) => { g.fillStyle = '#0f0'; g.fillRect(0, 0, 1600, 900); });
const BLUE = png(1600, 900, (g) => { g.fillStyle = '#00f'; g.fillRect(0, 0, 1600, 900); });
const sources = (...s: string[]) => s.map((src) => ({ src, iw: 1600, ih: 900 }));
const env: RenderEnv = {
  canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
  image: (s) => loadImage(s.startsWith('data:image/svg+xml;utf8,') ? Buffer.from(decodeURIComponent(s.slice('data:image/svg+xml;utf8,'.length))) : s) as unknown as Promise<CanvasImageSource>
};
const jpeg: JpegEncoder = async (c) => new Uint8Array((c as any).toBuffer('image/jpeg', 90));
const ctx = makeCtx('PHOTOBOOTH', new Date(2026, 8, 29, 10, 0));

/** "Scans" a QR the way a phone would: rasterise the SAME matrix the screen draws (with quiet zone) and decode it with jsQR. */
function scan(m: boolean[][], scale = 8): string | null {
  const n = m.length + QUIET * 2, px = n * scale, data = new Uint8ClampedArray(px * px * 4).fill(255);
  m.forEach((row, y) => row.forEach((dark, x) => { if (!dark) return; for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = (((y + QUIET) * scale + dy) * px + (x + QUIET) * scale + dx) * 4; data[i] = data[i + 1] = data[i + 2] = 0; } }));
  return jsQR(data, px, px)?.data ?? null;
}

let dir: string, store: ReturnType<typeof createShareStore>, bridge: Server, pub: Server, bridgeUrl: string, base: string;
let clock = Date.now();
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'share-'));
  store = createShareStore({ dir, ttlMs: 60_000, now: () => clock });
  bridge = createBridge({ shareStore: store });
  pub = createShareServer(store);
  bridgeUrl = `http://127.0.0.1:${await listen(bridge)}`;
  base = `http://127.0.0.1:${await listen(pub)}`; // the test stands in for "the public address" (loopback allowed only because normalizePublicBase is bypassed here)
});
afterAll(async () => { await close(bridge); await close(pub); rmSync(dir, { recursive: true, force: true }); });

const senv = (over: Partial<ShareEnv> = {}): ShareEnv => ({ fetch: (i, o) => fetch(i, o), bridgeUrl, publicBase: base, ...over });
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const GIF = new TextEncoder().encode('GIF89a-fake-body');

/* ---------- pure pieces ---------- */
describe('share ids and URLs', () => {
  it('ids are 32 hex chars and never repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newShareId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[a-f0-9]{32}$/);
  });
  it('public base must be reachable from a phone', () => {
    expect(normalizePublicBase('https://photos.example.com/')).toBe('https://photos.example.com');
    expect(normalizePublicBase(' http://192.168.1.20:9102 ')).toBe('http://192.168.1.20:9102');
    for (const bad of ['', 'localhost:9102', 'http://localhost:9102', 'http://127.0.0.1:9102', 'ftp://x.com', 'javascript:alert(1)', 'https://x.com/?a=1', 'not a url'])
      expect(normalizePublicBase(bad), bad).toBeNull();
  });
  it('settings: share is off by default and repaired when tampered', () => {
    expect(mergeSettings({}).share).toEqual({ enabled: false, publicBaseUrl: '' });
    expect(mergeSettings({ share: { enabled: 'yes', publicBaseUrl: 5 } } as any).share).toEqual({ enabled: false, publicBaseUrl: '' });
    expect(mergeSettings({ share: { enabled: true, publicBaseUrl: 'https://a.b' } }).share).toEqual({ enabled: true, publicBaseUrl: 'https://a.b' });
  });
});

describe('QR codes are real and scannable', () => {
  it('decodes back to the exact URL, for realistic URLs', () => {
    for (const u of [publicUrl('https://photos.example.com', newShareId(), 'photo.jpg'), publicUrl('http://192.168.1.20:9102', newShareId(), 'photo.gif'), publicUrl('https://a-quite-long-tunnel-name-1234.trycloudflare.com', newShareId(), 'photo.gif')])
      expect(scan(qrMatrix(u))).toBe(u);
  });
  it('still decodes at a small on-screen size (4px modules)', () => {
    const u = publicUrl('https://photos.example.com', newShareId(), 'photo.jpg');
    expect(scan(qrMatrix(u), 4)).toBe(u);
  });
  it('refuses text it cannot encode instead of returning a broken code', () => {
    expect(() => qrMatrix('')).toThrow();
    expect(() => qrMatrix('x'.repeat(400))).toThrow();
  });
});

/* ---------- the bridge's share store + servers ---------- */
describe('share store over HTTP', () => {
  const id = newShareId();
  it('stores an upload and serves it on the public read-only server', async () => {
    const up = await fetch(`${bridgeUrl}/share/${id}/photo.jpg`, { method: 'POST', body: JPG });
    expect(await up.json()).toMatchObject({ ok: true, bytes: JPG.length, ttlMs: 60_000 });
    const got = await fetch(`${base}/s/${id}/photo.jpg`);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(JPG);
    const head = await fetch(`${base}/s/${id}/photo.jpg`, { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe(String(JPG.length));
  });
  it('rejects bad ids, unknown names, fake content and empty bodies', async () => {
    const post = (p: string, body: Uint8Array | string) => fetch(`${bridgeUrl}/share/${p}`, { method: 'POST', body: body as BodyInit }).then((r) => r.status);
    expect(await post('short/photo.jpg', JPG)).toBe(400);
    expect(await post(`${id}/evil.html`, JPG)).toBe(400);
    expect(await post(`${id}/photo.jpg`, '<html>not a jpeg</html>')).toBe(400);
    expect(await post(`${id}/photo.gif`, JPG)).toBe(400);
    expect(await post(`${id}/photo.jpg`, '')).toBe(400);
  });
  it('cannot be walked out of the share folder', async () => {
    for (const p of ['/s/..%2F..%2Fpackage.json/photo.jpg', `/s/${id}/..%2Fphoto.jpg`, '/s/../package.json', `/s/${id}/photo.jpg/../../x`])
      expect([400, 404]).toContain((await fetch(base + p)).status);
    expect(readdirSync(dir).every((n) => /^[a-f0-9]{32}$/.test(n))).toBe(true);
  });
  it('the public server exposes nothing but /s/… (no print, status, upload)', async () => {
    for (const [m, p] of [['GET', '/status?host=10.0.0.11'], ['POST', '/print?host=10.0.0.11'], ['POST', `/share/${id}/photo.jpg`], ['GET', '/'], ['GET', '/printers']] as const)
      expect((await fetch(base + p, { method: m, body: m === 'POST' ? JPG : undefined })).status, `${m} ${p}`).toBe(404);
    expect((await fetch(`${base}/s/${id}/photo.jpg`, { method: 'DELETE' })).status).toBe(405);
  });
  it('files expire after the TTL and the folder is deleted', async () => {
    const old = newShareId();
    await fetch(`${bridgeUrl}/share/${old}/photo.gif`, { method: 'POST', body: GIF });
    expect((await fetch(`${base}/s/${old}/photo.gif`)).status).toBe(200);
    clock += 61_000;
    const gone = await fetch(`${base}/s/${old}/photo.gif`);
    expect(gone.status).toBe(404);
    expect(readdirSync(dir)).not.toContain(old);
    clock = Date.now();
  });
  it('sweep removes only expired sessions; files survive a bridge restart', async () => {
    const keep = newShareId(), drop = newShareId();
    await store.put(keep, 'photo.jpg', Buffer.from(JPG));
    await store.put(drop, 'photo.jpg', Buffer.from(JPG));
    const oldTime = new Date(Date.now() - 3600_000);
    utimesSync(path.join(dir, drop, 'photo.jpg'), oldTime, oldTime);
    const restarted = createShareStore({ dir, ttlMs: 60_000 }); // "restart": fresh process, same disk
    expect(await restarted.get(keep, 'photo.jpg')).not.toBeNull();
    expect(await restarted.sweep()).toBeGreaterThanOrEqual(1);
    expect(readdirSync(dir)).toContain(keep);
    expect(readdirSync(dir)).not.toContain(drop);
  });
});

/* ---------- the whole customer flow ---------- */
describe('capture → photo + GIF → upload → QR → scan → verify', () => {
  it('two QR codes open the right files: real JPEG in colour, real looping GIF', async () => {
    const snap = buildSnapshot('strip-3', sources(RED, GREEN, BLUE));
    const id = newShareId();
    const color = await renderColorPhoto(snap, ctx, 58, env, jpeg);
    const results = await Promise.all([
      prepareShare('photo.jpg', id, async () => color.asset, senv()),
      prepareShare('photo.gif', id, () => renderGifVersion(snap, color.canvas, env), senv())
    ]);
    const [p, g] = results;
    if (!p.ok || !g.ok) throw new Error('flow failed: ' + JSON.stringify(results.map((r) => (r.ok ? 'ok' : r.code))));
    expect(p.url).not.toBe(g.url);

    // Scan QR 1 → colour photo
    const photoUrl = scan(p.matrix)!;
    expect(photoUrl).toBe(`${base}/s/${id}/photo.jpg`);
    const jpgRes = await fetch(photoUrl);
    const jpgBytes = new Uint8Array(await jpgRes.arrayBuffer());
    expect(jpgRes.headers.get('content-type')).toBe('image/jpeg');
    expect(jpgBytes).toEqual(color.asset.bytes);
    const img = await loadImage(Buffer.from(jpgBytes));
    expect(img.width).toBe(color.canvas.width);
    const c = createCanvas(img.width, img.height), cg = c.getContext('2d'); cg.drawImage(img, 0, 0);
    let colourful = 0; const d = cg.getImageData(0, 0, img.width, img.height).data;
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 100) colourful++;
    expect(colourful).toBeGreaterThan(1000); // saturated red/green/blue photos survived: it is a COLOUR photo

    // Scan QR 2 → GIF
    const gifUrl = scan(g.matrix)!;
    expect(gifUrl).toBe(`${base}/s/${id}/photo.gif`);
    const gifRes = await fetch(gifUrl);
    const gb = Buffer.from(await gifRes.arrayBuffer());
    expect(gifRes.headers.get('content-type')).toBe('image/gif');
    expect(gb.subarray(0, 6).toString('latin1')).toBe('GIF89a');
    expect(gb.readUInt16LE(6)).toBe(GIF_SIZE); expect(gb.readUInt16LE(8)).toBe(GIF_SIZE);
    expect(gb.includes(Buffer.from('NETSCAPE2.0'))).toBe(true); // loops forever
    const frames = [...gb.toString('latin1').matchAll(/\x21\xf9\x04/g)].length; // graphic control extension per frame
    expect(frames).toBe(4); // 3 distinct photos + the finished composition
    await loadImage(gb); // decodes as an image
  });

  it('a one-photo layout still animates (photo + finished composition)', async () => {
    const snap = buildSnapshot('single', sources(RED));
    const { canvas } = await renderColorPhoto(snap, ctx, 58, env, jpeg);
    const gif = await renderGifVersion(snap, canvas, env);
    expect([...Buffer.from(gif.bytes).toString('latin1').matchAll(/\x21\xf9\x04/g)].length).toBe(2);
  });

  it('QR from an old session never opens a newer session, and old files stay theirs', async () => {
    const a = newShareId(), b = newShareId();
    const A = new Uint8Array([0xff, 0xd8, 0xff, 1, 1, 1, 1]), B = new Uint8Array([0xff, 0xd8, 0xff, 2, 2, 2, 2, 2]);
    const ra = await prepareShare('photo.jpg', a, async () => ({ bytes: A, type: 'image/jpeg' }), senv());
    const rb = await prepareShare('photo.jpg', b, async () => ({ bytes: B, type: 'image/jpeg' }), senv());
    if (!ra.ok || !rb.ok) throw new Error('setup');
    const oldQr = scan(ra.matrix)!;
    expect(oldQr).toContain(a); expect(oldQr).not.toContain(b);
    expect(new Uint8Array(await (await fetch(oldQr)).arrayBuffer())).toEqual(A); // still session A's bytes after B was made
    expect(new Uint8Array(await (await fetch(scan(rb.matrix)!)).arrayBuffer())).toEqual(B);
  });

  it('multiple consecutive sessions each get their own working, distinct pair', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const snap = buildSnapshot('strip-2', sources(i % 2 ? RED : GREEN, BLUE)), id = newShareId();
      const { canvas, asset } = await renderColorPhoto(snap, ctx, 58, env, jpeg);
      const [p, g] = await Promise.all([prepareShare('photo.jpg', id, async () => asset, senv()), prepareShare('photo.gif', id, () => renderGifVersion(snap, canvas, env), senv())]);
      expect(p.ok && g.ok).toBe(true);
      if (p.ok && g.ok) for (const r of [p, g]) { expect(seen.has(r.url)).toBe(false); seen.add(r.url); expect((await fetch(scan(r.matrix)!)).status).toBe(200); }
    }
    expect(seen.size).toBe(8);
  });
});

/* ---------- failures ---------- */
describe('failure handling (each QR fails on its own, never throws)', () => {
  const id = () => newShareId();
  const ok = async () => ({ bytes: JPG, type: 'image/jpeg' as const });
  it('missing photo → "missing"', async () => {
    expect(await prepareShare('photo.jpg', id(), async () => null, senv())).toEqual({ ok: false, code: 'missing' });
  });
  it('missing GIF source (no photos in the layout) → "missing"', async () => {
    const snap = buildSnapshot('strip-2', []);
    const canvas = createCanvas(10, 10) as unknown as HTMLCanvasElement;
    expect(await prepareShare('photo.gif', id(), () => renderGifVersion(snap, canvas, env), senv())).toEqual({ ok: false, code: 'missing' });
  });
  it('renderer crash → "render"', async () => {
    expect(await prepareShare('photo.jpg', id(), async () => { throw new Error('canvas exploded'); }, senv())).toEqual({ ok: false, code: 'render' });
  });
  it('no/loopback public address → "config" (nothing is uploaded)', async () => {
    expect(await prepareShare('photo.jpg', id(), ok, senv({ publicBase: normalizePublicBase('http://localhost:9102') }))).toEqual({ ok: false, code: 'config' });
  });
  it('bridge down → "upload"', async () => {
    expect(await prepareShare('photo.jpg', id(), ok, senv({ bridgeUrl: 'http://127.0.0.1:9' }))).toEqual({ ok: false, code: 'upload' });
  });
  it('bridge rejects the file → "upload"', async () => {
    expect(await prepareShare('photo.jpg', id(), async () => ({ bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7]), type: 'image/jpeg' }), senv())).toEqual({ ok: false, code: 'upload' });
  });
  it('upload saved but the PUBLIC address does not serve it → "unreachable" (no QR to nowhere)', async () => {
    expect(await prepareShare('photo.jpg', id(), ok, senv({ publicBase: 'http://127.0.0.1:9' }))).toEqual({ ok: false, code: 'unreachable' });
  });
  it('bytes damaged in transit → "upload"', async () => {
    const lying: typeof fetch = async (i, o) => { const r = await fetch(i, o); return String(i).includes('/share/') ? new Response(JSON.stringify({ ok: true, bytes: 1 }), { status: 200 }) : r; };
    expect(await prepareShare('photo.jpg', id(), ok, senv({ fetch: lying }))).toEqual({ ok: false, code: 'upload' });
  });
  it('QR cannot be built (absurdly long address) → "qr", never a broken code', async () => {
    const longBase = 'https://photos.example.com/' + 'a'.repeat(320);
    const pretend: typeof fetch = async (i, o) => String(i).startsWith(longBase) ? new Response(null, { status: 200, headers: { 'content-length': String(JPG.length) } }) : fetch(i, o);
    expect(await prepareShare('photo.jpg', id(), ok, senv({ publicBase: longBase, fetch: pretend }))).toEqual({ ok: false, code: 'qr' });
  });
  it('retry after a failure works (same id, file replaced)', async () => {
    const i = id();
    expect((await prepareShare('photo.jpg', i, ok, senv({ bridgeUrl: 'http://127.0.0.1:9' }))).ok).toBe(false);
    expect((await prepareShare('photo.jpg', i, ok, senv())).ok).toBe(true);
  });
  it('ADMIN check reports success and the precise failure', async () => {
    expect(await checkShare(id(), senv())).toBeNull();
    expect(await checkShare(id(), senv({ publicBase: null }))).toBe('config');
    expect(await checkShare(id(), senv({ bridgeUrl: 'http://127.0.0.1:9' }))).toBe('upload');
    expect(await checkShare(id(), senv({ publicBase: 'http://127.0.0.1:9' }))).toBe('unreachable');
  });
  it('an aborted request (screen left / session reset) stops cleanly', async () => {
    const ac = new AbortController(); ac.abort();
    expect(await prepareShare('photo.jpg', id(), ok, senv({ signal: ac.signal }))).toEqual({ ok: false, code: 'upload' });
  });
});
