import { loadSettings } from '../config/settings';
import { getShareStore, makeSessionId } from '../share/backend';
import { makePageQr, qrBase } from '../share/service';
import { normalizePublicBase, resolvePageBase } from '../share/url';
import { sessionStore } from '../state/session';
import { QrPlacementError } from './placement';
import type { PlanQr } from '../render/plan';

/**
 * The QR that goes ON the printed frame: the same `<site>/p/<sessionId>` QR the share screen shows later, built from the
 * same session id (created here if the share screen has not made one yet, and reused by the share screen afterwards, so
 * the printed QR and the stored files always carry the same id). Null = sharing is off or not configured: nothing is printed.
 */
export function frameQrForSession(): PlanQr | null {
  const s = loadSettings();
  if (!s.share.enabled) return null;
  const store = getShareStore();
  const base = qrBase({ store: store ?? undefined, publicBase: normalizePublicBase(s.share.publicBaseUrl), pageBase: resolvePageBase({ cloud: !!store, publicBaseUrl: s.share.publicBaseUrl, origin: location.origin }) });
  if (!base) return null;
  let share = sessionStore.get().share;
  if (!share) { share = { id: makeSessionId(), done: [], pageUrl: null, ttlMs: null }; sessionStore.update({ share }); }
  const r = makePageQr(base, share.id);
  return r.ok ? { matrix: r.matrix } : null;
}

/** Customer-facing text when the QR cannot be placed without covering the design (the export is blocked, never forced). */
export const qrErrorText = (e: unknown): string | null =>
  e instanceof QrPlacementError ? 'Could not place the QR code on this design without covering it. Pick another frame or layout, or ask the owner.' : null;
