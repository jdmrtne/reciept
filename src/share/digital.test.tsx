// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import jsQR from 'jsqr';
import { DigitalPhotoView } from '../digital/DigitalPhotoPage';
import { createdAtFromId, isPhotoId, lookupDigitalPhoto, supabaseSource, type DigitalLookup } from './digital';
import { createShareController, type ShareControllerOptions } from './controller';
import { newSessionId, newShareId } from './id';
import { drawQr, qrMatrix, qrScale } from './qr';
import { qrPngBlob } from './qrDownload';
import type { ShareAsset } from './assets';
import type { ShareSession } from '../state/session';
import { createSupabaseStore, objectPublicUrl } from './supabase';
import { pageUrl, type ShareFile } from './url';

const CFG = { url: 'https://proj.supabase.co', publishableKey: 'sb_publishable_x' };
const SITE = 'https://booth.example.com';
const src = supabaseSource(CFG);
const JPG: ShareAsset = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), type: 'image/jpeg' };
const GIFA: ShareAsset = { bytes: new TextEncoder().encode('GIF89a-fake-body'), type: 'image/gif' };

/** A fake storage + network: which public URLs exist, plus a switch for "storage is down". */
function world(opts: { present?: string[]; down?: boolean; status?: number } = {}) {
  const have = new Set(opts.present ?? []);
  const f = (async (u: string) => {
    if (opts.down) throw new TypeError('Failed to fetch');
    if (opts.status) return new Response(null, { status: opts.status });
    return have.has(String(u)) ? new Response(null, { status: 200 }) : new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
  return { f, have };
}
const urls = (id: string) => ({ jpg: objectPublicUrl(CFG, id, 'photo.jpg'), gif: objectPublicUrl(CFG, id, 'photo.gif') });

/* ---------------------------------------------------------------- lookup */
describe('lookupDigitalPhoto: one id → colour image + GIF', () => {
  it('both stored → both returned, from the same id', async () => {
    const id = newSessionId(), u = urls(id);
    const r = await lookupDigitalPhoto(id, src, world({ present: [u.jpg, u.gif] }).f);
    expect(r).toMatchObject({ state: 'ok', photo: { id, coloredImage: u.jpg, gif: u.gif, status: 'active' } });
  });
  it('missing GIF → colour image alone; missing colour → GIF alone', async () => {
    const id = newSessionId(), u = urls(id);
    expect(await lookupDigitalPhoto(id, src, world({ present: [u.jpg] }).f)).toMatchObject({ state: 'ok', photo: { coloredImage: u.jpg, gif: null } });
    expect(await lookupDigitalPhoto(id, src, world({ present: [u.gif] }).f)).toMatchObject({ state: 'ok', photo: { coloredImage: null, gif: u.gif } });
  });
  it('nothing stored / deleted → notfound', async () => {
    expect(await lookupDigitalPhoto(newSessionId(), src, world().f)).toEqual({ state: 'notfound' });
  });
  it('a bad id never touches the network', async () => {
    const never = (async () => { throw new Error('network used'); }) as unknown as typeof fetch;
    for (const bad of ['', 'abc', '../../x', newShareId().toUpperCase(), 'x'.repeat(3000)]) expect(await lookupDigitalPhoto(bad, src, never), bad).toEqual({ state: 'notfound' });
    expect(await lookupDigitalPhoto(newSessionId(), null, never)).toEqual({ state: 'notfound' }); // no storage configured
  });
  it('storage/network failure → error (retryable), not "gone"', async () => {
    const id = newSessionId();
    expect(await lookupDigitalPhoto(id, src, world({ down: true }).f)).toEqual({ state: 'error' });
    expect(await lookupDigitalPhoto(id, src, world({ status: 503 }).f)).toEqual({ state: 'error' });
  });
  it('one file confirmed + the other inconclusive → still shows what exists, and still offers the unsure one', async () => {
    const id = newSessionId(), u = urls(id);
    const f = (async (x: string) => String(x) === u.jpg ? new Response(null, { status: 200 }) : new Response(null, { status: 500 })) as unknown as typeof fetch;
    expect(await lookupDigitalPhoto(id, src, f)).toMatchObject({ state: 'ok', photo: { coloredImage: u.jpg, gif: u.gif } });
  });
  it('ids: both formats valid; created time comes from the Supabase-style id', () => {
    expect(isPhotoId(newShareId())).toBe(true); expect(isPhotoId(newSessionId())).toBe(true); expect(isPhotoId('nope')).toBe(false);
    expect(createdAtFromId('20260929-103045-a8f32c0d19e4b7a65f10')).toBe('2026-09-29T10:30:45');
    expect(createdAtFromId(newShareId())).toBeNull();
  });
  it('download links carry the attachment switch and match the stored files', () => {
    const id = newSessionId();
    expect(src.assetUrl(id, 'photo.jpg')).toBe(`${CFG.url}/storage/v1/object/public/photobooth-media/photos/${id}/color.jpg`);
    expect(src.downloadUrl(id, 'photo.gif', 'photobooth.gif')).toBe(`${CFG.url}/storage/v1/object/public/photobooth-media/photos/${id}/animation.gif?download=photobooth.gif`);
  });
});

/* ---------------------------------------------------------------- the page (markup per state) */
describe('<DigitalPhotoView/>: every state is clean, friendly and mobile-ready', () => {
  const id = newSessionId(), u = urls(id);
  const ok = (over: Partial<{ coloredImage: string | null; gif: string | null }> = {}): DigitalLookup => ({ state: 'ok', photo: { id, coloredImage: u.jpg, gif: u.gif, createdAt: null, status: 'active', ...over } });
  const html = (l: DigitalLookup | 'loading') => renderToStaticMarkup(<DigitalPhotoView lookup={l} source={src} onRetry={() => {}} />);
  it('both versions: two images, two download buttons that save the right files', () => {
    const h = html(ok());
    expect(h).toContain(`src="${u.jpg}"`); expect(h).toContain(`src="${u.gif}"`);
    expect(h).toContain('DOWNLOAD IMAGE'); expect(h).toContain('DOWNLOAD GIF');
    expect(h).toContain(`href="${u.jpg}?download=photobooth.jpg"`); expect(h).toContain(`href="${u.gif}?download=photobooth.gif"`);
    expect(h.indexOf('COLOR PHOTO')).toBeLessThan(h.indexOf('ANIMATED GIF')); // colour first, then the GIF
  });
  it('missing GIF: colour image still works, with a calm note', () => {
    const h = html(ok({ gif: null }));
    expect(h).toContain(`src="${u.jpg}"`); expect(h).not.toContain('DOWNLOAD GIF'); expect(h).toContain('animated GIF is not available');
  });
  it('missing colour image: the GIF is shown', () => {
    const h = html(ok({ coloredImage: null }));
    expect(h).toContain(`src="${u.gif}"`); expect(h).not.toContain('DOWNLOAD IMAGE'); expect(h).toContain('color photo is not available');
  });
  it('not found / deleted / expired / invalid QR → "no longer available"', () => {
    const h = html({ state: 'notfound' });
    expect(h).toContain('PHOTO NOT FOUND'); expect(h).toContain('This digital photo is no longer available.'); expect(h).not.toContain('<img');
    expect(html(ok({ coloredImage: null, gif: null }))).toContain('PHOTO NOT FOUND'); // nothing left to show
  });
  it('storage/network failure: friendly message with TRY AGAIN, no raw error text', () => {
    const h = html({ state: 'error' });
    expect(h).toContain('COULD NOT LOAD'); expect(h).toContain('TRY AGAIN'); expect(h).not.toMatch(/TypeError|Failed to fetch|supabase|500/i);
  });
  it('loading state', () => expect(html('loading')).toContain('LOADING YOUR PHOTO'));
});

/* ---------------------------------------------------------------- QR image: reusable, scannable, print-ready */
describe('QR image (download now, Phase 2 frame later)', () => {
  const url = pageUrl(SITE, newSessionId());
  const make = (w: number, h: number) => createCanvas(w, h) as unknown as HTMLCanvasElement;
  const decode = (c: { width: number; height: number; getContext(t: '2d'): any }) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height); return jsQR(d.data, c.width, c.height)?.data ?? null; };
  it('the downloaded PNG is the QR alone: square, ≥1024 px, and the decoded image scans back to the page URL', async () => {
    const m = qrMatrix(url);
    let made = false;
    // napi-rs canvas has no toBlob; give the helper one so the real code path (size → drawQr → PNG) runs
    const blob = await qrPngBlob(m, 1024, (w, h) => { const c = createCanvas(w, h); made = true; return Object.assign(c, { toBlob: (cb: (b: Blob) => void, type: string) => cb(new Blob([c.toBuffer('image/png') as BlobPart], { type })) }) as unknown as HTMLCanvasElement; });
    expect(blob.type).toBe('image/png');
    const png = Buffer.from(await blob.arrayBuffer());
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const img = await loadImage(png);
    expect(img.width).toBe(img.height);                    // correct aspect ratio
    expect(img.width).toBeGreaterThanOrEqual(1024);        // print-ready resolution
    expect(img.width % (m.length + 8)).toBe(0);            // whole pixels per module → razor-sharp edges
    const c2 = createCanvas(img.width, img.height), g2 = c2.getContext('2d'); g2.drawImage(img, 0, 0);
    expect(decode(c2)).toBe(url);
    expect(made).toBe(true);
  });
  it('drawQr output scans, has an unbroken white 4-module border and an exact aspect ratio', () => {
    const m = qrMatrix(url), scale = qrScale(m, 1024), side = (m.length + 8) * scale;
    expect(side).toBeGreaterThanOrEqual(1024);
    const c = createCanvas(side, side); drawQr(c.getContext('2d') as never, m, 0, 0, side);
    expect(decode(c)).toBe(url);
    const px = c.getContext('2d').getImageData(0, 0, side, side).data, at = (x: number, y: number) => px[(y * side + x) * 4];
    for (let i = 0; i < side; i += 7) for (const [x, y] of [[i, 0], [i, 4 * scale - 1], [0, i], [4 * scale - 1, i], [side - 1, i], [i, side - 1]]) expect(at(x, y)).toBe(255); // quiet zone is pure white
    expect(at(4 * scale + 1, 4 * scale + 1)).toBe(0); // first finder module is black, drawn exactly on the grid
  });
  it('can be drawn smaller at any position (what Phase 2 does on a frame canvas) and still scans', () => {
    const m = qrMatrix(url), c = createCanvas(900, 1200), g = c.getContext('2d');
    g.fillStyle = '#c33'; g.fillRect(0, 0, 900, 1200); // a frame colour behind it
    drawQr(g as never, m, 300, 800, 330);
    const d = g.getImageData(300, 800, 330, 330);
    expect(jsQR(d.data, 330, 330)?.data).toBe(url);
  });
  it('different sessions give different, independently scannable QRs', () => {
    const a = pageUrl(SITE, newSessionId()), b = pageUrl(SITE, newSessionId());
    for (const u of [a, b]) { const m = qrMatrix(u), s = qrScale(m, 400) , side = (m.length + 8) * s, c = createCanvas(side, side); drawQr(c.getContext('2d') as never, m, 0, 0, side); expect(decode(c)).toBe(u); }
    expect(a).not.toBe(b);
  });
});
