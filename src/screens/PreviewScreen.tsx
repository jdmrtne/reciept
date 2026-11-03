import { useEffect, useState } from 'react';
import { sessionStore, useSession } from '../state/session';
import { loadSettings } from '../config/settings';
import { ensureSessionStamp } from '../state/stamp';
import { browserEnv, canvasToBlob, renderPreview } from '../render/render';
import { forReading } from '../render/orient';
import { Icon } from '../components/Icon';
import { frameQrForSession, qrErrorText } from '../qr/sessionQr';
import { clampCopies, copiesLeft } from '../print/copies';

/** Final look of the receipt, drawn by the same renderer that will feed the printer. */
export function PreviewScreen() {
  const { editor, stamp, copies, printedTotal } = useSession();
  const { maxCopies } = loadSettings();
  const left = copiesLeft(maxCopies, printedTotal); // what this guest may still print (owner maximum minus what already came out)
  const n = clampCopies(copies, maxCopies, printedTotal);
  const setCopies = (v: number) => sessionStore.update({ copies: clampCopies(v, maxCopies, printedTotal) });
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editor) return;
    let dead = false, made: string | null = null;
    const { paperWidthMm } = loadSettings();
    renderPreview(editor.present, stamp ?? ensureSessionStamp(), paperWidthMm, undefined, frameQrForSession() ?? undefined)
      .then((c) => canvasToBlob(forReading(c, editor.present.layoutId, browserEnv))) // sideways (roll-printed) tickets are SHOWN landscape; the print itself is unchanged
      .then((b) => { if (dead) return; made = URL.createObjectURL(b); setUrl(made); })
      .catch((e) => { if (!dead) setError(qrErrorText(e) ?? 'Could not prepare your receipt. Go back and try again.'); });
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [editor, stamp]);

  const back = () => sessionStore.go('edit');
  const print = () => sessionStore.update({ copies: Math.max(1, n), printed: 0, printReturn: null, screen: 'print' });
  return (
    <main className="prev">
      <div className="prev-stage">
        {url ? <img src={url} alt="Your receipt preview" className="prev-img" />
          : error || !editor ? <p className="err">{error || 'Nothing to preview yet.'}</p>
          : <p className="loading">PREPARING YOUR RECEIPT</p>}
      </div>
      {left > 1 && (
        <div className="copies" role="group" aria-label="Number of copies">
          <span className="copies-label">COPIES</span>
          <button type="button" className="btn ghost copies-b" disabled={n <= 1} onClick={() => setCopies(n - 1)} aria-label="Fewer copies">{'\u2212'}</button>
          <output className="copies-n" aria-live="polite" aria-label="Copies">{n}</output>
          <button type="button" className="btn ghost copies-b" disabled={n >= left} onClick={() => setCopies(n + 1)} aria-label="More copies">+</button>
        </div>
      )}
      {left === 0 && <p className="edit-hint" role="status">COPY LIMIT REACHED</p>}
      <div className="cam-bar">
        <button className="btn ghost" onClick={back}><Icon name="back" />{editor ? 'BACK TO EDIT' : 'BACK'}</button>
        <button className="btn big accent" disabled={!url || left === 0} onClick={print}><Icon name="print" />{n > 1 ? `PRINT ${n} COPIES` : 'PRINT'}</button>
      </div>
    </main>
  );
}
