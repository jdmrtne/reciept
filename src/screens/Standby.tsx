import { useEffect, useState } from 'react';
import { Barcode } from '../components/Barcode';
import { Doodles, Scribble, Tear } from '../components/Doodles';
import { sessionStore } from '../state/session';
import { loadSettings } from '../config/settings';
import { makeCtx } from '../frames/prims';
import { usePrinterHealth } from '../hooks/usePrinterHealth';

const HEALTH_LABEL = { ready: 'PRINTER READY', attention: 'CHECK PAPER', offline: 'PRINTER OFFLINE' } as const;

const pad = (n: number) => String(n).padStart(2, '0');

export function Standby() {
  const [now, setNow] = useState(new Date());
  const { eventName } = loadSettings();
  const health = usePrinterHealth();
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 20);
    return () => clearInterval(t);
  }, []);
  const date = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  return (
    <>
    <button className="standby" onClick={() => sessionStore.update({ stamp: makeCtx(eventName), screen: 'layout' })} aria-label="Tap to start">
      <Doodles onHeart={() => sessionStore.go('admin')} />
      <div className="receipt">
        <p className="receipt-head">{eventName}</p>
        <p className="receipt-sub">SELF-SERVICE PHOTO STATION</p>
        <hr className="dash" />
        <p className="receipt-row"><span>DATE</span><span>{date}</span></p>
        <p className="receipt-row"><span>TIME</span><span>{time}</span></p>
        <p className="receipt-row"><span>ITEM</span><span>PHOTO STRIP x1</span></p>
        <hr className="dash" />
        <h1 className="tap">TAP TO<br />START</h1>
        <Scribble />
        <hr className="dash" />
        <Barcode seed={date + time + eventName} />
        <p className="receipt-foot">KEEP THE RECEIPT. KEEP THE MOMENT.</p>
        <Tear />
      </div>
    </button>
    {health && <p className={`pdot ${health.level}`} role="status"><i aria-hidden="true" />{HEALTH_LABEL[health.level]}</p>}
    </>
  );
}
