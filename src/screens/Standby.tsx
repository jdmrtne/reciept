import { useCallback, useEffect, useState } from 'react';
import { Barcode } from '../components/Barcode';
import { Doodles, Scribble, Tear } from '../components/Doodles';
import { sessionStore } from '../state/session';
import { loadSettings } from '../config/settings';
import { newSessionStamp } from '../state/stamp';
import { usePrinterHealth } from '../hooks/usePrinterHealth';
import { useStandbyPhoto } from '../hooks/useStandbyPhoto';
import { ADMIN_TAP, useMultiTap } from '../hooks/useMultiTap';

const HEALTH_LABEL = { ready: 'PRINTER READY', attention: 'CHECK PAPER', offline: 'PRINTER OFFLINE' } as const;

const pad = (n: number) => String(n).padStart(2, '0');

export function Standby() {
  const [now, setNow] = useState(new Date());
  const { eventName, standbyPhoto } = loadSettings();
  const health = usePrinterHealth();
  const photoUrl = useStandbyPhoto(standbyPhoto.enabled, standbyPhoto.version);
  const [broken, setBroken] = useState(false); // a photo that fails to display falls back to the normal standby look
  const photo = photoUrl && !broken ? photoUrl : null;
  const showReceipt = !photo || standbyPhoto.showReceipt;
  // ADMIN: three quick taps on the invisible top-right corner (or open /admin). The PIN stays the real lock.
  const openAdmin = useCallback(() => sessionStore.go('admin'), []);
  const adminTap = useMultiTap(ADMIN_TAP, openAdmin);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 20);
    return () => clearInterval(t);
  }, []);
  const date = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  return (
    <>
    <button className={photo ? 'standby has-photo' : 'standby'} onClick={() => sessionStore.update({ stamp: newSessionStamp(), screen: 'layout' })} aria-label="Tap to start">
      {photo ? <img className="standby-photo" src={photo} alt="" aria-hidden="true" draggable={false} style={{ objectFit: standbyPhoto.fit }} onError={() => setBroken(true)} /> : <Doodles big />}
      {showReceipt ? (
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
      ) : <p className="tap-pill">TAP TO START</p>}
    </button>
    <div className="admin-zone" aria-hidden="true" {...adminTap} />
    {health && <p className={`pdot ${health.level}${photo ? ' on-photo' : ''}`} role="status"><i aria-hidden="true" />{HEALTH_LABEL[health.level]}</p>}
    </>
  );
}
