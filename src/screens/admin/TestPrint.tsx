import type { AdminCtx } from './types';

/** TEST PRINT + the 1-bit result as it comes out of the printer pipeline. Used by both Printer and Print quality: same action, same preview. */
export function TestPrintBody({ c, withConnect }: { c: AdminCtx; withConnect?: boolean }) {
  const { s, busy, actions, testUrl } = c;
  return (
    <>
      <div className="test-actions">
        {withConnect && (s.printer === 'usb' || s.printer === 'bluetooth') && <button type="button" className="btn ghost" disabled={busy} onClick={actions.pair}>PAIR PRINTER</button>}
        {withConnect && (s.printer === 'network' || s.printer === 'windows') && <button type="button" className="btn ghost" disabled={busy} onClick={actions.pair}>CHECK PRINTER</button>}
        <button type="button" className="btn big" disabled={busy} onClick={actions.testPrint}>TEST PRINT</button>
      </div>
      <div className="test-prev">
        {testUrl ? <img src={testUrl} alt="1-bit test page as printed" className="adm-img" /> : <p className="err">No test page yet.</p>}
      </div>
    </>
  );
}
