/**
 * Crash recovery policy for the unattended kiosk. A screen that throws is replaced by a short "restarting" card,
 * then the session is wiped back to standby (nothing of the customer survives). If it crashes AGAIN right away,
 * a plain wipe evidently is not enough (corrupt module state, a stuck camera stream), so we reload the page.
 */
export const RELOAD_WINDOW_MS = 15_000;
/** How long the "restarting" card is shown before recovering. */
export const RECOVER_DELAY_MS = 1500;

export function recoveryAction(now: number, lastCrashAt: number | null): 'reset' | 'reload' {
  return lastCrashAt !== null && now - lastCrashAt < RELOAD_WINDOW_MS ? 'reload' : 'reset';
}
