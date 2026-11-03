import { useEffect, useState } from 'react';
import { Barcode } from '../components/Barcode';
import { Doodles, Scribble, Tear } from '../components/Doodles';
import { sessionStore, useSession } from '../state/session';
import { loadSettings } from '../config/settings';
import { Icon } from '../components/Icon';
import { copiesLeft } from '../print/copies';

/** Hand-drawn circle + tick that draws itself (pathLength=1 so the dash trick needs no measuring). */
function Stamp() {
  return (
    <svg className="stamp" viewBox="0 0 100 100" aria-hidden="true">
      <path className="stamp-ring" pathLength={1} d="M52 8 C27 6 7 26 9 52 C11 78 32 94 55 91 C80 88 94 66 90 42 C87 24 72 9 50 10" />
      <path className="stamp-tick" pathLength={1} d="M28 53 L44 68 L74 33" />
    </svg>
  );
}

/** End of the flow: take your receipt, then back to standby (auto, or DONE). reset() wipes the whole session. */
export function SuccessScreen() {
  const { stamp, editor, printedTotal } = useSession();
  const copiesRemaining = copiesLeft(loadSettings().maxCopies, printedTotal);
  const another = () => sessionStore.update({ copies: 1, printed: 0, printReturn: 'success', screen: 'print' }); // the same photo and QR, one more copy; the success screen (and its timer) starts fresh afterwards
  const [seconds] = useState(() => Math.max(1, loadSettings().successSeconds));
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t = window.setTimeout(() => sessionStore.reset(), seconds * 1000);
    const tick = window.setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => { window.clearTimeout(t); window.clearInterval(tick); };
  }, [seconds]);
  return (
    <main className="standby done">
      <Doodles />
      <div className="receipt">
        <Stamp />
        <p className="receipt-head">THANK YOU</p>
        <hr className="dash" />
        <h1 className="tap">TAKE YOUR<br />RECEIPT</h1>
        <Scribble />
        <p className="receipt-sub done-hint">PICK IT UP AT THE PRINTER</p>
        {printedTotal > 1 && <p className="receipt-sub done-hint">{printedTotal} COPIES PRINTED</p>}
        <hr className="dash" />
        <p className="receipt-row"><span>NO.</span><span>{stamp?.serial ?? '------'}</span></p>
        <Barcode seed={stamp?.serial ?? 'thanks'} />
        <p className="receipt-foot">SEE YOU NEXT TIME.</p>
        <div className="done-timer" role="timer" aria-live="off">
          <div className="done-bar"><i style={{ animationDuration: `${seconds}s` }} /></div>
          <p>NEXT GUEST IN {left}</p>
        </div>
        <div className="done-actions">
          <button className="btn" onClick={() => sessionStore.reset()}><Icon name="check" />DONE</button>
          {editor && printedTotal > 0 && copiesRemaining > 0 && <button className="btn accent" onClick={another}><Icon name="print" />PRINT ANOTHER COPY</button>}
          {editor && printedTotal > 0 && copiesRemaining === 0 && <p className="receipt-sub done-hint" role="status">COPY LIMIT REACHED</p>}
        </div>
        <Tear />
      </div>
    </main>
  );
}
