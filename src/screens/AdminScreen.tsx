import { useEffect, useState } from 'react';
import { sessionStore } from '../state/session';
import { loadSettings, mergeSettings, saveSettings, type BoothSettings } from '../config/settings';
import { PAPER_DOTS } from '../layouts/engine';
import { getPrinterManager, PRINTER_MESSAGES, THERMAL_PRESETS, TONE_KEYS, toPrinterError, type DitherMode, type PrinterKind, type ThermalSettings } from '../print';
import { makeTestPage } from '../print/testpage';
import { bitmapToCanvas } from '../print/browser';
import { canvasToBlob } from '../render/render';
import { PinGate } from './PinGate';
import { checkShare, type ShareFailure } from '../share/service';
import { getShareStore, makeSessionId } from '../share/backend';
import { normalizePublicBase, resolvePageBase } from '../share/url';
import { Icon } from '../components/Icon';

const DITHERS: DitherMode[] = ['atkinson', 'floyd-steinberg', 'ordered', 'threshold', 'halftone'];
/** Selectable printers. */
const PRINTER_CHOICES: { kind: PrinterKind; name: string; hint: string }[] = [
  { kind: 'system', name: 'SYSTEM PRINT', hint: 'Any printer installed on this device, via the print dialog' },
  { kind: 'windows', name: 'WINDOWS PRINTER', hint: 'A printer installed in Windows (USB works), no dialog. Needs: npm run bridge' },
  { kind: 'usb', name: 'USB (DIRECT)', hint: 'Browser talks to the USB printer itself (Android; needs a driver swap on Windows)' },
  { kind: 'network', name: 'NETWORK', hint: 'LAN/Wi-Fi printer via the print bridge (npm run bridge)' },
  { kind: 'bluetooth', name: 'BLUETOOTH', hint: 'BLE thermal printer (pair once)' },
  { kind: 'mock', name: 'TEST PRINTER', hint: 'Prints nothing. For trying the app without hardware' }
];
/** Owner-facing failure text: the plain title plus the technical reason (customers never see this screen). */
const why = (e: unknown) => { const p = toPrinterError(e), t = PRINTER_MESSAGES[p.code].title; return p.message && p.message !== p.code ? `${t} \u2014 ${p.message}` : t; };
const SHARE_CHECK: Record<ShareFailure, string> = {
  config: getShareStore() ? 'SITE URL MISSING: THIS SITE IS NOT REACHABLE FROM PHONES (NO localhost). TYPE THE ADDRESS WHERE THE BOOTH APP IS HOSTED' : 'PUBLIC URL MISSING OR NOT REACHABLE FROM PHONES (NO localhost)',
  upload: getShareStore() ? 'CANNOT UPLOAD TO SUPABASE \u2014 CHECK INTERNET, BUCKET photobooth-media AND ITS POLICIES (docs/SUPABASE.md)' : 'CANNOT UPLOAD TO THE BRIDGE \u2014 IS `npm run bridge` RUNNING? CHECK BRIDGE URL',
  unreachable: 'UPLOAD OK BUT THE PUBLIC URL DOES NOT SERVE IT \u2014 CHECK THE TUNNEL / PORT (SHARE_PORT, 9102)',
  collision: 'TEST FILE ID ALREADY EXISTS \u2014 TRY AGAIN',
  missing: 'TEST FILE MISSING', render: 'TEST FILE FAILED', qr: 'QR FAILED'
};
const next = <T,>(list: T[], v: T) => list[(list.indexOf(v) + 1) % list.length];
/** Which tone preset the current thermal tuning equals (CUSTOM once any value is nudged). */
const presetOf = (t: ThermalSettings) => THERMAL_PRESETS.find((p) => TONE_KEYS.every((k) => t[k] === p.tone[k]));

function Row({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus?: () => void; onPlus?: () => void }) {
  return (
    <div className="adm-row">
      <span>{label}</span>
      {onMinus && <button className="btn ghost adm-b" onClick={onMinus} aria-label={`${label} less`}>{'\u2212'}</button>}
      <b className="adm-v">{value}</b>
      {onPlus && <button className="btn ghost adm-b" onClick={onPlus} aria-label={`${label} more`}>+</button>}
    </div>
  );
}

/**
 * Owner-only door: PIN keypad first (first visit = create a PIN), then the calibration panel.
 * Leaving (EXIT/idle reset) remounts the screen, so it is locked again next time.
 */
export function AdminScreen() {
  const [stage, setStage] = useState<'lock' | 'panel' | 'change'>('lock');
  if (stage === 'lock') return <PinGate onDone={() => setStage('panel')} onCancel={() => sessionStore.reset()} />;
  if (stage === 'change') return <PinGate forceSet onDone={() => setStage('panel')} onCancel={() => setStage('panel')} />;
  return <AdminPanel onChangePin={() => setStage('change')} />;
}

/** Calibration: printer, paper, thermal tuning, TEST PRINT (with the 1-bit result shown). Settings persist immediately. */
function AdminPanel({ onChangePin }: { onChangePin: () => void }) {
  const [s, setS] = useState<BoothSettings>(loadSettings);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const apply = (next: BoothSettings) => { saveSettings(next); setS(next); };
  const set = (p: Partial<BoothSettings>) => apply(mergeSettings({ ...s, ...p }));
  const tune = (p: Partial<ThermalSettings>) => set({ thermal: { ...s.thermal, ...p } });
  const t = s.thermal;

  const pair = async () => {
    setNote(s.printer === 'network' || s.printer === 'windows' ? 'CHECKING PRINTER' : 'CHOOSE YOUR PRINTER IN THE POP-UP');
    setBusy(true);
    try { const mgr = getPrinterManager(); await mgr.select(s.printer); await mgr.pair(); setNote(s.printer === 'network' || s.printer === 'windows' ? 'PRINTER REACHABLE \u2014 NOW TEST PRINT' : 'PRINTER PAIRED \u2014 NOW TEST PRINT'); }
    catch (e) { setNote(why(e)); }
    finally { setBusy(false); }
  };

  const testShare = async () => {
    setBusy(true); setNote('CHECKING PHOTO SHARING');
    try {
      const code = await checkShare(makeSessionId(), { fetch: (i, o) => fetch(i, o), bridgeUrl: s.network.bridgeUrl, publicBase: normalizePublicBase(s.share.publicBaseUrl), pageBase: resolvePageBase({ cloud: !!getShareStore(), publicBaseUrl: s.share.publicBaseUrl, origin: location.origin }), store: getShareStore() ?? undefined });
      setNote(code ? SHARE_CHECK[code] : 'PHOTO SHARING WORKS \u2014 QR CODES WILL APPEAR AFTER PRINTING');
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setNote(s.printer === 'mock' ? 'TEST PRINTER SELECTED \u2014 NOTHING WILL COME OUT. PICK A REAL PRINTER ABOVE' : 'PRINTING TEST PAGE');
    try {
      const mgr = getPrinterManager();
      await mgr.select(s.printer);
      const r = await mgr.print(makeTestPage(PAPER_DOTS[s.paperWidthMm]), { thermal: t, paperDots: PAPER_DOTS[s.paperWidthMm] });
      const blob = await canvasToBlob(bitmapToCanvas(r.bitmap, 1));
      setUrl(URL.createObjectURL(blob)); setNote(s.printer === 'mock' ? 'TEST PRINTER ONLY \u2014 NOTHING WAS PRINTED. PICK A REAL PRINTER ABOVE' : 'TEST PAGE SENT');
    } catch (e) {
      setNote(why(e));
    } finally { setBusy(false); }
  };

  return (
    <main className="adm">
      <h2 className="prt-title">OWNER SETTINGS</h2>
      <div className="adm-body">
        <div className="adm-col">
          <div className="adm-pick" role="radiogroup" aria-label="Printer">
            <span className="adm-pick-h">PRINTER</span>
            {PRINTER_CHOICES.map((c) => (
              <button key={c.kind} role="radio" aria-checked={s.printer === c.kind} disabled={busy}
                className={s.printer === c.kind ? 'btn adm-opt on' : 'btn ghost adm-opt'}
                onClick={() => { set({ printer: c.kind }); setNote(''); }}>
                <b>{c.name}</b><small>{c.hint}</small>
              </button>
            ))}
          </div>
          {s.printer === 'windows' && (
            <div className="adm-net">
              <label>WINDOWS PRINTER NAME<input className="adm-in" value={s.windowsPrinter} placeholder="POS80 10.0.0.11" disabled={busy}
                onChange={(e) => set({ windowsPrinter: e.target.value })} /></label>
              <label>BRIDGE URL<input className="adm-in" inputMode="url" value={s.network.bridgeUrl} placeholder="http://localhost:9101" disabled={busy}
                onChange={(e) => set({ network: { ...s.network, bridgeUrl: e.target.value } })} /></label>
            </div>
          )}
          {s.printer === 'network' && (
            <div className="adm-net">
              <label>PRINTER IP<input className="adm-in" inputMode="decimal" value={s.network.host} placeholder="10.0.0.11" disabled={busy}
                onChange={(e) => set({ network: { ...s.network, host: e.target.value } })} /></label>
              <label>BRIDGE URL<input className="adm-in" inputMode="url" value={s.network.bridgeUrl} placeholder="http://localhost:9101" disabled={busy}
                onChange={(e) => set({ network: { ...s.network, bridgeUrl: e.target.value } })} /></label>
            </div>
          )}
          <Row label="SHARE QR" value={s.share.enabled ? 'ON' : 'OFF'} onPlus={() => set({ share: { ...s.share, enabled: !s.share.enabled } })} />
          {s.share.enabled && getShareStore() && (
            <div className="adm-net">
              <p className="edit-hint">STORAGE: SUPABASE (photobooth-media)</p>
              <label>SITE URL (WHAT THE QR OPENS; BLANK = THIS SITE)<input className="adm-in" inputMode="url" value={s.share.publicBaseUrl} placeholder="https://booth.example.com" disabled={busy}
                onChange={(e) => set({ share: { ...s.share, publicBaseUrl: e.target.value } })} /></label>
            </div>
          )}
          {s.share.enabled && !getShareStore() && (
            <div className="adm-net">
              <label>PUBLIC URL (WHAT PHONES OPEN)<input className="adm-in" inputMode="url" value={s.share.publicBaseUrl} placeholder="https://photos.example.com" disabled={busy}
                onChange={(e) => set({ share: { ...s.share, publicBaseUrl: e.target.value } })} /></label>
              {s.printer !== 'network' && s.printer !== 'windows' && (
                <label>BRIDGE URL (UPLOADS)<input className="adm-in" inputMode="url" value={s.network.bridgeUrl} placeholder="http://localhost:9101" disabled={busy}
                  onChange={(e) => set({ network: { ...s.network, bridgeUrl: e.target.value } })} /></label>
              )}
            </div>
          )}
          <Row label="PAPER" value={`${s.paperWidthMm} MM`} onPlus={() => set({ paperWidthMm: s.paperWidthMm === 58 ? 80 : 58 })} />
          <Row label="PRESET" value={presetOf(t)?.name ?? 'CUSTOM'} onPlus={() => {
            const cur = presetOf(t), pick = THERMAL_PRESETS[(cur ? THERMAL_PRESETS.indexOf(cur) + 1 : 0) % THERMAL_PRESETS.length];
            tune(Object.fromEntries(TONE_KEYS.map((k) => [k, pick.tone[k]])) as Partial<ThermalSettings>); // tone only: margins/feed/cut stay
          }} />
          <Row label="DITHER" value={t.dither.toUpperCase()} onPlus={() => tune({ dither: next(DITHERS, t.dither) })} />
          {t.dither === 'halftone' && <Row label="DOT SIZE" value={String(t.dotSize)} onMinus={() => tune({ dotSize: t.dotSize - 1 })} onPlus={() => tune({ dotSize: t.dotSize + 1 })} />}
          <Row label="BRIGHTNESS" value={String(t.brightness)} onMinus={() => tune({ brightness: t.brightness - 10 })} onPlus={() => tune({ brightness: t.brightness + 10 })} />
          <Row label="CONTRAST" value={String(t.contrast)} onMinus={() => tune({ contrast: t.contrast - 10 })} onPlus={() => tune({ contrast: t.contrast + 10 })} />
          <Row label="DENSITY" value={String(t.density)} onMinus={() => tune({ density: t.density - 1 })} onPlus={() => tune({ density: t.density + 1 })} />
          <Row label="SHARPEN" value={String(t.sharpen)} onMinus={() => tune({ sharpen: t.sharpen - 5 })} onPlus={() => tune({ sharpen: t.sharpen + 5 })} />
          <Row label="AUTO LEVEL" value={String(t.autoLevel)} onMinus={() => tune({ autoLevel: t.autoLevel - 10 })} onPlus={() => tune({ autoLevel: t.autoLevel + 10 })} />
          <Row label="THRESHOLD" value={String(t.threshold)} onMinus={() => tune({ threshold: t.threshold - 8 })} onPlus={() => tune({ threshold: t.threshold + 8 })} />
          <Row label="SIDE MARGIN" value={String(t.marginX)} onMinus={() => tune({ marginX: t.marginX - 8 })} onPlus={() => tune({ marginX: t.marginX + 8 })} />
          <Row label="FEED LINES" value={String(t.feedLines)} onMinus={() => tune({ feedLines: t.feedLines - 1 })} onPlus={() => tune({ feedLines: t.feedLines + 1 })} />
          {s.printer === 'bluetooth' && <Row label="BT CHUNK" value={String(s.bluetooth.chunkSize)} onMinus={() => set({ bluetooth: { ...s.bluetooth, chunkSize: s.bluetooth.chunkSize - 20 } })} onPlus={() => set({ bluetooth: { ...s.bluetooth, chunkSize: s.bluetooth.chunkSize + 20 } })} />}
          {s.printer === 'bluetooth' && <Row label="BT DELAY MS" value={String(s.bluetooth.chunkDelayMs)} onMinus={() => set({ bluetooth: { ...s.bluetooth, chunkDelayMs: s.bluetooth.chunkDelayMs - 5 } })} onPlus={() => set({ bluetooth: { ...s.bluetooth, chunkDelayMs: s.bluetooth.chunkDelayMs + 5 } })} />}
          <Row label="CUT" value={t.cut ? 'ON' : 'OFF'} onPlus={() => tune({ cut: !t.cut })} />
        </div>
        <div className="adm-prev">{url ? <img src={url} alt="1-bit test page as printed" className="adm-img" /> : <p className="err">No test page yet.</p>}</div>
      </div>
      {note && <p className="edit-hint" aria-live="polite">{note}</p>}
      <div className="cam-bar">
        <button className="btn ghost" onClick={() => sessionStore.reset()}><Icon name="close" />EXIT</button>
        <button className="btn ghost" disabled={busy} onClick={onChangePin}>CHANGE PIN</button>
        {(s.printer === 'usb' || s.printer === 'bluetooth') && <button className="btn ghost" disabled={busy} onClick={pair}>PAIR PRINTER</button>}
        {(s.printer === 'network' || s.printer === 'windows') && <button className="btn ghost" disabled={busy} onClick={pair}>CHECK PRINTER</button>}
        {s.share.enabled && <button className="btn ghost" disabled={busy} onClick={testShare}>CHECK SHARE</button>}
        <button className="btn big" disabled={busy} onClick={test}>TEST PRINT</button>
      </div>
    </main>
  );
}
