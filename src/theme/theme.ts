import { useSyncExternalStore } from 'react';

/**
 * Light / Dark / System theme.
 *
 * - The choice is stored on its own (`booth.theme.v1`, a plain string) rather than inside BoothSettings: it has to be readable
 *   synchronously before first paint (see the inline script in index.html), and it must not touch the settings schema.
 * - `data-theme` on <html> drives the CSS tokens in styles/tokens.css. `color-scheme` follows it, so native controls,
 *   scrollbars and the select pop-up match.
 * - Default is LIGHT so a booth that is already deployed looks exactly as it did until the owner opts in.
 *   Change DEFAULT_THEME_PREF to 'system' to follow the device instead.
 */
export type ThemePref = 'light' | 'dark' | 'system';
export type ThemeName = 'light' | 'dark';
export interface ThemeState { pref: ThemePref; resolved: ThemeName }

/** NOTE: index.html's inline pre-paint script repeats this key and these colours. theme.test.ts fails if they drift. */
export const THEME_KEY = 'booth.theme.v1';
export const DEFAULT_THEME_PREF: ThemePref = 'light';
export const THEME_PREFS: readonly ThemePref[] = ['light', 'dark', 'system'];
/** Browser UI colour (address bar / status bar) per theme. Equals --bg. */
export const THEME_COLOR: Record<ThemeName, string> = { light: '#ffffff', dark: '#14171c' };

export const parseThemePref = (v: unknown): ThemePref => (v === 'light' || v === 'dark' || v === 'system' ? v : DEFAULT_THEME_PREF);
export const resolveTheme = (pref: ThemePref, systemDark: boolean): ThemeName => (pref === 'system' ? (systemDark ? 'dark' : 'light') : pref);

type KV = Pick<Storage, 'getItem' | 'setItem'>;
const browserStorage = (): KV | undefined => { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } };

export function loadThemePref(storage: KV | undefined = browserStorage()): ThemePref {
  try { return parseThemePref(storage?.getItem(THEME_KEY)); } catch { return DEFAULT_THEME_PREF; }
}
/** Returns false when the choice could not be stored (it still applies until the page is closed). */
export function saveThemePref(pref: ThemePref, storage: KV | undefined = browserStorage()): boolean {
  try { if (!storage) return false; storage.setItem(THEME_KEY, pref); return true; } catch { return false; }
}

// ---------- runtime store (one per page) ----------
let state: ThemeState = { pref: DEFAULT_THEME_PREF, resolved: 'light' };
let systemDark = false;
let started = false;
const listeners = new Set<() => void>();

function commit(pref: ThemePref) {
  const resolved = resolveTheme(pref, systemDark);
  if (state.pref !== pref || state.resolved !== resolved) { state = { pref, resolved }; listeners.forEach((l) => l()); }
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved]);
}

/** Call once at startup (main.tsx). Safe to call again. Starts following the OS setting and other tabs. */
export function initTheme(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
  systemDark = !!mq?.matches;
  const onSystem = () => { systemDark = !!mq?.matches; commit(state.pref); };
  if (mq?.addEventListener) mq.addEventListener('change', onSystem); else mq?.addListener?.(onSystem);
  // another tab (or the owner on /admin in a second window) changed it
  window.addEventListener('storage', (e) => { if (e.key === THEME_KEY) commit(parseThemePref(e.newValue)); });
  commit(loadThemePref());
}

export function getThemeState(): ThemeState { return state; }
export function subscribeTheme(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** Applies immediately and remembers the choice. Returns false if it could not be remembered. */
export function setThemePref(pref: ThemePref): boolean {
  const saved = saveThemePref(pref);
  commit(pref);
  return saved;
}

export function useTheme(): ThemeState & { setPref: (p: ThemePref) => boolean } {
  const s = useSyncExternalStore(subscribeTheme, getThemeState, getThemeState);
  return { ...s, setPref: setThemePref };
}
