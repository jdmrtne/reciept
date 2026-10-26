import { loadSettings } from '../config/settings';
import { sessionStore } from '../state/session';
import { ensureSessionStamp } from '../state/stamp';
import { renderColorPhoto, renderGifVersion, type ShareAsset } from '../share/assets';
import { frameQrForSession } from '../qr/sessionQr';
import { isSideways } from '../render/orient';
import { makeStem, writeOutput, type OutputKind } from './folder';
import { encodeMp4Result } from './mp4';

/**
 * Admin auto-save (ADMIN > Auto-save). Every entry point is fire-and-forget and swallows all errors: capture, GIF generation and printing
 * never wait for it and never fail because of it. Each (customer, kind) is saved at most once: `done` is keyed by the customer's session
 * stamp object (new per customer), marked only after a successful write; `busy` blocks a second save while one is in flight.
 * `stems`: one name stem per customer, so the photo, GIF and video of one session are named alike (.jpg / .gif / .mp4).
 */
export type LastResult = { kind: OutputKind; ok: boolean; at: number; detail: string } | null;
let last: LastResult = null;
const listeners = new Set<() => void>();
export const lastAutoSave = () => last;
export const onAutoSave = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const done = new WeakMap<object, Set<OutputKind>>(), busy = new WeakMap<object, Set<OutputKind>>(), stems = new WeakMap<object, string>();
const enabled = (kind: OutputKind) => { const a = loadSettings().autoSave; return kind === 'image' ? a.images : kind === 'gif' ? a.gifs : a.videos; }; // read live: toggles act immediately
const REASON = {
  unsupported: 'FOLDER ACCESS NOT SUPPORTED', none: 'NO FOLDER CHOSEN', permission: 'FOLDER PERMISSION NEEDED \u2014 RE-GRANT IN ADMIN', empty: 'EMPTY OUTPUT NOT SAVED', error: 'COULD NOT WRITE THE FILE',
  videoUnsupported: 'VIDEO ENCODING NOT SUPPORTED IN THIS BROWSER', videoFailed: 'VIDEO ENCODING FAILED'
} as const;

/** Guarded save of one kind: bytes (or a REASON key when they could not be made) from `make`, written once per customer. Never rejects. */
async function save(kind: OutputKind, session: object | null | undefined, make: () => Promise<Uint8Array | keyof typeof REASON>): Promise<boolean> {
  try {
    if (!session || !enabled(kind)) return false;
    const d = done.get(session) ?? done.set(session, new Set()).get(session)!, b = busy.get(session) ?? busy.set(session, new Set()).get(session)!;
    if (d.has(kind) || b.has(kind)) return false;
    b.add(kind);
    try {
      const stem = stems.get(session) ?? stems.set(session, makeStem()).get(session)!; // taken now, so files saved at the same time still match
      const made = await make();
      const r = typeof made === 'string' ? ({ ok: false, reason: made } as const) : await writeOutput(kind, made, stem);
      if (r.ok) { d.add(kind); stems.set(session, r.stem); } // r.stem differs only if the name was taken and a new suffix was used
      last = { kind, ok: r.ok, at: Date.now(), detail: r.ok ? r.name : REASON[r.reason] };
      listeners.forEach((l) => l());
      return r.ok;
    } finally { b.delete(kind); }
  } catch { return false; }
}

/** Save one finished output (an existing Blob/bytes: nothing is re-generated). Resolves when settled; never rejects. */
export async function autoSaveAsset(kind: OutputKind, session: object | null | undefined, asset: ShareAsset | null | undefined): Promise<boolean> {
  try {
    if (!asset?.bytes?.length) return false;
    return await save(kind, session, async () => asset.bytes);
  } catch { return false; }
}

/**
 * Save the finished GIF as an MP4 (made FROM the GIF bytes, see mp4.ts). Same once-per-customer guard as the other kinds; the encode runs in small
 * async chunks, so call it with `void` right after the GIF exists. Independent of the GIF switch. Unsupported browser or failed encode: LAST SAVE says why.
 */
export async function autoSaveVideoFromGif(session: object | null | undefined, gif: ShareAsset | null | undefined, encode: typeof encodeMp4Result = encodeMp4Result): Promise<boolean> {
  try {
    if (!gif?.bytes?.length) return false;
    return await save('video', session, async () => { const r = await encode(gif.bytes); return r.ok ? r.bytes : r.reason === 'unsupported' ? 'videoUnsupported' : 'videoFailed'; });
  } catch { return false; }
}

/**
 * Used when the QR/share screen is NOT part of the flow (it already produces the files, see ShareScreen): render only what is switched on,
 * once, in the background after a successful print. The GIF is rendered if the GIF OR the video switch is on (the video comes from it).
 */
export function autoSaveSession(): void {
  void (async () => {
    try {
      const st = sessionStore.get(), editor = st.editor;
      if (!editor) return;
      const stamp = ensureSessionStamp(), { paperWidthMm } = loadSettings();
      const qr = isSideways(editor.present.layoutId) ? frameQrForSession() ?? undefined : undefined;
      if (enabled('image')) await renderColorPhoto(editor.present, stamp, paperWidthMm, undefined, undefined, qr).then((r) => autoSaveAsset('image', stamp, r.asset)).catch(() => false);
      if (enabled('gif') || enabled('video')) await renderGifVersion(editor.present, stamp, st.footage, undefined, qr, paperWidthMm).then(async (a) => { await autoSaveAsset('gif', stamp, a); await autoSaveVideoFromGif(stamp, a); }).catch(() => false);
    } catch { /* never interrupts the booth */ }
  })();
}
