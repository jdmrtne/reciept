import { useEffect, useRef, useState } from 'react';
import { QrCode } from '../components/QrCode';
import { Icon } from '../components/Icon';
import { loadSettings } from '../config/settings';
import { makeCtx } from '../frames/prims';
import { sessionStore, useSession } from '../state/session';
import { renderColorPhoto, renderGifVersion } from '../share/assets';
import { getShareStore, makeSessionId } from '../share/backend';
import { prepareShare, type ShareFailure, type SharePhase } from '../share/service';
import { normalizePublicBase, type ShareFile } from '../share/url';

type Part = { s: 'loading' } | { s: 'ok'; matrix: boolean[][]; ttlMs: number | null } | { s: 'error'; code: ShareFailure };
const LOADING: Part = { s: 'loading' };

const MESSAGES: Record<ShareFailure, string> = {
  missing: 'We could not find this file.',
  config: 'Digital copies are not set up on this booth.',
  render: 'Could not create this file.',
  upload: 'Could not save it online. Check the connection.',
  unreachable: 'Could not save it online. Check the connection.',
  qr: 'Could not make the QR code.',
  collision: 'Could not save it online. Please try again.'
};
const PHASE_TEXT: Record<SharePhase, string> = { preparing: 'Preparing your digital photos...', uploading: 'Uploading photos...', qr: 'Creating QR codes...' };
const PHASE_ORDER: SharePhase[] = ['preparing', 'uploading', 'qr'];
const hoursText = (ms: number) => { const h = Math.round(ms / 3600000); return h >= 48 ? `${Math.round(h / 24)} DAYS` : h === 1 ? '1 HOUR' : `${h} HOURS`; };

function QrCard({ part, emoji, label, hint, onRetry }: { part: Part; emoji: string; label: string; hint: string; onRetry: () => void }) {
  return (
    <section className="qr-card" aria-live="polite">
      {part.s === 'loading' ? <div className="qr-box"><p className="loading">MAKING QR</p></div>
        : part.s === 'error' ? (
          <div className="qr-box qr-fail" role="alert">
            <p className="err">{MESSAGES[part.code]}</p>
            {part.code !== 'config' && part.code !== 'missing' && <button className="btn ghost" onClick={onRetry}><Icon name="retry" />RETRY</button>}
          </div>
        ) : <div className="qr-box"><QrCode matrix={part.matrix} label={`${label} QR code`} /></div>}
      <h2 className="qr-label"><span aria-hidden="true">{emoji}</span> {label}</h2>
      <p className="qr-hint">{hint}</p>
    </section>
  );
}

/**
 * After a successful print: your colour photo + GIF as two QR codes. Each file is uploaded under a fresh random id made
 * HERE (one per mount, and App remounts every screen per session), so a QR can only ever open this session's files.
 * The two QR codes succeed or fail independently, each with its own RETRY; the printed receipt is never touched.
 */
export function ShareScreen() {
  const { editor, stamp } = useSession();
  const [cfg] = useState(() => { const s = loadSettings(); return { bridge: s.network.bridgeUrl, base: normalizePublicBase(s.share.publicBaseUrl), eventName: s.eventName, paper: s.paperWidthMm }; });
  const idRef = useRef(makeSessionId()); // one per session; replaced (for BOTH files) only if storage reports a collision
  const collided = useRef(false);
  const phases = useRef<{ [f in ShareFile]: SharePhase }>({ 'photo.jpg': 'preparing', 'photo.gif': 'preparing' });
  const [phase, setPhase] = useState<SharePhase>('preparing');
  const [photo, setPhoto] = useState<Part>(LOADING);
  const [gif, setGif] = useState<Part>(LOADING);
  const [preview, setPreview] = useState<string | null>(null);
  const alive = useRef(true);
  const abort = useRef(new AbortController());
  const color = useRef<ReturnType<typeof renderColorPhoto> | null>(null); // one render feeds both the photo and the GIF

  const getColor = () => {
    if (!editor) return Promise.reject(new Error('no-editor'));
    if (!color.current) {
      const p = renderColorPhoto(editor.present, stamp ?? makeCtx(cfg.eventName), cfg.paper);
      color.current = p;
      p.then((r) => { if (alive.current) setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(new Blob([r.asset.bytes as BlobPart], { type: r.asset.type })); }); },
        () => { if (color.current === p) color.current = null; }); // failed: let RETRY render again
    }
    return color.current;
  };

  const run = async (file: ShareFile) => {
    const set = file === 'photo.jpg' ? setPhoto : setGif;
    set(LOADING);
    const signal = abort.current.signal; // a StrictMode remount / unmount aborts this run; its late result must not overwrite a newer one
    const make = async () => {
      if (!editor) return null; // no photo at all
      const c = await getColor();
      return file === 'photo.jpg' ? c.asset : renderGifVersion(editor.present, c.canvas);
    };
    phases.current[file] = 'preparing';
    const onPhase = (p: SharePhase) => { phases.current[file] = p; if (alive.current) setPhase(PHASE_ORDER[Math.min(PHASE_ORDER.indexOf(phases.current['photo.jpg']), PHASE_ORDER.indexOf(phases.current['photo.gif']))]); };
    const r = await prepareShare(file, idRef.current, make, { fetch: (i, o) => fetch(i, o), bridgeUrl: cfg.bridge, publicBase: cfg.base, store: getShareStore() ?? undefined, onPhase, signal });
    if (!r.ok && r.code === 'collision' && !collided.current && alive.current && !signal.aborted) {
      // Extremely unlikely: this id already exists. New id, and BOTH files re-upload under it so the two QR codes still match.
      collided.current = true; idRef.current = makeSessionId();
      const other: ShareFile = file === 'photo.jpg' ? 'photo.gif' : 'photo.jpg';
      void run(other); return run(file);
    }
    if (alive.current && !signal.aborted) set(r.ok ? { s: 'ok', matrix: r.matrix, ttlMs: r.ttlMs } : { s: 'error', code: r.code });
  };

  useEffect(() => {
    alive.current = true;
    abort.current = new AbortController();
    void run('photo.jpg'); void run('photo.gif');
    return () => { alive.current = false; abort.current.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const busy = photo.s === 'loading' || gif.s === 'loading';
  const ready = [photo, gif].find((p) => p.s === 'ok');
  const failed = [photo, gif].filter((p) => p.s === 'error').length;
  const status = busy ? PHASE_TEXT[phase]
    : failed === 2 ? 'Printed successfully. Digital QR upload is temporarily unavailable.'
    : failed === 1 ? 'One digital copy could not be uploaded. Tap RETRY.'
    : 'Ready! Scan the QR codes below.';
  const ttl = ready?.s === 'ok' && ready.ttlMs ? hoursText(ready.ttlMs) : null;

  return (
    <main className="share">
      <h1 className="prt-title share-title">YOUR PHOTOS ARE READY!</h1>
      <p className="edit-hint" role="status" aria-live="polite">{status}</p>
      <div className="share-body">
        <div className="share-prev">
          {preview ? <img src={preview} alt="Your photo" className="prev-img" /> : <p className="loading">PREPARING</p>}
        </div>
        <QrCard part={photo} emoji="📷" label="COLOR PHOTO" hint="Scan to download" onRetry={() => void run('photo.jpg')} />
        <QrCard part={gif} emoji="🎞" label="GIF VERSION" hint="Scan to view/download" onRetry={() => void run('photo.gif')} />
      </div>
      {ttl && <p className="edit-hint">LINKS WORK FOR {ttl}</p>}
      <div className="cam-bar">
        <button className="btn big" onClick={() => sessionStore.go('success')}><Icon name="check" />{busy ? 'SKIP' : 'DONE'}</button>
      </div>
    </main>
  );
}
