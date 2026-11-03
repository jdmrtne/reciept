import { useSyncExternalStore } from 'react';
import { compareBuilds, formatBytes, INSTALLED, ManifestError, parseManifest, showVersion, type BuildInfo, type ManifestFile, type UpdateManifest } from './version';
import { readSource, type KeyValue } from './updateSource';
import { readSeen, recordSeen } from './whatsNew';

/**
 * The owner-facing update flow (ADMIN > Updates). This app is a PWA served from a web host and run by Chrome on the tablet, so
 * "installing an update" means: the service worker (vite-plugin-pwa, registerType 'prompt') downloads the new build into its cache,
 * waits, and is then told to take over. Nothing is uninstalled; localStorage (settings, PIN) and IndexedDB (custom frames, layouts,
 * standby photo, save folder handle) belong to the site's origin and are never touched by a service worker swap.
 *
 *   CHECK     reads the update source (default /version.json) and compares its version number with the compiled-in one.
 *   DOWNLOAD  streams the new build's files that this device does not already hold (sizes from version.json) for real byte progress, then asks the browser to fetch the
 *             new service worker, which installs and waits. No page reload.
 *   INSTALL   tells the waiting service worker to take over and reloads the booth once.
 *
 * Everything outside this file is injected through `Deps`, so the whole flow is testable without a browser.
 */

export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
export type UpdateStep = 'check' | 'download' | 'install';

export interface Progress { stage: 'files' | 'package'; loaded: number; total: number | null }

export interface UpdateState {
  phase: UpdatePhase;
  installed: BuildInfo;
  latest: UpdateManifest | null;
  /** What this device would really have to download: the listed files it does not already hold (unchanged files are skipped, as the service worker skips them). null = no file list. */
  download: { files: ManifestFile[]; bytes: number } | null;
  checkedAt: number | null;
  progress: Progress | null;
  error: string | null;
  errorStep: UpdateStep | null;
  /** A plain message that is not an error: "UPDATED FROM ...", "NOTHING TO INSTALL", "DOWNLOAD CANCELLED". */
  notice: string | null;
}

/** The slice of ServiceWorkerRegistration the flow uses (so tests can fake it). */
export interface RegistrationLike {
  update(): Promise<unknown>;
  readonly waiting: ServiceWorkerLike | null;
  readonly installing: ServiceWorkerLike | null;
}
export interface ServiceWorkerLike {
  readonly state: string;
  addEventListener(type: 'statechange', cb: () => void): void;
  removeEventListener(type: 'statechange', cb: () => void): void;
}

export interface Deps {
  installed: BuildInfo;
  getSource: () => string;
  origin: string;
  online: () => boolean;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Is this file already in the browser's cache storage (the current app's precache)? Default: ask CacheStorage. */
  isCached?: (url: string) => Promise<boolean>;
  now: () => number;
  storage: KeyValue | null;
  timeouts: { check: number; download: number; install: number };
}

export const PENDING_KEY = 'booth.update.pending.v1';
const CONCURRENCY = 4;
const PROGRESS_EVERY_MS = 150;

class UpdateError extends Error {
  constructor(public step: UpdateStep, message: string) { super(message); }
}

const secs = (ms: number) => Math.round(ms / 1000);

export function createUpdater(deps: Deps) {
  const base = (): UpdateState => ({ phase: 'idle', installed: deps.installed, latest: null, download: null, checkedAt: null, progress: null, error: null, errorStep: null, notice: null });
  let state: UpdateState = base();
  const listeners = new Set<() => void>();
  const set = (p: Partial<UpdateState>) => { state = { ...state, ...p }; listeners.forEach((f) => f()); };

  let registration: RegistrationLike | null = null;
  let applyFn: (() => unknown) | null = null;
  let waitingSeen = false;
  let abort: AbortController | null = null;
  let installTimer: ReturnType<typeof setTimeout> | null = null;

  const busy = () => state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing';
  const hasWaiting = () => waitingSeen || !!registration?.waiting;
  const fail = (e: unknown, step: UpdateStep, keep?: Partial<UpdateState>) => {
    const message = e instanceof UpdateError || e instanceof ManifestError ? e.message : 'SOMETHING WENT WRONG. TRY AGAIN';
    set({ phase: 'error', error: message, errorStep: step, progress: null, notice: null, ...keep });
  };

  /** What the last INSTALL left behind: a flag written just before the reload, read once on the first start afterwards. */
  const consumePending = () => {
    if (!deps.storage) return;
    try {
      const raw = deps.storage.getItem(PENDING_KEY);
      if (!raw) return;
      deps.storage.removeItem(PENDING_KEY);
      const p = JSON.parse(raw) as { from?: BuildInfo; to?: string };
      if (!p.from || typeof p.from.version !== 'string') return;
      const changed = p.from.version !== deps.installed.version || p.from.build !== deps.installed.build;
      // A device that never recorded a build (it was updated from a version without the "what changed" popup): remember the build it came FROM, so STANDBY announces this update.
      if (changed && !readSeen(deps.storage)) recordSeen(p.from, deps.storage);
      state = {
        ...state,
        notice: changed
          ? `UPDATED FROM ${showVersion(p.from.version)} TO ${showVersion(deps.installed.version)}. SETTINGS, FRAMES AND LAYOUTS WERE KEPT`
          : 'THE BOOTH RESTARTED, BUT THE VERSION DID NOT CHANGE. RUN CHECK FOR UPDATES AGAIN'
      };
    } catch { /* unreadable flag: nothing to report */ }
  };
  consumePending();

  // ---- CHECK ------------------------------------------------------------------------------------------------------------

  async function readManifest(signal: AbortSignal): Promise<UpdateManifest> {
    const url = new URL(deps.getSource(), deps.origin);
    url.searchParams.set('t', String(deps.now())); // a middle cache must never answer for the newest version
    let res: Response;
    try { res = await deps.fetch(url.href, { cache: 'no-store', credentials: 'omit', signal }); }
    catch {
      if (signal.aborted) throw new UpdateError('check', `THE UPDATE SOURCE DID NOT ANSWER WITHIN ${secs(deps.timeouts.check)} SECONDS. CHECK THE INTERNET CONNECTION AND TRY AGAIN`);
      throw new UpdateError('check', 'COULD NOT REACH THE UPDATE SOURCE. CHECK THE INTERNET CONNECTION, THE ADDRESS UNDER UPDATE SOURCE, AND (FOR ANOTHER SITE) THAT IT ALLOWS THIS SITE TO READ IT');
    }
    if (!res.ok) {
      throw new UpdateError('check', res.status === 404
        ? 'VERSION FILE NOT FOUND (404). PUBLISH version.json WITH THE APP, OR FIX THE ADDRESS UNDER UPDATE SOURCE'
        : `THE UPDATE SOURCE ANSWERED WITH AN ERROR (${res.status}). TRY AGAIN IN A MINUTE`);
    }
    const text = await res.text().catch(() => '');
    let json: unknown;
    try { json = JSON.parse(text); }
    catch {
      throw new UpdateError('check', text.trimStart().startsWith('<')
        ? 'THE UPDATE SOURCE RETURNED A WEB PAGE, NOT A VERSION FILE. THE ADDRESS IS WRONG OR version.json WAS NOT PUBLISHED'
        : 'THE UPDATE SOURCE DID NOT RETURN A READABLE VERSION FILE');
    }
    return parseManifest(json, deps.origin);
  }

  /** Listed files minus the ones this device already holds. Unchanged files never cross the network again, so they are not counted. */
  async function plan(m: UpdateManifest): Promise<UpdateState['download']> {
    if (!m.files.length) return null;
    const cached = deps.isCached ?? (async () => false);
    const have = await Promise.all(m.files.map((f) => cached(f.url).catch(() => false)));
    const files = m.files.filter((_, i) => !have[i]);
    return { files, bytes: files.reduce((n, f) => n + f.size, 0) };
  }

  async function check(): Promise<void> {
    if (busy()) return;
    set({ phase: 'checking', error: null, errorStep: null, notice: null, progress: null });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), deps.timeouts.check);
    try {
      if (!deps.online()) throw new UpdateError('check', 'NO INTERNET CONNECTION. CONNECT THE TABLET TO WIFI OR MOBILE DATA AND TRY AGAIN');
      const latest = await readManifest(ctl.signal);
      const cmp = compareBuilds(latest, deps.installed);
      const checkedAt = deps.now();
      const download = await plan(latest);
      if (hasWaiting()) set({ phase: 'ready', latest, download, checkedAt });
      else if (cmp !== null && cmp > 0) set({ phase: 'available', latest, download, checkedAt });
      else if (cmp !== null && cmp < 0) set({ phase: 'current', latest, download, checkedAt, notice: `THE UPDATE SOURCE LISTS AN OLDER VERSION (${showVersion(latest.version)}) THAN THIS DEVICE HAS. NOTHING TO INSTALL` });
      else set({ phase: 'current', latest, download, checkedAt });
    } catch (e) {
      fail(e, 'check');
    } finally { clearTimeout(timer); }
  }

  // ---- DOWNLOAD ---------------------------------------------------------------------------------------------------------

  /** Streams every listed file once, reporting real bytes. The browser keeps them in its HTTP cache, so the service worker's own install reads them from there. */
  async function fetchFiles(files: ManifestFile[], total: number, signal: AbortSignal): Promise<void> {
    let loaded = 0, lastPush = 0;
    const push = (force = false) => {
      const t = deps.now();
      if (force || t - lastPush >= PROGRESS_EVERY_MS) { lastPush = t; set({ progress: { stage: 'files', loaded: Math.min(loaded, total), total } }); }
    };
    push(true);
    const queue = [...files];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        if (signal.aborted) return;
        let res: Response;
        try { res = await deps.fetch(f.url, { credentials: 'same-origin', signal }); }
        catch { if (signal.aborted) return; throw new UpdateError('download', `DOWNLOAD STOPPED: COULD NOT GET ${new URL(f.url).pathname}. CHECK THE INTERNET CONNECTION AND TRY AGAIN. THE BOOTH KEEPS RUNNING THE CURRENT VERSION`); }
        if (!res.ok) throw new UpdateError('download', `DOWNLOAD FAILED: ${new URL(f.url).pathname} ANSWERED ${res.status}. THE NEW VERSION MAY STILL BE BEING PUBLISHED. WAIT A MINUTE AND TRY AGAIN`);
        try {
          if (res.body) {
            const reader = res.body.getReader();
            for (;;) { const { done, value } = await reader.read(); if (done) break; loaded += value.byteLength; push(); }
          } else loaded += (await res.arrayBuffer()).byteLength;
        } catch { if (signal.aborted) return; throw new UpdateError('download', `DOWNLOAD STOPPED HALFWAY THROUGH ${new URL(f.url).pathname}. TRY AGAIN`); }
        push();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    push(true);
  }

  /** Asks the browser for the new service worker and waits until it has installed (all files cached) and is waiting to take over. */
  async function fetchPackage(reg: RegistrationLike, signal: AbortSignal): Promise<'waiting' | 'none'> {
    try { await reg.update(); }
    catch { throw new UpdateError('download', 'THE BROWSER COULD NOT FETCH THE NEW APP. CHECK THE INTERNET CONNECTION AND TRY AGAIN'); }
    if (reg.waiting) return 'waiting';
    const w = reg.installing;
    if (!w) return 'none';
    return new Promise((resolve, reject) => {
      const done = (fn: () => void) => { clearTimeout(timer); w.removeEventListener('statechange', onState); signal.removeEventListener('abort', onAbort); fn(); };
      const onState = () => {
        if (w.state === 'installed' || w.state === 'activated') done(() => resolve('waiting'));
        else if (w.state === 'redundant') done(() => reject(new UpdateError('download', 'THE NEW APP FAILED TO INSTALL (A FILE WAS MISSING OR UNREADABLE). THE BOOTH KEEPS RUNNING THE CURRENT VERSION. TRY AGAIN, OR PUBLISH THE UPDATE AGAIN')));
      };
      const onAbort = () => done(() => reject(new UpdateError('download', 'CANCELLED')));
      const timer = setTimeout(() => done(() => reject(new UpdateError('download', `THE NEW APP DID NOT FINISH INSTALLING WITHIN ${secs(deps.timeouts.download)} SECONDS. TRY AGAIN ON A BETTER CONNECTION`))), deps.timeouts.download);
      w.addEventListener('statechange', onState);
      signal.addEventListener('abort', onAbort);
      onState();
    });
  }

  async function download(): Promise<void> {
    const retry = state.phase === 'error' && state.errorStep === 'download' && !!state.latest;
    if (busy() || !(state.phase === 'available' || retry) || !state.latest) return;
    const latest = state.latest;
    if (!registration) {
      fail(new UpdateError('download', 'THIS PAGE HAS NO INSTALLED APP COMPONENT (SERVICE WORKER), SO IT CANNOT UPDATE ITSELF. OPEN THE BOOTH FROM ITS HTTPS ADDRESS (NOT THE DEVELOPMENT SERVER) AND RELOAD ONCE'), 'download', { latest });
      return;
    }
    if (!deps.online()) { fail(new UpdateError('download', 'NO INTERNET CONNECTION. CONNECT THE TABLET AND TRY AGAIN'), 'download', { latest }); return; }
    const ctl = new AbortController();
    abort = ctl;
    set({ phase: 'downloading', error: null, errorStep: null, notice: null, progress: { stage: 'files', loaded: 0, total: state.download?.bytes ?? null } });
    try {
      const plan = state.download;
      if (plan && plan.files.length) await fetchFiles(plan.files, plan.bytes, ctl.signal);
      if (ctl.signal.aborted) { set({ phase: 'available', progress: null, notice: 'DOWNLOAD CANCELLED. NOTHING WAS CHANGED' }); return; }
      set({ progress: { stage: 'package', loaded: 0, total: null } });
      const r = await fetchPackage(registration, ctl.signal);
      if (r === 'waiting') { waitingSeen = true; set({ phase: 'ready', progress: null }); }
      else fail(new UpdateError('download', `THE UPDATE SOURCE LISTS ${showVersion(latest.version)}, BUT THE SERVER STILL SERVES THE OLD APP FILES. THE PUBLISH MAY STILL BE FINISHING: WAIT A MINUTE AND TRY AGAIN`), 'download', { latest });
    } catch (e) {
      if (e instanceof UpdateError && e.message === 'CANCELLED') set({ phase: 'available', progress: null, notice: 'DOWNLOAD CANCELLED. NOTHING WAS CHANGED' });
      else fail(e, 'download', { latest });
    } finally { abort = null; }
  }

  function cancel(): void { if (state.phase === 'downloading') abort?.abort(); }

  // ---- INSTALL ----------------------------------------------------------------------------------------------------------

  function install(): void {
    if (state.phase !== 'ready') return;
    if (!applyFn || !hasWaiting()) { fail(new UpdateError('install', 'THE DOWNLOADED UPDATE IS NO LONGER WAITING. RUN CHECK FOR UPDATES AND DOWNLOAD IT AGAIN'), 'install'); return; }
    try { deps.storage?.setItem(PENDING_KEY, JSON.stringify({ from: deps.installed, to: state.latest?.version ?? null, at: deps.now() })); } catch { /* the reload still works; only the "UPDATED FROM" message is lost */ }
    set({ phase: 'installing', error: null, errorStep: null, notice: null, progress: null });
    installTimer = setTimeout(() => {
      installTimer = null;
      try { deps.storage?.removeItem(PENDING_KEY); } catch { /* ignore */ }
      fail(new UpdateError('install', `THE BOOTH DID NOT RESTART WITHIN ${secs(deps.timeouts.install)} SECONDS. CLOSE AND REOPEN THE APP: THE UPDATE IS DOWNLOADED AND WILL START THEN`), 'install');
    }, deps.timeouts.install);
    // Not awaited: on success the page reloads and this never settles, so the timer above is what reports a restart that never happens.
    const apply = applyFn;
    void Promise.resolve().then(() => apply()).catch(() => {
      if (installTimer) { clearTimeout(installTimer); installTimer = null; }
      try { deps.storage?.removeItem(PENDING_KEY); } catch { /* ignore */ }
      fail(new UpdateError('install', 'THE BOOTH COULD NOT SWITCH TO THE NEW VERSION. CLOSE AND REOPEN THE APP, THEN TRY AGAIN'), 'install');
    });
  }

  return {
    get: () => state,
    subscribe: (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; },
    check, download, cancel, install,
    /** kiosk.tsx: the browser registered the service worker. */
    attach(reg: RegistrationLike) { registration = reg; if (reg.waiting) waitingSeen = true; },
    /** kiosk.tsx: the function that makes the waiting service worker take over and reloads the page. */
    setApply(fn: () => unknown) { applyFn = fn; },
    /** kiosk.tsx: a new version finished downloading in the background (the browser's own check at start-up). */
    markWaiting() { waitingSeen = true; if (!busy() && state.phase !== 'ready') set({ phase: 'ready', error: null, errorStep: null, progress: null }); },
    /** The owner changed the update source: whatever was found before no longer applies. */
    reset() { if (busy()) return; set({ phase: hasWaiting() ? 'ready' : 'idle', latest: null, download: null, checkedAt: null, error: null, errorStep: null, progress: null, notice: null }); }
  };
}

export type Updater = ReturnType<typeof createUpdater>;

/** The one updater the booth uses. */
export const updater: Updater = createUpdater({
  installed: INSTALLED,
  getSource: () => readSource(),
  origin: typeof location !== 'undefined' ? location.origin : 'http://localhost',
  online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  fetch: (input, init) => fetch(input, init),
  isCached: async (url) => { try { return typeof caches !== 'undefined' && !!(await caches.match(url)); } catch { return false; } },
  now: () => Date.now(),
  storage: (() => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } })(),
  timeouts: { check: 15_000, download: 180_000, install: 20_000 }
});

export const useUpdater = (): UpdateState => useSyncExternalStore(updater.subscribe, updater.get, updater.get);

/** Plain-language status for the Updates card (pure, so it is testable). `tone` drives role=alert and emphasis. */
export function describeStatus(s: UpdateState): { text: string; tone: 'idle' | 'busy' | 'good' | 'alert' } {
  switch (s.phase) {
    case 'idle': return { text: 'NOT CHECKED YET. PRESS CHECK FOR UPDATES', tone: 'idle' };
    case 'checking': return { text: 'CHECKING FOR UPDATES', tone: 'busy' };
    case 'current': return { text: s.notice ?? 'YOU HAVE THE LATEST VERSION', tone: 'good' };
    case 'available': return { text: `UPDATE AVAILABLE: ${s.latest ? showVersion(s.latest.version) : ''}${s.latest && s.latest.version === s.installed.version && s.latest.build ? ` (NEW BUILD ${s.latest.build})` : ''}${s.download?.bytes ? ` (${formatBytes(s.download.bytes)} TO DOWNLOAD)` : ''}. PRESS DOWNLOAD UPDATE`, tone: 'good' };
    case 'downloading': {
      const p = s.progress;
      if (p?.stage === 'package') return { text: 'INSTALLING THE DOWNLOADED FILES IN THE BACKGROUND', tone: 'busy' };
      return { text: p?.total ? `DOWNLOADING ${formatBytes(p.loaded)} OF ${formatBytes(p.total)} (${Math.min(100, Math.floor((p.loaded / Math.max(1, p.total)) * 100))}%)` : 'DOWNLOADING', tone: 'busy' };
    }
    case 'ready': return { text: s.latest && s.latest.version !== s.installed.version ? `${showVersion(s.latest.version)} IS DOWNLOADED. PRESS INSTALL AND RESTART` : 'A NEW BUILD IS DOWNLOADED. PRESS INSTALL AND RESTART', tone: 'good' };
    case 'installing': return { text: 'RESTARTING THE BOOTH INTO THE NEW VERSION', tone: 'busy' };
    case 'error': return { text: s.error ?? 'SOMETHING WENT WRONG', tone: 'alert' };
  }
}
