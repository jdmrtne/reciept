import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { newSessionId, SESSION_ID_RE } from './id';
import { makePageQr, uploadShareFile, type ShareEnv, type ShareStore } from './service';
import { BUCKET, createSupabaseStore, objectPath, supabaseConfigFromEnv } from './supabase';
import { qrMatrix, QUIET } from './qr';

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const GIF = new TextEncoder().encode('GIF89a-fake-body');
const URL_BASE = 'https://proj.supabase.co';
const SITE = 'https://booth.example.com'; // where the booth app (which serves /p/<id>) is hosted

/** In-memory stand-in for Supabase Storage (supabase-js `storage.from().upload / getPublicUrl`). */
function fakeClient(opts: { failUploads?: number; error?: { message: string; statusCode: string }; throwNetwork?: boolean } = {}) {
  const files = new Map<string, { size: number; type: string }>();
  let failLeft = opts.failUploads ?? 0, calls = 0;
  const client = { storage: { from: (b: string) => ({
    upload: async (path: string, body: Blob, o: { contentType: string; upsert: boolean }) => {
      calls++;
      if (opts.throwNetwork || failLeft-- > 0) throw new TypeError('Failed to fetch');
      if (opts.error) return { data: null, error: opts.error };
      if (files.has(path) && !o.upsert) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
      files.set(path, { size: body.size, type: o.contentType });
      return { data: { path }, error: null };
    },
    getPublicUrl: (path: string) => ({ data: { publicUrl: `${URL_BASE}/storage/v1/object/public/${b}/${path}` } })
  }) } };
  return { client: client as never, files, calls: () => calls };
}
const headOk = (files: Map<string, { size: number }>): typeof fetch => (async (u: string) => {
  const p = String(u).split(`/public/${BUCKET}/`)[1], f = files.get(p);
  return f ? new Response(null, { status: 200, headers: { 'content-length': String(f.size) } }) : new Response(null, { status: 404 });
}) as never;
const mk = (c: ReturnType<typeof fakeClient>, extra: Parameters<typeof createSupabaseStore>[1] = {}) =>
  createSupabaseStore({ url: URL_BASE, publishableKey: 'sb_publishable_x' }, { client: c.client, fetchImpl: headOk(c.files), retryDelays: [0, 0], ...extra });
const senv = (store: ShareStore, over: Partial<ShareEnv> = {}): ShareEnv => ({ fetch: (() => { throw new Error('bridge must not be used'); }) as never, bridgeUrl: '', publicBase: null, pageBase: SITE, store, ...over });
const scan = (m: boolean[][], scale = 8) => {
  const n = m.length + QUIET * 2, px = n * scale, data = new Uint8ClampedArray(px * px * 4).fill(255);
  m.forEach((row, y) => row.forEach((d, x) => { if (!d) return; for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = (((y + QUIET) * scale + dy) * px + (x + QUIET) * scale + dx) * 4; data[i] = data[i + 1] = data[i + 2] = 0; } }));
  return jsQR(data, px, px)?.data ?? null;
};

describe('session id', () => {
  it('is YYYYMMDD-HHMMSS-random and unique', () => {
    const id = newSessionId(new Date(2026, 8, 29, 10, 30, 45));
    expect(id).toMatch(SESSION_ID_RE);
    expect(id.startsWith('20260929-103045-')).toBe(true);
    expect(new Set(Array.from({ length: 500 }, () => newSessionId())).size).toBe(500);
  });
});

describe('config', () => {
  it('needs https URL + key, and refuses secret keys', () => {
    expect(supabaseConfigFromEnv({ VITE_SUPABASE_URL: 'https://a.supabase.co/', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1' })).toEqual({ url: 'https://a.supabase.co', publishableKey: 'sb_publishable_1' });
    expect(supabaseConfigFromEnv({})).toBeNull();
    expect(supabaseConfigFromEnv({ VITE_SUPABASE_URL: 'http://a.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toBeNull();
    expect(supabaseConfigFromEnv({ VITE_SUPABASE_URL: 'https://a.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' })).toBeNull();
  });
});

describe('Supabase share flow', () => {
  it('uploads both files under one session folder; the ONE QR decodes to the site\'s /p/<id> page', async () => {
    const c = fakeClient(), store = mk(c), id = newSessionId();
    const a = await uploadShareFile('photo.jpg', id, async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(store));
    const b = await uploadShareFile('photo.gif', id, async () => ({ bytes: GIF, type: 'image/gif' }), senv(store));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.url).toBe(`${URL_BASE}/storage/v1/object/public/photobooth-media/photos/${id}/color.jpg`);
    expect(b.url).toBe(`${URL_BASE}/storage/v1/object/public/photobooth-media/photos/${id}/animation.gif`);
    const qr = makePageQr(SITE, id);
    if (!qr.ok) throw new Error('qr');
    expect(scan(qr.matrix)).toBe(`${SITE}/p/${id}`);          // one QR, one URL, only the id: no image, no storage address inside
    expect([...c.files.keys()].sort()).toEqual([`photos/${id}/animation.gif`, `photos/${id}/color.jpg`]);
    expect(c.files.get(objectPath(id, 'photo.gif'))!.type).toBe('image/gif');
  });

  it('no site address (and the booth runs on localhost) → "config", nothing uploaded', async () => {
    const c = fakeClient();
    expect(await uploadShareFile('photo.jpg', newSessionId(), async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(mk(c), { pageBase: null }))).toEqual({ ok: false, code: 'config' });
    expect(c.calls()).toBe(0);
  });

  it('a retry of a file that already landed (same size) is accepted, never overwritten; a different file is still a collision', async () => {
    const c = fakeClient(), store = mk(c), id = newSessionId();
    await uploadShareFile('photo.jpg', id, async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(store));
    const again = await uploadShareFile('photo.jpg', id, async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(store, { allowExisting: true }));
    expect(again.ok).toBe(true);
    const other = await uploadShareFile('photo.jpg', id, async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 7]), type: 'image/jpeg' }), senv(store, { allowExisting: true }));
    expect(other).toEqual({ ok: false, code: 'collision' });
    expect(c.files.get(`photos/${id}/color.jpg`)!.size).toBe(JPG.length);
  });

  it('session B never touches session A', async () => {
    const c = fakeClient(), store = mk(c), A = newSessionId(), B = newSessionId();
    const a1 = await uploadShareFile('photo.jpg', A, async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(store));
    const b1 = await uploadShareFile('photo.jpg', B, async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 9]), type: 'image/jpeg' }), senv(store));
    if (!a1.ok || !b1.ok) throw new Error('expected ok');
    expect(a1.url).toContain(A); expect(b1.url).toContain(B); expect(a1.url).not.toBe(b1.url);
    expect(c.files.get(`photos/${A}/color.jpg`)!.size).toBe(JPG.length);
  });

  it('retries a transient network error, then succeeds', async () => {
    const c = fakeClient({ failUploads: 2 });
    const r = await uploadShareFile('photo.jpg', newSessionId(), async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(mk(c)));
    expect(r.ok).toBe(true); expect(c.calls()).toBe(3);
  });

  it('internet down → upload error, NO QR', async () => {
    const c = fakeClient({ throwNetwork: true });
    const r = await uploadShareFile('photo.jpg', newSessionId(), async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(mk(c)));
    expect(r).toEqual({ ok: false, code: 'upload' }); expect(c.calls()).toBe(3);
  });

  it('policy / bucket error (4xx) fails fast without retries', async () => {
    const c = fakeClient({ error: { message: 'new row violates row-level security policy', statusCode: '403' } });
    const r = await uploadShareFile('photo.jpg', newSessionId(), async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(mk(c)));
    expect(r).toEqual({ ok: false, code: 'upload' }); expect(c.calls()).toBe(1);
  });

  it('a hung upload times out instead of freezing', async () => {
    const hang = { storage: { from: () => ({ upload: () => new Promise(() => {}), getPublicUrl: () => ({ data: { publicUrl: 'x' } }) }) } } as never;
    const store = createSupabaseStore({ url: URL_BASE, publishableKey: 'k' }, { client: hang, retryDelays: [], timeoutMs: 20 });
    expect(await uploadShareFile('photo.jpg', newSessionId(), async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(store))).toEqual({ ok: false, code: 'upload' });
  });

  it('same id twice → collision (never overwrites)', async () => {
    const c = fakeClient(), store = mk(c), id = newSessionId();
    await uploadShareFile('photo.jpg', id, async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(store));
    const again = await uploadShareFile('photo.jpg', id, async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 7]), type: 'image/jpeg' }), senv(store));
    expect(again).toEqual({ ok: false, code: 'collision' });
    expect(c.files.get(`photos/${id}/color.jpg`)!.size).toBe(JPG.length);
  });

  it('public link 404 → unreachable, NO QR', async () => {
    const c = fakeClient(), store = createSupabaseStore({ url: URL_BASE, publishableKey: 'k' }, { client: c.client, fetchImpl: (async () => new Response(null, { status: 404 })) as never, retryDelays: [] });
    expect(await uploadShareFile('photo.jpg', newSessionId(), async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(store))).toEqual({ ok: false, code: 'unreachable' });
  });

  it('verification network hiccup does not discard an acknowledged upload', async () => {
    const c = fakeClient(), store = createSupabaseStore({ url: URL_BASE, publishableKey: 'k' }, { client: c.client, fetchImpl: (async () => { throw new TypeError('cors'); }) as never, retryDelays: [] });
    expect((await uploadShareFile('photo.jpg', newSessionId(), async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(store))).ok).toBe(true);
  });

  it('missing photo / missing GIF / render crash → no upload, no QR', async () => {
    const c = fakeClient(), store = mk(c);
    expect(await uploadShareFile('photo.jpg', newSessionId(), async () => null, senv(store))).toEqual({ ok: false, code: 'missing' });
    expect(await uploadShareFile('photo.gif', newSessionId(), async () => { throw new Error('no-photos'); }, senv(store))).toEqual({ ok: false, code: 'missing' });
    expect(await uploadShareFile('photo.gif', newSessionId(), async () => { throw new Error('boom'); }, senv(store))).toEqual({ ok: false, code: 'render' });
    expect(c.calls()).toBe(0);
  });

  it('GIF failing does not affect the colour file (independent)', async () => {
    const c = fakeClient(), store = mk(c), id = newSessionId();
    const a = await uploadShareFile('photo.jpg', id, async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(store));
    const b = await uploadShareFile('photo.gif', id, async () => { throw new Error('boom'); }, senv(store));
    expect(a.ok).toBe(true); expect(b).toEqual({ ok: false, code: 'render' });
  });

  it('reports phases in order', async () => {
    const seen: string[] = [];
    await uploadShareFile('photo.jpg', newSessionId(), async () => ({ bytes: JPG, type: 'image/jpeg' }), senv(mk(fakeClient()), { onPhase: (p) => seen.push(p) }));
    expect(seen).toEqual(['preparing', 'uploading', 'qr']);
  });

  it('qr text length is fine for a real Supabase URL', () => {
    expect(() => qrMatrix(`https://fkwwgdpcjryxoqkcxawm.supabase.co/storage/v1/object/public/photobooth-media/photos/${newSessionId()}/animation.gif`)).not.toThrow();
  });
});
