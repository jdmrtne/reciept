import { useEffect, useRef, useState } from 'react';
import { QrCode } from '../components/QrCode';
import { Icon } from '../components/Icon';
import { loadSettings } from '../config/settings';
import { makeCtx } from '../frames/prims';
import { sessionStore, useSession } from '../state/session';
import { renderColorPhoto, renderGifVersion } from '../share/assets';
import { getShareStore, makeSessionId } from '../share/backend';
import { createShareController, FILES, type ShareController, type ShareView } from '../share/controller';
import { downloadQrPng } from '../share/qrDownload';
import type { ShareFailure, SharePhase } from '../share/service';
import { normalizePublicBase, resolvePageBase, type ShareFile } from '../share/url';

const MESSAGES: Record<ShareFailure, string> = {
  missing: 'We could not find this file.',
  config: 'Digital copies are not set up on this booth.',
  render: 'Could not create this file. Your printed photo is unaffected.',
  upload: 'Could not save it online. Check the connection.',
  unreachable: 'Could not save it online. Check the connection.',
  qr: 'Could not make the QR code.',
  collision: 'Could not save it online. Please try again.'
};
const PHASE_TEXT: Record<SharePhase, string> = { preparing: 'Preparing your digital photos...', uploading: 'Uploading photos...', qr: 'Creating your QR code...' };
const FILE_LABEL: Record<ShareFile, { icon: string; text: string }> = { 'photo.jpg': { icon: 'photo', text: 'COLOR PHOTO' }, 'photo.gif': { icon: 'film', text: 'ANIMATED GIF' } };
const hoursText = (ms: number) => { const h = Math.round(ms / 3600000); return h >= 48 ? `${Math.round(h / 24)} DAYS` : h === 1 ? '1 HOUR' : `${h} HOURS`; };
const INITIAL: ShareView = { files: { 'photo.jpg': { s: 'loading' }, 'photo.gif': { s: 'loading' } }, qr: null, phase: 'preparing', ttlMs: null, id: null };

/**
 * After a successful print: ONE QR code for this photo session. It encodes only `<site>/p/<id>`; that page shows the colour photo
 * AND the GIF, both stored under the same id. The id is kept in the session store, so coming back here shows the same QR (no
 * re-upload). The two files succeed/fail independently, each with its own RETRY; the printed receipt is never touched.
 */
export function ShareScreen() {
  const { editor, stamp, footage } = useSession();
  const [cfg] = useState(() => {
    const s = loadSettings();
    return { bridge: s.network.bridgeUrl, publicBase: normalizePublicBase(s.share.publicBaseUrl), pageBase: resolvePageBase({ cloud: !!getShareStore(), publicBaseUrl: s.share.publicBaseUrl, origin: location.origin }), eventName: s.eventName, paper: s.paperWidthMm };
  });
  const [view, setView] = useState<ShareView>(INITIAL);
  const [preview, setPreview] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const ctrl = useRef<ShareController | null>(null);
  const alive = useRef(true);
  const color = useRef<ReturnType<typeof renderColorPhoto> | null>(null); // the colour photo render (also the on-screen preview)

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

  useEffect(() => {
    alive.current = true;
    const c = createShareController({
      makeId: makeSessionId,
      session: { get: () => sessionStore.get().share, set: (share) => sessionStore.update({ share }) },
      make: async (file) => {
        if (!editor) return null; // no photo at all
        if (file === 'photo.jpg') return (await getColor()).asset;
        // The GIF is its own render of the same layout (independent of the JPEG, so one failing never blocks the other).
        return renderGifVersion(editor.present, stamp ?? makeCtx(cfg.eventName), footage);
      },
      env: { fetch: (i, o) => fetch(i, o), bridgeUrl: cfg.bridge, publicBase: cfg.publicBase, pageBase: cfg.pageBase, store: getShareStore() ?? undefined }
    });
    ctrl.current = c;
    const off = c.subscribe(setView);
    c.start();
    return () => { alive.current = false; off(); c.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const parts = FILES.map((f) => view.files[f]);
  const busy = parts.some((p) => p.s === 'loading');
  const failed = parts.filter((p) => p.s === 'error').length;
  const qr = view.qr?.s === 'ok' ? view.qr : null;
  const status = qr ? (failed ? 'Your QR code is ready, but one digital copy could not be uploaded yet. Tap RETRY.' : busy ? 'Almost there. Finishing the upload...' : 'Ready! Scan the QR code below.')
    : busy ? PHASE_TEXT[view.phase]
    : failed === 2 ? 'Printed successfully. Digital QR upload is temporarily unavailable.'
    : 'Could not make the QR code. Your printed photo is unaffected.';
  const errCode = (() => { const e = parts.find((p) => p.s === 'error'); return view.qr?.s === 'error' ? view.qr.code : e?.s === 'error' ? e.code : null; })();
  const noRetry = errCode === 'config' || errCode === 'missing';

  const save = async () => { if (qr && view.id) setSaveMsg((await downloadQrPng(qr.matrix, view.id)) ? 'QR SAVED' : 'COULD NOT SAVE THE QR'); };

  return (
    <main className="share">
      <h1 className="prt-title share-title">YOUR PHOTOS ARE READY!</h1>
      <p className="edit-hint" role="status" aria-live="polite">{status}</p>
      <div className="share-body">
        <div className="share-prev">
          {preview ? <img src={preview} alt="Your photo" className="prev-img" /> : <p className="loading">PREPARING</p>}
        </div>
        <section className="qr-card" aria-live="polite">
          {qr ? <div className="qr-box"><QrCode matrix={qr.matrix} label="QR code for your digital photo and GIF" /></div>
            : busy ? <div className="qr-box"><p className="loading">MAKING QR</p></div>
            : <div className="qr-box qr-fail" role="alert"><p className="err">{MESSAGES[errCode ?? 'qr']}</p></div>}
          <h2 className="qr-label">SCAN TO VIEW DIGITAL VERSION</h2>
          <p className="qr-hint">COLOR PHOTO + ANIMATED GIF</p>
          <ul className="qr-files">
            {FILES.map((f) => {
              const p = view.files[f];
              return (
                <li key={f} className={`qr-file ${p.s}`}>
                  <Icon name={FILE_LABEL[f].icon} /><span>{FILE_LABEL[f].text}</span>
                  {p.s === 'loading' ? <em>...</em> : p.s === 'ok' ? <Icon name="check" />
                    : <button className="btn ghost" onClick={() => ctrl.current?.retry(f)} disabled={p.code === 'config' || p.code === 'missing'}><Icon name="retry" />RETRY</button>}
                </li>
              );
            })}
          </ul>
          {qr && <button className="btn ghost" onClick={() => void save()}><Icon name="save" />SAVE QR</button>}
          {saveMsg && <p className="qr-hint" role="status">{saveMsg}</p>}
          {!qr && !busy && !noRetry && view.qr?.s === 'error' && <button className="btn ghost" onClick={() => ctrl.current?.start()}><Icon name="retry" />RETRY</button>}
        </section>
      </div>
      {qr && view.ttlMs ? <p className="edit-hint">LINKS WORK FOR {hoursText(view.ttlMs)}</p> : null}
      <div className="cam-bar">
        <button className="btn big" onClick={() => sessionStore.go('success')}><Icon name="check" />{busy ? 'SKIP' : 'DONE'}</button>
      </div>
    </main>
  );
}
