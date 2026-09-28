import { useEffect, useRef, useState } from 'react';
import {
  PIN_MAX, PIN_MIN, createPinRecord, isLocked, isValidPin, loadAdmin, lockRemainingMs, registerAttempt, saveAdmin, verifyPin, type AdminState
} from '../config/pin';

type Mode = 'enter' | 'set' | 'confirm';
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'DEL', '0', 'OK'];

/**
 * Owner PIN keypad. `forceSet` = change PIN (already unlocked). First run (no PIN stored) asks the owner to CREATE one.
 * Calls onDone() once the owner is in. Nothing customer-facing: plain black-and-white keypad, big touch targets.
 */
export function PinGate({ forceSet = false, onDone, onCancel }: { forceSet?: boolean; onDone: () => void; onCancel: () => void }) {
  const admin = useRef<AdminState>(loadAdmin());
  const [mode, setMode] = useState<Mode>(forceSet || !admin.current.pin ? 'set' : 'enter');
  const [entry, setEntry] = useState('');
  const [first, setFirst] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const locked = mode === 'enter' && isLocked(admin.current.lock, now);

  // tick once a second while locked so the countdown updates and the keypad frees itself
  useEffect(() => {
    if (!locked) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [locked]);

  const title = mode === 'set' ? 'CREATE OWNER PIN' : mode === 'confirm' ? 'REPEAT THE PIN' : 'OWNER PIN';
  const hint = mode === 'set' ? `${PIN_MIN}\u2013${PIN_MAX} DIGITS` : mode === 'confirm' ? 'ENTER IT AGAIN' : 'ENTER YOUR PIN';

  const submit = async () => {
    if (busy || locked) return;
    if (!isValidPin(entry)) { setNote(`USE ${PIN_MIN}\u2013${PIN_MAX} DIGITS`); return; }
    setBusy(true);
    try {
      if (mode === 'set') { setFirst(entry); setEntry(''); setNote(''); setMode('confirm'); return; }
      if (mode === 'confirm') {
        if (entry !== first) { setEntry(''); setFirst(''); setNote('PINS DID NOT MATCH \u2014 START AGAIN'); setMode('set'); return; }
        const next: AdminState = { pin: await createPinRecord(entry), lock: admin.current.lock };
        admin.current = next; saveAdmin(next); onDone(); return;
      }
      const t = Date.now();
      const ok = await verifyPin(admin.current.pin, entry);
      const lock = registerAttempt(admin.current.lock, ok, t);
      admin.current = { ...admin.current, lock }; saveAdmin(admin.current);
      if (ok) { onDone(); return; }
      setEntry(''); setNow(t);
      setNote(isLocked(lock, t) ? '' : 'WRONG PIN');
    } finally { setBusy(false); }
  };

  const press = (k: string) => {
    if (busy || locked) return;
    setNote('');
    if (k === 'DEL') setEntry((e) => e.slice(0, -1));
    else if (k === 'OK') void submit();
    else setEntry((e) => (e.length < PIN_MAX ? e + k : e));
  };

  const secs = Math.ceil(lockRemainingMs(admin.current.lock, now) / 1000);
  return (
    <main className="pin">
      <h2 className="prt-title">{title}</h2>
      <p className="edit-hint">{locked ? `TOO MANY TRIES \u2014 WAIT ${secs} S` : hint}</p>
      <div className="pin-dots" role="img" aria-label={`${entry.length} digits entered`}>
        {Array.from({ length: PIN_MAX }, (_, i) => <span key={i} className={i < entry.length ? 'on' : ''} />)}
      </div>
      <p className="err pin-note" aria-live="polite">{note}</p>
      <div className="pin-pad">
        {KEYS.map((k) => (
          <button key={k} className={k === 'OK' ? 'btn big' : 'btn ghost'} disabled={locked || busy} onClick={() => press(k)}>{k}</button>
        ))}
      </div>
      <div className="cam-bar"><button className="btn ghost" onClick={onCancel}>CANCEL</button></div>
    </main>
  );
}
