import { useSyncExternalStore } from 'react';

/**
 * True while copies are coming out. The inactivity timer (App) is paused during that time: a guest who stands and watches 8 copies print
 * does not touch the screen, and the session (photo, QR, remaining copies) must not be wiped mid-print. The timer starts fresh when this ends.
 */
let busy = false;
const listeners = new Set<() => void>();
export const setPrintBusy = (b: boolean): void => { if (busy === b) return; busy = b; listeners.forEach((l) => l()); };
export const isPrintBusy = (): boolean => busy;
export const usePrintBusy = (): boolean => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, isPrintBusy, isPrintBusy);
