import { useEffect, useState } from 'react';
import { sessionStore, useSession } from '../state/session';
import { loadSettings } from '../config/settings';
import { ensureSessionStamp } from '../state/stamp';
import { browserEnv, canvasToBlob, renderPreview } from '../render/render';
import { forReading } from '../render/orient';
import { Icon } from '../components/Icon';
import { frameQrForSession, qrErrorText } from '../qr/sessionQr';

/** Final look of the receipt, drawn by the same renderer that will feed the printer. */
export function PreviewScreen() {
  const { editor, stamp } = useSession();
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
  return (
    <main className="prev">
      <div className="prev-stage">
        {url ? <img src={url} alt="Your receipt preview" className="prev-img" />
          : error || !editor ? <p className="err">{error || 'Nothing to preview yet.'}</p>
          : <p className="loading">PREPARING YOUR RECEIPT</p>}
      </div>
      <div className="cam-bar">
        <button className="btn ghost" onClick={back}><Icon name="back" />{editor ? 'BACK TO EDIT' : 'BACK'}</button>
        <button className="btn big" disabled={!url} onClick={() => sessionStore.go('print')}><Icon name="print" />PRINT</button>
      </div>
    </main>
  );
}
