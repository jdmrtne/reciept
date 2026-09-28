import { useEffect, useRef, useState } from 'react';
import { Barcode } from '../components/Barcode';
import { sessionStore } from '../state/session';
import { loadSettings } from '../config/settings';
import { makeCtx } from '../frames/prims';

const pad = (n: number) => String(n).padStart(2, '0');

export function Standby() {
  const [now, setNow] = useState(new Date());
  const { eventName } = loadSettings();
  const hold = useRef<number | undefined>(undefined);
  const arm = () => { hold.current = window.setTimeout(() => sessionStore.go('admin'), 2500); };
  const disarm = () => window.clearTimeout(hold.current);
  useEffect(() => disarm, []);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 20);
    return () => clearInterval(t);
  }, []);
  const date = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  return (
    <>
    <button className="standby" onClick={() => sessionStore.update({ stamp: makeCtx(eventName), screen: 'layout' })} aria-label="Tap to start">
      <div className="receipt">
        <p className="receipt-head">{eventName}</p>
        <p className="receipt-sub">SELF-SERVICE PHOTO STATION</p>
        <hr className="dash" />
        <p className="receipt-row"><span>DATE</span><span>{date}</span></p>
        <p className="receipt-row"><span>TIME</span><span>{time}</span></p>
        <p className="receipt-row"><span>ITEM</span><span>PHOTO STRIP x1</span></p>
        <hr className="dash" />
        <h1 className="tap">TAP TO<br />START</h1>
        <hr className="dash" />
        <Barcode seed={date + time + eventName} />
        <p className="receipt-foot">KEEP THE RECEIPT. KEEP THE MOMENT.</p>
        <div className="tear" aria-hidden="true" />
      </div>
    </button>
    {/* Owner-only: press and hold the top-right corner for 2.5 s. Invisible on purpose. */}
    <div className="admin-hot" aria-hidden="true" onPointerDown={arm} onPointerUp={disarm} onPointerLeave={disarm} onPointerCancel={disarm} />
    </>
  );
}
