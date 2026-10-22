import { useEffect } from 'react';

/** Calls onIdle after `seconds` without touch/key/pointer input. Inactive when `enabled` is false. */
export function useInactivity(enabled: boolean, seconds: number, onIdle: () => void) {
  useEffect(() => {
    if (!enabled) return;
    let t = window.setTimeout(onIdle, seconds * 1000);
    const bump = () => {
      window.clearTimeout(t);
      t = window.setTimeout(onIdle, seconds * 1000);
    };
    const evts = ['pointerdown', 'pointermove', 'keydown', 'touchstart'] as const;
    evts.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      window.clearTimeout(t);
      evts.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [enabled, seconds, onIdle]);
}
