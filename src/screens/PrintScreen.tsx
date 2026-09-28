import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { sessionStore, useSession } from '../state/session';
import { loadSettings } from '../config/settings';
import { makeCtx } from '../frames/prims';
import { canvasToBlob, renderPrint } from '../render/render';
import { PAPER_DOTS } from '../layouts/engine';
import { getPrinterManager, PRINTER_MESSAGES, toPrinterError, toThermalBitmap, type PrinterErrorCode, type RGBAImage } from '../print';
import { bitmapToCanvas, canvasToRGBA } from '../print/browser';

type Phase = 'preparing' | 'ready' | 'printing' | 'error';

/**
 * PRINT: shows the 1-bit result exactly as the printer will burn it (same pipeline + settings), then prints via
 * PrinterManager. Failures show a short plain message and RETRY. The composition is never modified.
 */
export function PrintScreen() {
  const { editor, stamp } = useSession();
  const [phase, setPhase] = useState<Phase>('preparing');
  const [url, setUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [code, setCode] = useState<PrinterErrorCode | null>(null);
  const [prepFailed, setPrepFailed] = useState(false);
  const image = useRef<RGBAImage | null>(null);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (!editor) { setPrepFailed(true); return; }
    let dead = false, made: string | null = null;
    const { eventName, paperWidthMm, thermal } = loadSettings();
    renderPrint(editor.present, stamp ?? makeCtx(eventName), paperWidthMm)
      .then(async (c) => {
        const rgba = canvasToRGBA(c);
        const bits = toThermalBitmap(rgba, thermal, PAPER_DOTS[paperWidthMm]);
        const blob = await canvasToBlob(bitmapToCanvas(bits, 2));
        if (dead) return;
        image.current = rgba; made = URL.createObjectURL(blob);
        setUrl(made); setPhase('ready');
      })
      .catch(() => { if (!dead) setPrepFailed(true); });
    return () => { dead = true; if (made) URL.revokeObjectURL(made); image.current = null; };
  }, [editor, stamp]);

  const print = async () => {
    if (!image.current || phase === 'printing') return;
    const { paperWidthMm, thermal } = loadSettings();
    setPhase('printing'); setProgress(0); setCode(null);
    try {
      const mgr = getPrinterManager();
      await mgr.select(loadSettings().printer); // the owner may have switched printer in ADMIN since the manager was built
      await mgr.print(image.current, {
        thermal, paperDots: PAPER_DOTS[paperWidthMm],
        onProgress: (p) => alive.current && setProgress(p)
      });
      if (alive.current) sessionStore.go('success');
    } catch (e) {
      if (alive.current) { setCode(toPrinterError(e).code); setPhase('error'); }
    }
  };

  const msg = code ? PRINTER_MESSAGES[code] : null;
  const printing = phase === 'printing';
  return (
    <main className="prev">
      <p className="edit-hint">{printing ? 'PRINTING' : 'PRINT PREVIEW \u2014 THIS IS HOW IT WILL PRINT'}</p>
      <div className="prev-stage">
        {prepFailed ? <p className="err">Could not prepare your receipt. Go back and try again.</p>
          : url ? (
            <div className={printing ? 'prt-paper feeding' : 'prt-paper'} style={printing ? ({ '--p': `${Math.round(progress * 100)}%` } as CSSProperties) : undefined}>
              <img src={url} alt="Black and white print preview" className="prev-img prt-img" />
            </div>
          ) : <p className="loading">PREPARING YOUR RECEIPT</p>}
        {phase === 'error' && msg && (
          <div className="cam-msg" role="alert">
            <h2 className="prt-title">{msg.title}</h2>
            <p className="err">{msg.hint}</p>
          </div>
        )}
      </div>
      {printing && <p className="edit-hint loading" aria-live="polite">{Math.round(progress * 100)}%</p>}
      <div className="cam-bar">
        <button className="btn ghost" disabled={printing} onClick={() => sessionStore.go(prepFailed ? 'edit' : 'preview')}>BACK</button>
        {phase === 'error'
          ? <button className="btn big" onClick={print}>RETRY</button>
          : <button className="btn big" disabled={phase !== 'ready'} onClick={print}>{printing ? 'PRINTING' : 'PRINT NOW'}</button>}
      </div>
    </main>
  );
}
