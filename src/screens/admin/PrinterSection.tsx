import { Icon } from '../../components/Icon';
import type { PrinterKind } from '../../print';
import { Hint, StepperRow, TextField } from './ui';
import { TestPrintBody } from './TestPrint';
import type { AdminCtx, SectionDef } from './types';

/** Selectable printers. */
export const PRINTER_CHOICES: { kind: PrinterKind; name: string; hint: string }[] = [
  { kind: 'system', name: 'SYSTEM PRINT', hint: 'Any printer installed on this device, via the print dialog' },
  { kind: 'windows', name: 'WINDOWS PRINTER', hint: 'A printer installed in Windows (USB works), no dialog. Needs: npm run bridge' },
  { kind: 'usb', name: 'USB (DIRECT)', hint: 'Browser talks to the USB printer itself (Android; needs a driver swap on Windows)' },
  { kind: 'network', name: 'NETWORK', hint: 'LAN/Wi-Fi printer via the print bridge (npm run bridge)' },
  { kind: 'bluetooth', name: 'BLUETOOTH', hint: 'BLE thermal printer (pair once)' },
  { kind: 'mock', name: 'TEST PRINTER', hint: 'Prints nothing. For trying the app without hardware' }
];

function PrinterType({ s, set, busy, clearNotice }: AdminCtx) {
  return (
    <div className="opts" role="radiogroup" aria-label="Printer">
      {PRINTER_CHOICES.map((c) => (
        <button key={c.kind} type="button" role="radio" aria-checked={s.printer === c.kind} disabled={busy}
          className={s.printer === c.kind ? 'btn adm-opt on' : 'btn ghost adm-opt'}
          onClick={() => { clearNotice(); set({ printer: c.kind }); /* clear first: a failed save must be able to show its own notice */ }}>
          <b>{c.name}{s.printer === c.kind && <Icon name="check" />}</b><small>{c.hint}</small>
        </button>
      ))}
    </div>
  );
}

function Connection({ s, set, busy }: AdminCtx) {
  const bridge = (
    <TextField label="BRIDGE URL" inputMode="url" value={s.network.bridgeUrl} placeholder="http://localhost:9101" disabled={busy}
      onChange={(v) => set({ network: { ...s.network, bridgeUrl: v } })} />
  );
  if (s.printer === 'windows') {
    return (
      <>
        <TextField label="WINDOWS PRINTER NAME" value={s.windowsPrinter} placeholder="POS80 10.0.0.11" disabled={busy} onChange={(v) => set({ windowsPrinter: v })} />
        {bridge}
      </>
    );
  }
  if (s.printer === 'network') {
    return (
      <>
        <TextField label="PRINTER IP" inputMode="decimal" value={s.network.host} placeholder="10.0.0.11" disabled={busy} onChange={(v) => set({ network: { ...s.network, host: v } })} />
        {bridge}
      </>
    );
  }
  if (s.printer === 'bluetooth') {
    return (
      <>
        <Hint>If prints arrive garbled or incomplete, lower the chunk size or raise the delay. Slower is safer.</Hint>
        <StepperRow label="BT CHUNK" hint="Bytes per write" value={String(s.bluetooth.chunkSize)}
          onMinus={() => set({ bluetooth: { ...s.bluetooth, chunkSize: s.bluetooth.chunkSize - 20 } })} onPlus={() => set({ bluetooth: { ...s.bluetooth, chunkSize: s.bluetooth.chunkSize + 20 } })} />
        <StepperRow label="BT DELAY MS" hint="Pause after each write" value={String(s.bluetooth.chunkDelayMs)}
          onMinus={() => set({ bluetooth: { ...s.bluetooth, chunkDelayMs: s.bluetooth.chunkDelayMs - 5 } })} onPlus={() => set({ bluetooth: { ...s.bluetooth, chunkDelayMs: s.bluetooth.chunkDelayMs + 5 } })} />
      </>
    );
  }
  return <Hint>{s.printer === 'usb' ? 'Nothing to type here. Plug the printer in and use PAIR PRINTER below.' : s.printer === 'system' ? 'Nothing to set up. Printing opens this device\u2019s print dialog.' : 'The test printer needs no setup.'}</Hint>;
}

export const printerSection: SectionDef = {
  id: 'printer',
  label: 'Printer',
  icon: 'print',
  description: 'Which printer the booth prints to, how it connects, and a quick check that it works.',
  cards: [
    { id: 'printer-type', title: 'Printer type', description: 'Choose how this booth reaches its printer.', keywords: ['printer', 'system print', 'windows printer', 'usb', 'network', 'bluetooth', 'test printer', 'mock', 'hardware', 'thermal', 'receipt'], render: (c) => <PrinterType {...c} /> },
    { id: 'printer-connection', title: 'Connection details', description: 'Only the fields your printer type needs.', keywords: ['windows printer name', 'printer ip', 'bridge url', 'bridge', 'address', 'host', 'bt chunk', 'bt delay ms', 'bluetooth', 'chunk size', 'delay', 'network', 'lan'], render: (c) => <Connection {...c} /> },
    { id: 'printer-test', title: 'Check & test', description: 'Confirm the printer is reachable, then print a test page.', keywords: ['test print', 'pair printer', 'check printer', 'pair', 'reachable', 'test page', 'preview'], render: (c) => <TestPrintBody c={c} withConnect /> }
  ]
};
