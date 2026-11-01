import { useSyncExternalStore } from 'react';
import type { PrinterHealth } from './types';

/**
 * What the app last learned about the printer, shared with the "printer disconnected" popup (screens/PrinterLostPrompt.tsx).
 * `episode` counts how many times the printer went from reachable to offline; the popup shows once per episode, so a guest who taps NOT NOW
 * is not nagged again until the printer has come back and been lost a second time.
 */
export interface LostSnapshot { level: PrinterHealth['level'] | null; episode: number; dismissed: number }

let snap: LostSnapshot = { level: null, episode: 0, dismissed: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Called with every health result (see PrinterManager.onHealth). */
export function reportHealth(h: PrinterHealth): void {
  const wasOffline = snap.level === 'offline', isOffline = h.level === 'offline';
  if (snap.level === h.level) return;
  snap = { ...snap, level: h.level, episode: isOffline && !wasOffline ? snap.episode + 1 : snap.episode };
  emit();
}
export function dismissLost(): void { if (snap.dismissed === snap.episode) return; snap = { ...snap, dismissed: snap.episode }; emit(); }
export const lostSnapshot = (): LostSnapshot => snap;
export const shouldPromptReconnect = (s: LostSnapshot): boolean => s.level === 'offline' && s.episode !== s.dismissed;
export function resetLostStore(): void { snap = { level: null, episode: 0, dismissed: 0 }; emit(); } // tests

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useLostSnapshot = (): LostSnapshot => useSyncExternalStore(subscribe, lostSnapshot, lostSnapshot);
