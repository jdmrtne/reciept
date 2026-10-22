import { useEffect, useState } from 'react';
import { getPrinterManager, type PrinterHealth } from '../print';

/** Polls the printer while mounted (Standby only). Starts as `null` (unknown) so the UI shows nothing until the first answer. */
export function usePrinterHealth(everyMs = 15000): PrinterHealth | null {
  const [health, setHealth] = useState<PrinterHealth | null>(null);
  useEffect(() => {
    let alive = true, timer: number | undefined;
    const tick = async () => {
      const h = await getPrinterManager().health();
      if (!alive) return;
      setHealth((p) => (p && p.level === h.level && p.detail === h.detail ? p : h));
      timer = window.setTimeout(tick, everyMs);
    };
    tick();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [everyMs]);
  return health;
}
