import { useSyncExternalStore } from 'react';
import type { Carry, EditorState } from '../editor/types';
import type { FrameCtx } from '../frames/types';
import type { FootageClip } from '../share/footage';
import type { ShareFile } from '../share/url';

/**
 * The ONE digital result for this customer: a stable id (so revisiting the share screen reuses the same QR and never re-uploads),
 * which files are already stored, and the page URL the QR encodes once it exists. Phase 2 reads `id` / `pageUrl` from here.
 */
export interface ShareSession { id: string; done: ShareFile[]; pageUrl: string | null; ttlMs: number | null }

export type Screen =
  | 'standby' | 'layout' | 'camera' | 'countdown' | 'capture'
  | 'edit' | 'preview' | 'print' | 'share' | 'success' | 'admin';

/** Everything belonging to ONE customer. Never persisted. */
export interface Session {
  id: string;
  screen: Screen;
  photos: string[]; // object URLs — revoked on reset
  footage: FootageClip[]; // the recorded countdown before each photo (paired to a photo by its URL); only feeds the GIF, dropped on reset
  layoutId: string | null;
  frameId: string | null;
  editor: EditorState | null; // objects + undo/redo history (filter lives inside the snapshot)
  stamp: FrameCtx | null; // date/time/serial printed on the frame; fixed when the customer taps start so Edit, Preview and Print agree
  carry: Carry | null; // stickers + filter kept while retaking from the editor
  cameraFacing: 'user' | 'environment';
  share: ShareSession | null; // set when the share screen first runs; wiped with everything else on reset
}

const fresh = (): Session => ({
  id: crypto.randomUUID(),
  screen: 'standby',
  photos: [],
  footage: [],
  layoutId: null,
  frameId: null,
  editor: null,
  stamp: null,
  carry: null,
  cameraFacing: 'user',
  share: null
});

let state: Session = fresh();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const sessionStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  update(patch: Partial<Session>) {
    state = { ...state, ...patch };
    emit();
  },
  go(screen: Screen) {
    sessionStore.update({ screen });
  },
  /** Wipes every trace of the current customer and returns to standby. */
  reset() {
    state.photos.forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u));
    state = fresh();
    emit();
  }
};

export const useSession = () =>
  useSyncExternalStore(sessionStore.subscribe, sessionStore.get);
