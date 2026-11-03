import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { sessionStore, useSession } from '../state/session';
import { loadSettings } from '../config/settings';
import { ensureSessionStamp } from '../state/stamp';
import { browserEnv, canvasToBlob, renderPrint } from '../render/render';
import { forReading, isSideways } from '../render/orient';
import { PAPER_DOTS } from '../layouts/engine';
import { getPrinterManager, PRINTER_MESSAGES, toPrinterError, toThermalBitmap, type PrinterErrorCode, type RGBAImage } from '../print';
import { bitmapToCanvas, canvasToRGBA } from '../print/browser';
import { autoSaveSession } from '../autosave/autosave';
import { canOfferReconnectAfterError, reconnectUsbPrinter } from '../print/reconnect';
import { Icon } from '../components/Icon';
import { frameQrForSession, qrErrorText } from '../qr/sessionQr';
import { runCopies } from '../print/copies';
import { setPrintBusy } from '../print/busy';

type Phase = 'preparing' | 'ready' | 'printing' | 'error';

/**
 * PRINT: shows the 1-bit result exactly as the printer will burn it (same pipeline + settings), then prints via
 * PrinterManager. Failures show a short plain message and RETRY. The composition is never modified.
 */
export function PrintScreen() {
  const { editor, stamp, copies, printed } = useSession();
  const total = Math.max(1, copies); // copies the guest asked for in this run
  const [current, setCurrent] = useState(printed + 1); // the copy being printed now (1-based)
  const [phase, setPhase] = useState<Phase>('preparing');
  const [url, setUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [code, setCode] = useState<PrinterErrorCode | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [prepFailed, setPrepFailed] = useState(false);
  const [prepMsg, setPrepMsg] = useState<string | null>(null);
  const image = useRef<RGBAImage | null>(null);
  const alive = useRef(true);
  const autoStarted = useRef(false);

  useEffect(() => { alive.current = true; return () => { alive.current = false; setPrintBusy(false); }; }, []);

  useEffect(() => {
    if (!editor) { setPrepFailed(true); return; }
    let dead = false, made: string | null = null;
    const { paperWidthMm, thermal } = loadSettings();
    renderPrint(editor.present, stamp ?? ensureSessionStamp(), paperWidthMm, undefined, frameQrForSession() ?? undefined)
      .then(async (c) => {
        const rgba = canvasToRGBA(c);
        const bits = toThermalBitmap(rgba, thermal, PAPER_DOTS[paperWidthMm]);
        const blob = await canvasToBlob(forReading(bitmapToCanvas(bits, 2), editor.present.layoutId, browserEnv)); // shown the way the paper is READ; `rgba`/`bits` (what is burned) stay in paper space
        if (dead) return;
        image.current = rgba; made = URL.createObjectURL(blob);
        setUrl(made); setPhase('ready');
      })
      .catch((e) => { if (!dead) { setPrepMsg(qrErrorText(e)); setPrepFailed(true); } });
    return () => { dead = true; if (made) URL.revokeObjectURL(made); image.current = null; };
  }, [editor, stamp]);

  /**
   * Prints the copies still missing in this run: ONE bitmap, sent once per copy (same photo, same QR). The inactivity timer is paused
   * while copies come out. If a copy fails (printer knocked loose, paper out) the copies already printed stay counted in the session,
   * so RETRY / RECONNECT continues with the REMAINING ones and never prints a copy twice.
   */
  const print = async () => {
    if (!image.current || phase === 'printing') return;
    const { paperWidthMm, thermal } = loadSettings();
    const sid = sessionStore.get().id, wanted = Math.max(1, sessionStore.get().copies);
    const same = () => alive.current && sessionStore.get().id === sid; // the screen is still open and no new guest has started
    setPhase('printing'); setProgress(0); setCode(null); setPrintBusy(true);
    let res: Awaited<ReturnType<typeof runCopies>>;
    try {
      const mgr = getPrinterManager();
      await mgr.select(loadSettings().printer); // the owner may have switched printer in ADMIN since the manager was built
      res = await runCopies({
        total: wanted, alreadyPrinted: sessionStore.get().printed,
        cancelled: () => !same(),
        onCopyStart: (i) => { if (same()) { setCurrent(i); setProgress(0); } },
        printOne: async () => {
          const img = image.current;
          if (!img) throw new Error('screen left');
          await mgr.print(img, { thermal, paperDots: PAPER_DOTS[paperWidthMm], onProgress: (p) => same() && setProgress(p) });
        },
        onCopyDone: (n) => { if (sessionStore.get().id === sid) sessionStore.update({ printed: n, printedTotal: sessionStore.get().printedTotal + 1 }); }
      });
    } catch (e) { res = { ok: false, printed: sessionStore.get().printed, error: e }; }
    setPrintBusy(false);
    if (!same()) return;
    if (res.ok) {
      const again = sessionStore.get().printReturn; // set by PRINT ANOTHER COPY: go back to where the guest was, not through the whole flow again
      if (!again && !loadSettings().share.enabled) autoSaveSession(); // no share screen will render the files: auto-save renders what is switched on, in the background (once per guest, not per extra copy)
      sessionStore.update({ printReturn: null, screen: again ?? (loadSettings().share.enabled ? 'share' : 'success') }); // print succeeded: QR codes next (when the owner enabled them), else straight to the receipt screen
    } else if ('error' in res) { setCode(toPrinterError(res.error).code); setPhase('error'); }
  };

  // Printer knocked loose mid-session: one tap picks the USB printer again and, once it is back, prints the same receipt (no ADMIN, no lost session).
  const reconnect = async () => {
    setReconnecting(true);
    const r = await reconnectUsbPrinter();
    if (!alive.current) return;
    setReconnecting(false);
    if (r.ok) void print();
  };

  // The person already tapped PRINT on the preview screen: start printing as soon as the bitmap is ready (once only,
  // so a failed job waits for RETRY instead of looping).
  useEffect(() => {
    if (phase === 'ready' && !autoStarted.current) { autoStarted.current = true; void print(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const msg = code ? PRINTER_MESSAGES[code] : null;
  const printing = phase === 'printing';
  const overall = Math.round(((Math.min(current, total) - 1 + progress) / total) * 100); // the whole run: finished copies plus the one in progress
  const sideways = !!editor && isSideways(editor.present.layoutId); // the picture is turned for reading, so the "paper feeding out" reveal runs left to right
  return (
    <main className="prev">
      <p className="edit-hint">{printing ? (total > 1 ? `PRINTING COPY ${current} OF ${total}` : 'PRINTING') : phase === 'error' ? 'PRINT FAILED' : 'PREPARING TO PRINT'}</p>
      <div className="prev-stage">
        {prepFailed ? <p className="err">{prepMsg ?? 'Could not prepare your receipt. Go back and try again.'}</p>
          : url ? (
            <div className={`prt-paper${sideways ? ' sideways' : ''}${printing ? ' feeding' : ''}`} style={printing ? ({ '--p': `${Math.round(progress * 100)}%` } as CSSProperties) : undefined}>
              <img src={url} alt="Black and white print preview" className="prev-img prt-img" />
            </div>
          ) : <p className="loading">PREPARING YOUR RECEIPT</p>}
        {phase === 'error' && msg && (
          <div className="cam-msg" role="alert">
            <h2 className="prt-title">{msg.title}</h2>
            <p className="err">{msg.hint}</p>
            {total > 1 && <p className="err" role="status">{printed} OF {total} COPIES PRINTED. RETRY PRINTS THE {total - printed} LEFT.</p>}
          </div>
        )}
      </div>
      {printing && (
        <div aria-live="polite">
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overall}><i style={{ width: `${overall}%` }} /></div>
          <p className="edit-hint loading">{total > 1 ? `COPY ${current} OF ${total}` : `${overall}%`}</p>
        </div>
      )}
      <div className="cam-bar">
        <button className="btn ghost" disabled={printing || reconnecting} onClick={() => sessionStore.go(prepFailed ? 'edit' : 'preview')}><Icon name="back" />BACK</button>
        {phase === 'error' && canOfferReconnectAfterError(loadSettings().printer, code)
          ? <>
              <button className="btn big accent" disabled={reconnecting} onClick={() => void reconnect()}><Icon name="print" />{reconnecting ? 'CONNECTING' : 'RECONNECT PRINTER'}</button>
              <button className="btn ghost" disabled={reconnecting} onClick={print}><Icon name="retry" />RETRY</button>
            </>
          : phase === 'error'
          ? <button className="btn big accent" onClick={print}><Icon name="retry" />RETRY</button>
          : <button className="btn big accent" disabled={phase !== 'ready'} onClick={print}><Icon name="print" />{printing ? 'PRINTING' : total > 1 ? `PRINT ${total - printed} COPIES` : 'PRINT NOW'}</button>}
      </div>
    </main>
  );
}
