import { useState } from 'react';
import { Modal } from '../components/Modal';
import { Icon } from '../components/Icon';
import { loadSettings } from '../config/settings';
import { dismissLost, shouldPromptReconnect, useLostSnapshot } from '../print/lostStore';
import { reconnectUsbPrinter } from '../print/reconnect';

/** Screens where printing is still ahead. Standby has its own dot button and PRINT its own RECONNECT button; after printing nothing needs the printer. */
export const PROMPT_SCREENS: readonly string[] = ['layout', 'edit', 'camera', 'preview'];
export const shouldShowLostPrompt = (printer: string, screen: string, snapshot: Parameters<typeof shouldPromptReconnect>[0]): boolean =>
  printer === 'usb' && PROMPT_SCREENS.includes(screen) && shouldPromptReconnect(snapshot);

/**
 * "Printer disconnected" popup for a USB printer that drops mid-session (e.g. the booth was knocked). Chrome only opens the USB chooser from a tap,
 * so the popup carries the button. The guest can keep going with NOT NOW; the popup comes back only after the printer has been lost again.
 */
export function PrinterLostPrompt({ screen }: { screen: string }) {
  const snapshot = useLostSnapshot();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  if (!shouldShowLostPrompt(loadSettings().printer, screen, snapshot)) return null;
  const reconnect = async () => {
    setBusy(true); setFailed(false);
    const r = await reconnectUsbPrinter();
    setBusy(false);
    if (!r.ok && r.reason !== 'cancelled') setFailed(true); // success: the health report hides the popup by itself
  };
  return (
    <Modal label="PRINTER DISCONNECTED" closeLabel="NOT NOW" className="compact" onClose={dismissLost}>
      <p>The printer lost its USB connection. Tap RECONNECT and choose the printer in the list. You can keep taking photos meanwhile.</p>
      {failed && <p className="err" role="alert">Could not connect. Check the cable and the printer power, then try again.</p>}
      <div className="lost-actions">
        <button type="button" className="btn big accent" disabled={busy} onClick={() => void reconnect()}><Icon name="print" />{busy ? 'CONNECTING' : 'RECONNECT PRINTER'}</button>
      </div>
    </Modal>
  );
}
