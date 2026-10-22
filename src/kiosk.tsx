import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { sessionStore } from './state/session';
import { isAdminPath } from './config/route';
import { armUpdate } from './pwa/updateGate';

/** The booth itself (everything that used to run at the top of main.tsx). Kept out of the phone-side result page's bundle. */
export function bootKiosk() {
  // New version ready in the background → wait for standby (updateGate) before taking over. A failed background
  // fetch (offline, or the very first visit with no connectivity yet) is expected and not worth surfacing.
  const updateSW = registerSW({ immediate: true, onNeedRefresh: () => armUpdate(() => updateSW(true)) });

  // Best-effort: asks the browser not to evict this kiosk's offline cache/localStorage under storage pressure.
  // Safe to ignore if unsupported or denied — the app still works, it just loses "persisted" priority.
  if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {});
  // Owner shortcut: opening /admin goes straight to the PIN keypad. Every other URL boots to standby as always.
  if (isAdminPath(location.pathname)) sessionStore.go('admin');
  // Kiosk hygiene: no context menu, no pinch-zoom of the page itself.
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
}
