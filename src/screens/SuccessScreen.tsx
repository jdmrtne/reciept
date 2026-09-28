import { useEffect } from 'react';
import { Barcode } from '../components/Barcode';
import { sessionStore, useSession } from '../state/session';
import { loadSettings } from '../config/settings';

/** End of the flow: take your receipt, then back to standby (auto, or DONE). reset() wipes the whole session. */
export function SuccessScreen() {
  const { stamp } = useSession();
  useEffect(() => {
    const t = window.setTimeout(() => sessionStore.reset(), loadSettings().successSeconds * 1000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <main className="standby done">
      <div className="receipt">
        <p className="receipt-head">THANK YOU</p>
        <hr className="dash" />
        <h1 className="tap">TAKE YOUR<br />RECEIPT</h1>
        <hr className="dash" />
        <p className="receipt-row"><span>NO.</span><span>{stamp?.serial ?? '------'}</span></p>
        <Barcode seed={stamp?.serial ?? 'thanks'} />
        <p className="receipt-foot">SEE YOU NEXT TIME.</p>
        <button className="btn" style={{ marginTop: '1.2em' }} onClick={() => sessionStore.reset()}>DONE</button>
        <div className="tear" aria-hidden="true" />
      </div>
    </main>
  );
}
