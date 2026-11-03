import { historySince, type BuildInfo, type HistoryEntry } from './version';
import type { KeyValue } from './updateSource';

/**
 * "What changed" popup after an update. The booth remembers the build it last showed the owner; when the running build differs,
 * STANDBY shows a popup with the changes of EVERY version since the one it last showed (release-history.txt, compiled into this build), so the owner does not have to open ADMIN.
 * Works for every way an update can land (ADMIN > Install, or the background swap at standby), needs no network, and never appears
 * during a guest because only the standby screen renders it.
 */
export const SEEN_KEY = 'booth.update.seen.v1';

/** `entries`: every version the booth skipped, newest first. Never empty when there is anything to say; empty = no notes were written. */
export interface Announcement { from: string | null; to: string; build: string; entries: HistoryEntry[] }

const safeStore = (): KeyValue | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

/** Identity of a build. A local build has no commit id, so its build time tells builds apart. */
export const buildKey = (b: BuildInfo): string => `${b.version}|${b.build}${b.build === 'local' ? `|${b.builtAt}` : ''}`;

interface Seen { key: string; version: string }

export function readSeen(store: KeyValue | null = safeStore()): Seen | null {
  try {
    const raw = store?.getItem(SEEN_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Seen>;
    return typeof p.key === 'string' && typeof p.version === 'string' ? { key: p.key, version: p.version } : null;
  } catch { return null; }
}

export function recordSeen(b: BuildInfo, store: KeyValue | null = safeStore()): boolean {
  if (!store) return false;
  try { store.setItem(SEEN_KEY, JSON.stringify({ key: buildKey(b), version: b.version })); return true; } catch { return false; }
}

/**
 * The popup to show, or null. The very first run on a device (nothing remembered) is not an update: it just remembers this build.
 * Reading never marks the popup as seen: it stays until the owner dismisses it, even across another restart.
 */
export function pendingAnnouncement(installed: BuildInfo, store: KeyValue | null = safeStore()): Announcement | null {
  if (!store) return null;
  const seen = readSeen(store);
  if (!seen) { recordSeen(installed, store); return null; }
  if (seen.key === buildKey(installed)) return null;
  let entries = historySince(installed.history, seen.version, installed.version);
  const notes = (installed.notes ?? '').trim();
  if (!entries.length && notes) entries = [{ version: installed.version, notes }]; // same version number, new build: nothing in the history, so the build's own notes
  return { from: seen.version, to: installed.version, build: installed.build, entries };
}
