import { loadSettings } from '../config/settings';
import { sessionStore } from '../state/session';
import { ensureSessionStamp } from '../state/stamp';
import { renderColorPhoto, renderGifVersion, type ShareAsset } from '../share/assets';
import { frameQrForSession } from '../qr/sessionQr';
import { isSideways } from '../render/orient';
import { writeOutput, type OutputKind } from './folder';

/**
 * Admin auto-save (ADMIN > Auto-save). Every entry point is fire-and-forget and swallows all errors: capture, GIF generation and printing
 * never wait for it and never fail because of it. Each (customer, kind) is saved at most once: `done` is keyed by the customer's session
 * stamp object (new per customer), marked only after a successful write; `busy` blocks a second save while one is in flight.
 */
export type LastResult = { kind: OutputKind; ok: boolean; at: number; detail: string } | null;
let last: LastResult = null;
const listeners = new Set<() => void>();
export const lastAutoSave = () => last;
export const onAutoSave = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const done = new WeakMap<object, Set<OutputKind>>(), busy = new WeakMap<object, Set<OutputKind>>();
const enabled = (kind: OutputKind) => { const a = loadSettings().autoSave; return kind === 'image' ? a.images : a.gifs; }; // read live: toggles act immediately
const REASON = { unsupported: 'FOLDER ACCESS NOT SUPPORTED', none: 'NO FOLDER CHOSEN', permission: 'FOLDER PERMISSION NEEDED \u2014 RE-GRANT IN ADMIN', empty: 'EMPTY OUTPUT NOT SAVED', error: 'COULD NOT WRITE THE FILE' } as const;

/** Save one finished output (an existing Blob/bytes: nothing is re-generated). Resolves when settled; never rejects. */
export async function autoSaveAsset(kind: OutputKind, session: object | null | undefined, asset: ShareAsset | null | undefined): Promise<boolean> {
  try {
    if (!session || !asset || !asset.bytes?.length || !enabled(kind)) return false;
    const d = done.get(session) ?? done.set(session, new Set()).get(session)!, b = busy.get(session) ?? busy.set(session, new Set()).get(session)!;
    if (d.has(kind) || b.has(kind)) return false;
    b.add(kind);
    try {
      const r = await writeOutput(kind, asset.bytes);
      if (r.ok) d.add(kind);
      last = { kind, ok: r.ok, at: Date.now(), detail: r.ok ? r.name : REASON[r.reason] };
      listeners.forEach((l) => l());
      return r.ok;
    } finally { b.delete(kind); }
  } catch { return false; }
}

/**
 * Used when the QR/share screen is NOT part of the flow (it already produces both files, see ShareScreen): render only what is switched on,
 * once, in the background after a successful print.
 */
export function autoSaveSession(): void {
  void (async () => {
    try {
      const st = sessionStore.get(), editor = st.editor;
      if (!editor) return;
      const stamp = ensureSessionStamp(), { paperWidthMm } = loadSettings();
      const qr = isSideways(editor.present.layoutId) ? frameQrForSession() ?? undefined : undefined;
      if (enabled('image')) await renderColorPhoto(editor.present, stamp, paperWidthMm, undefined, undefined, qr).then((r) => autoSaveAsset('image', stamp, r.asset)).catch(() => false);
      if (enabled('gif')) await renderGifVersion(editor.present, stamp, st.footage, undefined, qr).then((a) => autoSaveAsset('gif', stamp, a)).catch(() => false);
    } catch { /* never interrupts the booth */ }
  })();
}
