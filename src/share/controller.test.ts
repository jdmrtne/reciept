// @vitest-environment node
import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { createShareController, FILES, type ShareControllerOptions, type ShareView } from './controller';
import { lookupDigitalPhoto, supabaseSource } from './digital';
import { newSessionId } from './id';
import { QUIET } from './qr';
import type { ShareAsset } from './assets';
import type { ShareStore, StoreResult } from './service';
import { createSupabaseStore, objectPublicUrl, objectPath, BUCKET } from './supabase';
import type { ShareSession } from '../state/session';
import type { ShareFile } from './url';

const CFG = { url: 'https://proj.supabase.co', publishableKey: 'sb_publishable_x' };
const SITE = 'https://booth.example.com';
const JPG: ShareAsset = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), type: 'image/jpeg' };
const GIFA: ShareAsset = { bytes: new TextEncoder().encode('GIF89a-fake-body'), type: 'image/gif' };

const scan = (m: boolean[][], scale = 6) => {
  const n = m.length + QUIET * 2, px = n * scale, data = new Uint8ClampedArray(px * px * 4).fill(255);
  m.forEach((row, y) => row.forEach((d, x) => { if (!d) return; for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = (((y + QUIET) * scale + dy) * px + (x + QUIET) * scale + dx) * 4; data[i] = data[i + 1] = data[i + 2] = 0; } }));
  return jsQR(data, px, px)?.data ?? null;
};

/** In-memory Supabase-like storage (real createSupabaseStore on top, so retry/collision rules are the real ones). */
function storage(opts: { failFile?: ShareFile; failTimes?: number } = {}) {
  const files = new Map<string, number>(); let failLeft = opts.failTimes ?? Infinity; const uploads: string[] = [];
  const client = { storage: { from: (b: string) => ({
    upload: async (path: string, body: Blob, o: { upsert: boolean }) => {
      uploads.push(path);
      if (opts.failFile && path.endsWith(opts.failFile === 'photo.gif' ? 'animation.gif' : 'color.jpg') && failLeft-- > 0) throw new TypeError('Failed to fetch');
      if (files.has(path) && !o.upsert) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
      files.set(path, body.size); return { data: { path }, error: null };
    },
    getPublicUrl: (path: string) => ({ data: { publicUrl: `${CFG.url}/storage/v1/object/public/${b}/${path}` } })
  }) } };
  const fetchImpl = (async (u: string) => { const p = String(u).split(`/public/${BUCKET}/`)[1], n = files.get(p); return n === undefined ? new Response(null, { status: 404 }) : new Response(null, { status: 200, headers: { 'content-length': String(n) } }); }) as unknown as typeof fetch;
  return { files, uploads, store: createSupabaseStore(CFG, { client: client as never, fetchImpl, retryDelays: [0], timeoutMs: 1000 }), fetchImpl };
}

function setup(over: { store?: ShareStore; pageBase?: string | null; make?: ShareControllerOptions['make']; session?: ShareSession | null; makeId?: () => string } = {}) {
  let session: ShareSession | null = over.session ?? null;
  const st = storage();
  const opts: ShareControllerOptions = {
    makeId: over.makeId ?? newSessionId,
    session: { get: () => session, set: (s) => { session = s; } },
    make: over.make ?? (async (f) => (f === 'photo.jpg' ? JPG : GIFA)),
    env: { fetch: (() => { throw new Error('bridge must not be used'); }) as never, bridgeUrl: '', publicBase: null, pageBase: over.pageBase === undefined ? SITE : over.pageBase, store: over.store ?? st.store }
  };
  return { opts, st, session: () => session };
}
const done = (c: ReturnType<typeof createShareController>) => new Promise<ShareView>((res) => {
  const check = (v: ShareView) => { if (FILES.every((f) => v.files[f].s !== 'loading')) res(v); };
  c.subscribe(check); check(c.get());
});

describe('share controller: one session → ONE id → ONE QR → both files', () => {
  it('happy path: one unique id, both files stored under it, one QR that decodes to /p/<id>', async () => {
    const t = setup(), c = createShareController(t.opts); c.start();
    const v = await done(c);
    const id = t.session()!.id;
    expect(v.files).toEqual({ 'photo.jpg': { s: 'ok' }, 'photo.gif': { s: 'ok' } });
    expect([...t.st.files.keys()].sort()).toEqual([`photos/${id}/animation.gif`, `photos/${id}/color.jpg`]);
    expect(v.qr?.s).toBe('ok');
    if (v.qr?.s !== 'ok') return;
    expect(v.qr.url).toBe(`${SITE}/p/${id}`);
    expect(scan(v.qr.matrix)).toBe(`${SITE}/p/${id}`);
    expect(t.session()).toMatchObject({ id, pageUrl: `${SITE}/p/${id}`, done: expect.arrayContaining(['photo.jpg', 'photo.gif']) });
    // the page the QR opens resolves BOTH assets from that same id
    const page = await lookupDigitalPhoto(id, supabaseSource(CFG), t.st.fetchImpl);
    expect(page).toMatchObject({ state: 'ok', photo: { id, coloredImage: objectPublicUrl(CFG, id, 'photo.jpg'), gif: objectPublicUrl(CFG, id, 'photo.gif') } });
    c.dispose();
  });

  it('different generated photos get different ids and different QRs', async () => {
    const urls = new Set<string>(), ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const t = setup(), c = createShareController(t.opts); c.start();
      const v = await done(c);
      if (v.qr?.s !== 'ok') throw new Error('no qr');
      urls.add(v.qr.url); ids.add(t.session()!.id); c.dispose();
    }
    expect(urls.size).toBe(5); expect(ids.size).toBe(5);
  });

  it('revisiting the screen keeps the SAME id and QR and does not upload again', async () => {
    const t = setup(); let c = createShareController(t.opts); c.start();
    const first = await done(c); c.dispose();
    const uploadsAfterFirst = t.st.uploads.length;
    c = createShareController(t.opts); c.start();   // user comes back to the share screen (same session store)
    const again = await done(c);
    if (first.qr?.s !== 'ok' || again.qr?.s !== 'ok') throw new Error('no qr');
    expect(again.qr.url).toBe(first.qr.url);
    expect(scan(again.qr.matrix)).toBe(scan(first.qr.matrix));
    expect(t.st.uploads.length).toBe(uploadsAfterFirst);  // nothing re-uploaded, so nothing can collide or duplicate
    c.dispose();
  });

  it('GIF fails → the QR still appears (page shows the colour image); RETRY later fixes the GIF under the SAME QR', async () => {
    const st = storage({ failFile: 'photo.gif', failTimes: 2 }); // both upload attempts of the first try fail
    const t = setup({ store: st.store }), c = createShareController(t.opts); c.start();
    const v = await done(c), id = t.session()!.id;
    expect(v.files['photo.jpg']).toEqual({ s: 'ok' }); expect(v.files['photo.gif']).toEqual({ s: 'error', code: 'upload' });
    if (v.qr?.s !== 'ok') throw new Error('QR must exist with one file stored');
    const before = v.qr.url;
    expect(await lookupDigitalPhoto(id, supabaseSource(CFG), st.fetchImpl)).toMatchObject({ state: 'ok', photo: { gif: null } }); // only the colour image exists for now
    c.retry('photo.gif');
    const v2 = await new Promise<ShareView>((res) => c.subscribe((x) => x.files['photo.gif'].s === 'ok' && res(x)));
    expect(v2.qr?.s === 'ok' && v2.qr.url).toBe(before);   // the QR never changed
    expect(await lookupDigitalPhoto(id, supabaseSource(CFG), st.fetchImpl)).toMatchObject({ state: 'ok', photo: { gif: objectPublicUrl(CFG, id, 'photo.gif') } });
    c.dispose();
  });

  it('colour fails → GIF alone is enough for a QR', async () => {
    const t = setup({ make: async (f) => { if (f === 'photo.jpg') throw new Error('boom'); return GIFA; } }), c = createShareController(t.opts); c.start();
    const v = await done(c);
    expect(v.files['photo.jpg']).toEqual({ s: 'error', code: 'render' }); expect(v.files['photo.gif']).toEqual({ s: 'ok' });
    expect(v.qr?.s).toBe('ok'); c.dispose();
  });

  it('both fail → no QR at all (never a QR to nothing)', async () => {
    const t = setup({ make: async () => null }), c = createShareController(t.opts); c.start();
    const v = await done(c);
    expect(v.files).toEqual({ 'photo.jpg': { s: 'error', code: 'missing' }, 'photo.gif': { s: 'error', code: 'missing' } });
    expect(v.qr).toBeNull(); c.dispose();
  });

  it('no site address known (booth on localhost, none typed in ADMIN) → config error, nothing uploaded', async () => {
    const t = setup({ pageBase: null }), c = createShareController(t.opts); c.start();
    const v = await done(c);
    expect(FILES.map((f) => v.files[f])).toEqual([{ s: 'error', code: 'config' }, { s: 'error', code: 'config' }]);
    expect(v.qr).toBeNull(); expect(t.st.uploads).toEqual([]); c.dispose();
  });

  it('a revisit after a half-landed upload (timed out but stored) succeeds instead of colliding', async () => {
    const id = newSessionId(), t = setup({ session: { id, done: [], pageUrl: null, ttlMs: null } });
    t.st.files.set(objectPath(id, 'photo.jpg'), JPG.bytes.length); // a previous visit's upload really landed
    const c = createShareController(t.opts); c.start();
    const v = await done(c);
    expect(v.files['photo.jpg']).toEqual({ s: 'ok' });
    expect(t.session()!.id).toBe(id);                     // same id, so same QR
    c.dispose();
  });

  it('a genuine id collision swaps to a fresh id for BOTH files and the QR matches the new id', async () => {
    const taken = newSessionId(), fresh = newSessionId(); let n = 0;
    const t = setup({ makeId: () => (n++ === 0 ? taken : fresh) });
    t.st.files.set(objectPath(taken, 'photo.jpg'), 999); t.st.files.set(objectPath(taken, 'photo.gif'), 999); // someone else's files
    const c = createShareController(t.opts); c.start();
    const v = await done(c);
    expect(t.session()!.id).toBe(fresh);
    expect(t.st.files.get(objectPath(taken, 'photo.jpg'))).toBe(999); // untouched
    expect(v.qr?.s === 'ok' && v.qr.url).toBe(`${SITE}/p/${fresh}`);
    expect([...t.st.files.keys()]).toEqual(expect.arrayContaining([objectPath(fresh, 'photo.jpg'), objectPath(fresh, 'photo.gif')]));
    c.dispose();
  });

  it('leaving the screen mid-upload stops cleanly (no late updates)', async () => {
    const t = setup({ make: () => new Promise(() => {}) }), c = createShareController(t.opts);
    const seen: ShareView[] = []; c.subscribe((v) => seen.push(v)); c.start(); c.dispose();
    expect(seen.every((v) => v.qr === null)).toBe(true);
  });
});
