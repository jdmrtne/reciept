import { useEffect } from 'react';

/**
 * Keeps the tablet screen on while the booth is open (a kiosk that dozes off mid-guest is a dead kiosk).
 * Best-effort: unsupported browsers, denied requests and battery-saver refusals are ignored. The browser drops the
 * lock whenever the tab is hidden, so it is re-requested each time the page becomes visible again.
 * Belt and braces: the owner should still set the tablet's own screen timeout to "never" (docs/OWNER-GUIDE.md).
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || sentinel || document.visibilityState !== 'visible') return;
      try {
        const s = await navigator.wakeLock.request('screen');
        if (cancelled) return void s.release().catch(() => {});
        sentinel = s;
        s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
      } catch {
        /* denied or unavailable right now — the next visibilitychange tries again */
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire(); };

    document.addEventListener('visibilitychange', onVisible);
    void acquire();
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      const s = sentinel;
      sentinel = null;
      void s?.release().catch(() => {});
    };
  }, []);
}
