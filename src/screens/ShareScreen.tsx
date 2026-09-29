import { useEffect, useRef, useState } from 'react';
import { QrCode } from '../components/QrCode';
import { Icon } from '../components/Icon';
import { loadSettings } from '../config/settings';
import { makeCtx } from '../frames/prims';
import { sessionStore, useSession } from '../state/session';
import { renderColorPhoto, renderGifVersion } from '../share/assets';
import { newShareId } from '../share/id';
import { prepareShare, type ShareFailure } from '../share/service';
import { normalizePublicBase, type ShareFile } from '../share/url';

type Part = { s: 'loading' } | { s: 'ok'; matrix: boolean[][]; ttlMs: number | null } | { s: 'error'; code: ShareFailure };
const LOADING: Part = { s: 'loading' };

const MESSAGES: Record<ShareFailure, string> = {
  missing: 'We could not find this file.',
  config: 'Digital copies are not set up on this booth.',
  render: 'Could not create this file.',
  upload: 'Could not save it online. Check the connection.',
  unreachable: 'Could not save it online. Check the connection.',
  qr: 'Could not make the QR code.'
};
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
  const [id] = useState(newShareId);
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
    const r = await prepareShare(file, id, make, { fetch: (i, o) => fetch(i, o), bridgeUrl: cfg.bridge, publicBase: cfg.base, signal });
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
  const ttl = ready?.s === 'ok' && ready.ttlMs ? hoursText(ready.ttlMs) : null;

  return (
    <main className="share">
      <h1 className="prt-title share-title">YOUR PHOTOS ARE READY!</h1>
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
