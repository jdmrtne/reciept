import { describe, expect, it } from 'vitest';
import { createUpdater, describeStatus, PENDING_KEY, type Deps, type RegistrationLike, type ServiceWorkerLike } from './updater';
import type { KeyValue } from './updateSource';

const O = 'https://booth.test';
const INSTALLED = { version: '1.0.0', build: 'aaa1111', builtAt: '2026-10-01T00:00:00Z' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mem = (): KeyValue & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
};

const manifest = (over: Record<string, unknown> = {}) => ({ version: '1.1.0', build: 'bbb2222', builtAt: '2026-11-01T00:00:00Z', files: [{ url: '/assets/a.js', size: 6 }, { url: '/assets/b.css', size: 4 }], ...over });
const json = (o: unknown, init?: ResponseInit) => new Response(JSON.stringify(o), init);

interface Routes { [path: string]: () => Response | Promise<Response> }
function fakeFetch(routes: Routes, seen: string[] = []): Deps['fetch'] {
  return async (input, init) => {
    const u = new URL(input); seen.push(u.pathname);
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const r = routes[u.pathname];
    if (!r) return new Response('missing', { status: 404 });
    return r();
  };
}

class Worker implements ServiceWorkerLike {
  private cbs = new Set<() => void>();
  constructor(public state: string = 'installing') {}
  addEventListener(_t: 'statechange', cb: () => void) { this.cbs.add(cb); }
  removeEventListener(_t: 'statechange', cb: () => void) { this.cbs.delete(cb); }
  to(state: string) { this.state = state; [...this.cbs].forEach((f) => f()); }
}
class Reg implements RegistrationLike {
  waiting: ServiceWorkerLike | null = null;
  installing: ServiceWorkerLike | null = null;
  updates = 0;
  constructor(private onUpdate: (r: Reg) => void | Promise<void> = () => {}) {}
  async update() { this.updates++; await this.onUpdate(this); }
}

function make(routes: Routes, over: Partial<Deps> = {}) {
  const storage = mem(), seen: string[] = [];
  let t = 1000;
  const u = createUpdater({ installed: INSTALLED, getSource: () => '/version.json', origin: O, online: () => true, fetch: fakeFetch(routes, seen), now: () => (t += 200), storage, timeouts: { check: 500, download: 200, install: 60 }, ...over });
  return { u, storage, seen };
}
const ok = (): Routes => ({ '/version.json': () => json(manifest()), '/assets/a.js': () => new Response('aaaaaa'), '/assets/b.css': () => new Response('bbbb') });

describe('check', () => {
  it('finds a newer version and shows both versions', async () => {
    const { u } = make(ok());
    await u.check();
    expect(u.get()).toMatchObject({ phase: 'available', installed: INSTALLED, latest: { version: '1.1.0', totalBytes: 10 }, download: { bytes: 10 } });
    expect(u.get().checkedAt).not.toBeNull();
  });
  it('offers a new build of the same version number (deploy without a version bump)', async () => {
    const { u } = make({ ...ok(), '/version.json': () => json(manifest({ version: '1.0.0' })) });
    await u.check();
    expect(u.get().phase).toBe('available');
    expect(describeStatus(u.get()).text).toContain('NEW BUILD bbb2222');
  });
  it('does not offer a redeploy of the same commit', async () => {
    const { u } = make({ ...ok(), '/version.json': () => json(manifest({ version: '1.0.0', build: 'aaa1111' })) });
    await u.check();
    expect(u.get().phase).toBe('current');
  });
  it('asks the source with a cache-busting query and never reuses a cached answer', async () => {
    let seenUrl = '', seenInit: RequestInit | undefined;
    const { u } = make({}, { fetch: async (i, init) => { seenUrl = i; seenInit = init; return json(manifest()); } });
    await u.check();
    expect(seenUrl).toMatch(/^https:\/\/booth\.test\/version\.json\?t=\d+$/);
    expect(seenInit?.cache).toBe('no-store');
  });
  it('same version = up to date; an older source is explained, not offered', async () => {
    const same = make({ '/version.json': () => json(manifest({ version: '1.0.0', build: 'aaa1111', builtAt: '2026-10-01T00:00:00Z' })) });
    await same.u.check();
    expect(same.u.get().phase).toBe('current');
    const older = make({ '/version.json': () => json(manifest({ version: '0.9.0' })) });
    await older.u.check();
    expect(older.u.get()).toMatchObject({ phase: 'current' });
    expect(older.u.get().notice).toMatch(/OLDER VERSION/);
  });
  it.each([
    ['404', () => new Response('nope', { status: 404 }), /NOT FOUND \(404\)/],
    ['500', () => new Response('boom', { status: 500 }), /ERROR \(500\)/],
    ['a web page instead of the file (host rewrites unknown paths to index.html)', () => new Response('<!doctype html><html>', { status: 200 }), /WEB PAGE, NOT A VERSION FILE/],
    ['unreadable text', () => new Response('hello', { status: 200 }), /READABLE VERSION FILE/],
    ['a file with no valid version', () => json({ version: 'soon' }), /NO VALID VERSION NUMBER/]
  ])('explains %s', async (_n, res, msg) => {
    const { u } = make({ '/version.json': res });
    await u.check();
    expect(u.get()).toMatchObject({ phase: 'error', errorStep: 'check' });
    expect(u.get().error).toMatch(msg);
  });
  it('says so when offline, and when the source is unreachable or too slow', async () => {
    const off = make(ok(), { online: () => false });
    await off.u.check();
    expect(off.u.get().error).toMatch(/NO INTERNET/);
    const down = make({}, { fetch: async () => { throw new TypeError('Failed to fetch'); } });
    await down.u.check();
    expect(down.u.get().error).toMatch(/COULD NOT REACH THE UPDATE SOURCE/);
    const slow = make({}, { fetch: (_i, init) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('a', 'AbortError')))), timeouts: { check: 20, download: 200, install: 60 } });
    await slow.u.check();
    expect(slow.u.get().error).toMatch(/DID NOT ANSWER WITHIN/);
  });
  it('can be retried after an error', async () => {
    let fail = true;
    const { u } = make({ '/version.json': () => (fail ? new Response('x', { status: 503 }) : json(manifest())) });
    await u.check(); expect(u.get().phase).toBe('error');
    fail = false; await u.check(); expect(u.get().phase).toBe('available');
    expect(u.get().error).toBeNull();
  });
});

describe('download size', () => {
  it('counts and fetches only the files this device does not already hold', async () => {
    const { u, seen } = make(ok(), { isCached: async (url) => url.endsWith('/assets/a.js') });
    u.attach(new Reg((r) => { r.waiting = new Worker('installed'); }));
    await u.check();
    expect(u.get().download).toMatchObject({ bytes: 4, files: [{ url: `${O}/assets/b.css`, size: 4 }] });
    expect(describeStatus(u.get()).text).toMatch(/\(1 KB TO DOWNLOAD\)/);
    await u.download();
    expect(seen).not.toContain('/assets/a.js');
    expect(u.get().phase).toBe('ready');
  });
  it('goes straight to installing when every listed file is already here', async () => {
    const { u, seen } = make(ok(), { isCached: async () => true });
    u.attach(new Reg((r) => { r.waiting = new Worker('installed'); }));
    await u.check(); await u.download();
    expect(seen.filter((p) => p.startsWith('/assets'))).toEqual([]);
    expect(u.get().phase).toBe('ready');
  });
});

describe('download', () => {
  it('does nothing unless an update is available', async () => {
    const { u, seen } = make(ok());
    await u.download();
    expect(u.get().phase).toBe('idle'); expect(seen).toEqual([]);
  });
  it('explains a page with no service worker (dev server, http, unsupported browser)', async () => {
    const { u } = make(ok());
    await u.check(); await u.download();
    expect(u.get()).toMatchObject({ phase: 'error', errorStep: 'download' });
    expect(u.get().error).toMatch(/SERVICE WORKER/);
    expect(u.get().latest?.version).toBe('1.1.0'); // still known, so RETRY works
  });
  it('streams the files with real byte progress, then installs the new service worker and waits', async () => {
    const { u, seen } = make(ok());
    const worker = new Worker();
    const reg = new Reg((r) => { r.installing = worker; setTimeout(() => worker.to('installed'), 5); });
    u.attach(reg);
    await u.check();
    const phases: string[] = [], bytes: number[] = [];
    u.subscribe(() => { const s = u.get(); phases.push(s.phase + (s.progress ? `:${s.progress.stage}` : '')); if (s.progress?.stage === 'files') bytes.push(s.progress.loaded); });
    await u.download();
    expect(seen.filter((p) => p.startsWith('/assets'))).toEqual(expect.arrayContaining(['/assets/a.js', '/assets/b.css']));
    expect(Math.max(...bytes)).toBe(10); // 6 + 4 bytes, counted from the streams
    expect(phases).toContain('downloading:files'); expect(phases).toContain('downloading:package');
    expect(u.get()).toMatchObject({ phase: 'ready', progress: null, error: null });
    expect(reg.updates).toBe(1);
  });
  it('a file that fails stops the download with the file name, and RETRY works', async () => {
    let bad = true;
    const routes = { ...ok(), '/assets/b.css': () => (bad ? new Response('x', { status: 500 }) : new Response('bbbb')) };
    const { u } = make(routes);
    const reg = new Reg((r) => { r.waiting = new Worker('installed'); });
    u.attach(reg);
    await u.check(); await u.download();
    expect(u.get()).toMatchObject({ phase: 'error', errorStep: 'download' });
    expect(u.get().error).toMatch(/b\.css ANSWERED 500/);
    expect(reg.updates).toBe(0); // never asked the browser to switch on a half download
    bad = false; await u.download();
    expect(u.get().phase).toBe('ready');
  });
  it('reports a lost connection mid-download', async () => {
    const { u } = make({ ...ok(), '/assets/a.js': () => { throw new TypeError('network'); } });
    u.attach(new Reg()); await u.check(); await u.download();
    expect(u.get().error).toMatch(/COULD NOT GET \/assets\/a\.js/);
  });
  it('says so when the server still serves the old app files (no new service worker)', async () => {
    const { u } = make(ok());
    u.attach(new Reg()); await u.check(); await u.download();
    expect(u.get()).toMatchObject({ phase: 'error', errorStep: 'download' });
    expect(u.get().error).toMatch(/STILL SERVES THE OLD APP FILES/);
  });
  it('reports a new app that fails to install, and one that never finishes', async () => {
    const bad = make(ok()); const w = new Worker();
    bad.u.attach(new Reg((r) => { r.installing = w; setTimeout(() => w.to('redundant'), 5); }));
    await bad.u.check(); await bad.u.download();
    expect(bad.u.get().error).toMatch(/FAILED TO INSTALL/);
    const hang = make(ok(), { timeouts: { check: 500, download: 30, install: 60 } });
    hang.u.attach(new Reg((r) => { r.installing = new Worker(); }));
    await hang.u.check(); await hang.u.download();
    expect(hang.u.get().error).toMatch(/DID NOT FINISH INSTALLING/);
  });
  it('reports a browser that cannot fetch the new app', async () => {
    const { u } = make(ok());
    u.attach(new Reg(() => { throw new Error('offline'); })); await u.check(); await u.download();
    expect(u.get().error).toMatch(/COULD NOT FETCH THE NEW APP/);
  });
  it('can be cancelled without changing anything', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { u } = make({ ...ok(), '/assets/a.js': async () => { await gate; return new Response('aaaaaa'); } });
    const reg = new Reg(); u.attach(reg);
    await u.check();
    const run = u.download();
    await sleep(5); expect(u.get().phase).toBe('downloading');
    u.cancel(); release(); await run;
    expect(u.get()).toMatchObject({ phase: 'available', progress: null });
    expect(u.get().notice).toMatch(/CANCELLED/);
    expect(reg.updates).toBe(0);
  });
  it('works without a file list (a minimal version.json): indeterminate, no byte counts', async () => {
    const { u } = make({ '/version.json': () => json({ version: '1.1.0' }) });
    u.attach(new Reg((r) => { r.waiting = new Worker('installed'); }));
    await u.check(); await u.download();
    expect(u.get().phase).toBe('ready');
  });
});

describe('install', () => {
  async function ready(over: Partial<Deps> = {}) {
    const m = make(ok(), over);
    m.u.attach(new Reg((r) => { r.waiting = new Worker('installed'); }));
    await m.u.check(); await m.u.download();
    return m;
  }
  it('does nothing before an update is downloaded', async () => {
    const { u } = make(ok()); let applied = 0; u.setApply(() => { applied++; });
    await u.install(); expect(applied).toBe(0);
  });
  it('records where it came from, switches to the new worker once, and reports the restart', async () => {
    const { u, storage } = await ready();
    let applied = 0; u.setApply(() => { applied++; });
    await u.install();
    expect(applied).toBe(1);
    expect(u.get().phase).toBe('installing');
    expect(JSON.parse(storage.data[PENDING_KEY]).from).toMatchObject({ version: '1.0.0', build: 'aaa1111' });
  });
  it('after the restart the next start says what changed (and the flag is gone)', async () => {
    const { storage } = await ready();
    storage.setItem(PENDING_KEY, JSON.stringify({ from: INSTALLED, to: '1.1.0' }));
    const after = createUpdater({ installed: { version: '1.1.0', build: 'bbb2222', builtAt: '' }, getSource: () => '/version.json', origin: O, online: () => true, fetch: fakeFetch({}), now: () => 1, storage, timeouts: { check: 1, download: 1, install: 1 } });
    expect(after.get().notice).toMatch(/UPDATED FROM v1\.0\.0 TO v1\.1\.0/);
    expect(storage.data[PENDING_KEY]).toBeUndefined();
  });
  it('a restart that did not change the version is not reported as an update', () => {
    const storage = mem(); storage.setItem(PENDING_KEY, JSON.stringify({ from: INSTALLED, to: '1.1.0' }));
    const same = createUpdater({ installed: INSTALLED, getSource: () => '/version.json', origin: O, online: () => true, fetch: fakeFetch({}), now: () => 1, storage, timeouts: { check: 1, download: 1, install: 1 } });
    expect(same.get().notice).toMatch(/VERSION DID NOT CHANGE/);
  });
  it('shows an error (and clears the flag) when the booth does not restart in time', async () => {
    const { u, storage } = await ready();
    u.setApply(() => new Promise(() => {}));
    u.install(); expect(u.get().phase).toBe('installing'); await sleep(90);
    expect(u.get()).toMatchObject({ phase: 'error', errorStep: 'install' });
    expect(u.get().error).toMatch(/DID NOT RESTART/);
    expect(storage.data[PENDING_KEY]).toBeUndefined();
  });
  it('shows an error when the switch itself fails', async () => {
    const { u } = await ready();
    u.setApply(async () => { throw new Error('x'); });
    u.install(); await sleep(10);
    expect(u.get().error).toMatch(/COULD NOT SWITCH/);
  });
  it('refuses, with a plain message, when the downloaded update is no longer available to switch to', async () => {
    const { u, storage } = await ready(); // ready, but the page never gave the updater its switch function
    u.install();
    expect(u.get()).toMatchObject({ phase: 'error', errorStep: 'install' });
    expect(u.get().error).toMatch(/NO LONGER WAITING/);
    expect(storage.data[PENDING_KEY]).toBeUndefined();
  });
});

describe('background update already waiting', () => {
  it('markWaiting makes INSTALL available without a download', () => {
    const { u } = make(ok());
    u.markWaiting();
    expect(u.get().phase).toBe('ready');
    expect(describeStatus(u.get()).text).toMatch(/INSTALL AND RESTART/);
  });
  it('a check while one is waiting offers INSTALL, even when the version number did not change', async () => {
    const { u } = make({ '/version.json': () => json(manifest({ version: '1.0.0' })) });
    const reg = new Reg(); reg.waiting = new Worker('installed'); u.attach(reg);
    await u.check();
    expect(u.get().phase).toBe('ready');
  });
  it('reset forgets the last check but keeps a waiting update', async () => {
    const { u } = make(ok()); u.markWaiting(); await u.check(); u.reset();
    expect(u.get()).toMatchObject({ phase: 'ready', latest: null });
    const fresh = make(ok()); await fresh.u.check(); fresh.u.reset();
    expect(fresh.u.get()).toMatchObject({ phase: 'idle', latest: null });
  });
});

describe('describeStatus', () => {
  it('writes a progress line with bytes and percent, and flags errors', () => {
    const base = make(ok()).u.get();
    expect(describeStatus({ ...base, phase: 'downloading', progress: { stage: 'files', loaded: 1024 * 1024, total: 4 * 1024 * 1024 } }).text).toBe('DOWNLOADING 1.0 MB OF 4.0 MB (25%)');
    expect(describeStatus({ ...base, phase: 'error', error: 'BOOM' })).toEqual({ text: 'BOOM', tone: 'alert' });
    expect(describeStatus(base).tone).toBe('idle');
  });
});
