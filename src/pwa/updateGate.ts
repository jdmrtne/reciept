import { sessionStore } from '../state/session';

/**
 * PWA update safety. `registerType: 'prompt'` in vite.config.ts means a new service worker installs in the
 * background and WAITS — it never activates itself. `registerSW`'s `onNeedRefresh` calls `arm(apply)` here with
 * the function that activates it (`updateSW(true)`, which SKIP_WAITINGs the new worker and reloads this tab).
 *
 * We never call that mid-customer: swapping the app out from under someone in EDIT or PRINT would drop their
 * session and could cancel a print in flight. Instead we apply the moment the kiosk is next idle at STANDBY —
 * no photos, nothing to lose, and the reload is invisible before the next guest taps to start. If an update is
 * already pending when this loads (e.g. we boot straight to standby with nothing yet armed), the STANDBY watcher
 * below fires as soon as `arm` supplies it.
 */
let apply: (() => void) | null = null;
let unsubscribe: (() => void) | null = null;

function tryApply() {
  if (apply && sessionStore.get().screen === 'standby') {
    const fn = apply;
    apply = null;
    unsubscribe?.();
    unsubscribe = null;
    fn();
  }
}

/** Called by `onNeedRefresh` once a new version has finished downloading and is ready to take over. */
export function armUpdate(applyFn: () => void): void {
  apply = applyFn;
  if (!unsubscribe) unsubscribe = sessionStore.subscribe(tryApply);
  tryApply(); // covers "already standing at standby when the update finishes downloading"
}
