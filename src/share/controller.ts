import type { ShareAsset } from './assets';
import { makePageQr, qrBase, uploadShareFile, type SharePhase, type ShareEnv, type ShareFailure } from './service';
import type { ShareSession } from '../state/session';
import type { ShareFile } from './url';

export type FilePart = { s: 'loading' } | { s: 'ok' } | { s: 'error'; code: ShareFailure };
export type QrPart = { s: 'ok'; url: string; matrix: boolean[][] } | { s: 'error'; code: 'qr' | 'config' };
export interface ShareView {
  files: { [f in ShareFile]: FilePart };
  /** The ONE QR. Appears as soon as one file is stored (the page tolerates a missing sibling) and never changes afterwards. */
  qr: QrPart | null;
  phase: SharePhase;
  ttlMs: number | null;
  id: string | null;
}
export const FILES: ShareFile[] = ['photo.jpg', 'photo.gif'];
const LOADING: FilePart = { s: 'loading' };
const ORDER: SharePhase[] = ['preparing', 'uploading', 'qr'];

export interface ShareControllerOptions {
  makeId: () => string;
  /** Where the session's share state lives (the app's session store; wiped on reset). */
  session: { get(): ShareSession | null; set(s: ShareSession | null): void };
  /** Renders one file; null/throw 'no-photos' = no source. */
  make: (file: ShareFile) => Promise<ShareAsset | null>;
  env: Omit<ShareEnv, 'signal' | 'onPhase' | 'allowExisting'>;
}
export interface ShareController { start(): void; retry(file: ShareFile): void; get(): ShareView; subscribe(l: (v: ShareView) => void): () => void; dispose(): void }

/**
 * Runs one photo session's digital result: ONE id, both files stored under it, ONE QR for the result page.
 * - The id lives in the session store, so coming back to the screen reuses it: same QR, files already stored are not re-uploaded.
 * - Each file succeeds/fails on its own (RETRY per file); the QR is built when the first one lands and the page shows whatever exists.
 * - A (practically impossible) id collision swaps to a fresh id and re-stores both files, keeping the QR consistent with them.
 */
export function createShareController(o: ShareControllerOptions): ShareController {
  const ac = new AbortController();
  const listeners = new Set<(v: ShareView) => void>();
  const phases: { [f in ShareFile]: SharePhase } = { 'photo.jpg': 'preparing', 'photo.gif': 'preparing' };
  const attempted = new Set<ShareFile>(); // files this controller already tried (a retry may meet its own half-landed upload)
  const revisit = !!o.session.get(); // the share screen was already open for this customer: an earlier visit may have half-landed an upload
  let epoch = 0, collided = false, disposed = false;
  let view: ShareView = { files: { 'photo.jpg': LOADING, 'photo.gif': LOADING }, qr: null, phase: 'preparing', ttlMs: o.session.get()?.ttlMs ?? null, id: o.session.get()?.id ?? null };

  const patch = (p: Partial<ShareView>) => { view = { ...view, ...p }; listeners.forEach((l) => l(view)); };
  const setFile = (f: ShareFile, part: FilePart) => patch({ files: { ...view.files, [f]: part } });
  const sess = () => o.session.get();
  const ensure = (): ShareSession => {
    let s = sess();
    if (!s) { s = { id: o.makeId(), done: [], pageUrl: null, ttlMs: null }; o.session.set(s); patch({ id: s.id }); }
    return s;
  };
  const buildQr = () => {
    const s = sess(); if (!s || view.qr?.s === 'ok') return;
    const r = makePageQr(qrBase(o.env), s.id);
    if (r.ok) { o.session.set({ ...s, pageUrl: r.url }); patch({ qr: { s: 'ok', url: r.url, matrix: r.matrix } }); }
    else patch({ qr: { s: 'error', code: r.code } });
  };
  const onPhase = (f: ShareFile) => (p: SharePhase) => { phases[f] = p; patch({ phase: ORDER[Math.min(...FILES.map((x) => ORDER.indexOf(phases[x])))] }); };

  async function run(file: ShareFile): Promise<void> {
    const my = epoch;
    setFile(file, LOADING);
    const s = ensure();
    if (s.done.includes(file)) { buildQr(); setFile(file, { s: 'ok' }); return; } // revisit: already stored under this id
    const allowExisting = attempted.has(file) || revisit; // a retry, or a revisit, may meet its own half-landed upload
    attempted.add(file); phases[file] = 'preparing';
    const r = await uploadShareFile(file, s.id, () => o.make(file), { ...o.env, signal: ac.signal, onPhase: onPhase(file), allowExisting });
    if (disposed || my !== epoch || ac.signal.aborted) return; // left the screen / superseded by a new id: a late answer must not overwrite anything
    if (!r.ok) {
      if (r.code === 'collision' && !collided) {
        collided = true; epoch++; attempted.clear();
        o.session.set(null); patch({ qr: null, id: null, files: { 'photo.jpg': LOADING, 'photo.gif': LOADING } });
        const other = FILES.find((f) => f !== file)!;
        void run(other); return run(file);
      }
      setFile(file, { s: 'error', code: r.code });
      return;
    }
    const cur = sess();
    if (cur) o.session.set({ ...cur, done: [...new Set([...cur.done, file])], ttlMs: r.ttlMs ?? cur.ttlMs });
    patch({ ttlMs: r.ttlMs ?? view.ttlMs });
    buildQr(); // before the chip flips to ok, so the screen never shows "stored" without its QR
    setFile(file, { s: 'ok' });
  }

  return {
    start() { FILES.forEach((f) => void run(f)); },
    retry(file) { void run(file); },
    get: () => view,
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    dispose() { disposed = true; ac.abort(); listeners.clear(); }
  };
}
