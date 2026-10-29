import {
  EVENT_LIMITS,
  finalText,
  finalizeEventProfile,
  normalizeEventProfile,
  unsupportedChars,
  type EventProfile,
  type EventProfileInput
} from '../../config/events';
import { updateEventProfile, type BoothSettings } from '../../config/settings';

/**
 * EP-3 event editor logic. PURE (no React, no DOM, no storage) except the tiny `eventEditorStore` at the bottom.
 *
 * Why a separate DRAFT: every other ADMIN setting saves the moment it changes. Event text must not: editing the ACTIVE event while a
 * customer could be starting would change their receipt halfway through typing. So the form edits a draft, nothing is stored until the
 * owner presses SAVE, and CANCEL throws the draft away. The saved profile (in `BoothSettings.events`) stays the single source of truth;
 * there is no second event store.
 *
 * The draft keeps what the owner TYPED, untouched (no trimming, no truncating). Problems are reported by `validateDraft` and block SAVE,
 * so nothing is ever silently cut or dropped; the stored profile equals what was shown on screen (apart from edge spaces and blank
 * detail lines, which carry no information).
 */

export interface EventDraft {
  name: string;
  header: string;
  /** Always exactly `EVENT_LIMITS.detailLines` entries so the form always shows the same inputs. */
  details: string[];
  thankYou: string;
  brandingEnabled: boolean;
  brandingText: string;
}

export type FieldKey = 'name' | 'header' | 'detail0' | 'detail1' | 'detail2' | 'thankYou' | 'brandingText';
export type FieldErrors = Partial<Record<FieldKey, string>>;

const pad = (details: readonly string[]): string[] => Array.from({ length: EVENT_LIMITS.detailLines }, (_, i) => details[i] ?? '');

/** The form's starting point for a saved profile. */
export function draftFromProfile(p: EventProfile): EventDraft {
  return { name: p.name, header: p.header, details: pad(p.details), thankYou: p.thankYou, brandingEnabled: p.brandingEnabled, brandingText: p.brandingText };
}

export const draftsEqual = (a: EventDraft, b: EventDraft): boolean =>
  a.name === b.name && a.header === b.header && a.thankYou === b.thankYou && a.brandingEnabled === b.brandingEnabled && a.brandingText === b.brandingText &&
  a.details.length === b.details.length && a.details.every((d, i) => d === b.details[i]);

/** Number of characters that count toward the limit: the trimmed text (edge spaces are not saved). */
export const textLength = (raw: string): number => finalText(raw, Infinity).length;

export function checkLine(raw: string, required = false): string | undefined {
  if (required && !raw.trim()) return 'REQUIRED';
  const bad = unsupportedChars(raw);
  if (bad.length) return `CANNOT BE PRINTED: ${bad.join(' ')} \u2014 REMOVE ${bad.length === 1 ? 'IT' : 'THEM'}`;
  const n = textLength(raw);
  if (n > EVENT_LIMITS.lineMax) return `TOO LONG: ${n} OF ${EVENT_LIMITS.lineMax} CHARACTERS \u2014 SHORTEN IT`;
  return undefined;
}

/** Every problem that would stop SAVE, per field. Empty object = valid. Optional fields may be empty. */
export function validateDraft(d: EventDraft): FieldErrors {
  const e: FieldErrors = {};
  const put = (k: FieldKey, v: string | undefined) => { if (v) e[k] = v; };
  put('name', checkLine(d.name, true) === 'REQUIRED' ? 'EVENT NAME IS REQUIRED' : checkLine(d.name, true));
  put('header', checkLine(d.header));
  d.details.forEach((l, i) => put(`detail${i}` as FieldKey, checkLine(l)));
  put('thankYou', checkLine(d.thankYou));
  put('brandingText', checkLine(d.brandingText));
  return e;
}

export const hasErrors = (e: FieldErrors): boolean => Object.keys(e).length > 0;

/**
 * What gets stored for a VALID draft: trimmed text, blank detail lines removed (the others move up), nothing else changed.
 * (An invalid draft is never stored; for the preview use `draftPreviewProfile`.)
 */
export function draftToInput(d: EventDraft): EventProfileInput {
  return {
    name: finalText(d.name),
    header: finalText(d.header),
    details: d.details.map((l) => finalText(l)).filter(Boolean),
    thankYou: finalText(d.thankYou),
    brandingEnabled: d.brandingEnabled,
    brandingText: finalText(d.brandingText)
  };
}

/** FINAL-level profile for the live preview: exactly what the receipt would read, even while the draft still has problems. */
export function draftPreviewProfile(d: EventDraft, id: string): EventProfile {
  return finalizeEventProfile(normalizeEventProfile(draftToInput(d), id));
}

// ---------------------------------------------------------------- selection + draft state

export interface EditorState {
  /** Profile the owner is looking at (null = follow the active profile). */
  selectedId: string | null;
  /** Unsaved edits, only while they differ from the saved profile. */
  edit: { id: string; draft: EventDraft } | null;
}
export const EMPTY_EDITOR: EditorState = { selectedId: null, edit: null };

/** The profile being edited: the selected one if it still exists, else the active one, else the first. Never undefined (settings always hold one). */
export function selectedProfile(s: BoothSettings, st: EditorState): EventProfile {
  return s.events.find((e) => e.id === st.selectedId) ?? s.events.find((e) => e.id === s.activeEventId) ?? s.events[0];
}

/** What the form shows right now: the unsaved draft if there is one for the selected profile, otherwise the saved values. */
export function currentDraft(s: BoothSettings, st: EditorState): EventDraft {
  const p = selectedProfile(s, st);
  return st.edit && st.edit.id === p.id ? st.edit.draft : draftFromProfile(p);
}

export const isDirty = (s: BoothSettings, st: EditorState): boolean => {
  const p = selectedProfile(s, st);
  return !!st.edit && st.edit.id === p.id && !draftsEqual(st.edit.draft, draftFromProfile(p));
};

/** Applies one field change. Typing back to the saved value makes the draft clean again. */
export function editField(s: BoothSettings, st: EditorState, patch: Partial<Omit<EventDraft, 'details'>> & { detail?: { index: number; value: string } }): EditorState {
  const p = selectedProfile(s, st), cur = currentDraft(s, st);
  const { detail, ...rest } = patch;
  const next: EventDraft = { ...cur, ...rest, details: detail ? cur.details.map((l, i) => (i === detail.index ? detail.value : l)) : cur.details };
  return { selectedId: p.id, edit: draftsEqual(next, draftFromProfile(p)) ? null : { id: p.id, draft: next } };
}

/** Switch to another profile. The caller is responsible for asking about unsaved edits first; this always drops them. */
export const selectProfile = (id: string): EditorState => ({ selectedId: id, edit: null });
/** CANCEL: back to the saved values of the same profile. */
export const cancelEdits = (st: EditorState): EditorState => ({ ...st, edit: null });

/** Forget anything that points at a profile that no longer exists (deleted, or storage changed). */
export function reconcile(s: BoothSettings, st: EditorState): EditorState {
  const ids = new Set(s.events.map((e) => e.id));
  const selectedId = st.selectedId && ids.has(st.selectedId) ? st.selectedId : null;
  const edit = st.edit && ids.has(st.edit.id) ? st.edit : null;
  return selectedId === st.selectedId && edit === st.edit ? st : { selectedId, edit };
}

// ---------------------------------------------------------------- save

export type SavePlan =
  | { kind: 'saved'; settings: BoothSettings; id: string }
  | { kind: 'invalid'; errors: FieldErrors }
  | { kind: 'unchanged' };

/**
 * The explicit SAVE. Pure: validates the draft and computes the next settings; the caller persists them (through the panel's
 * `set`, which uses `saveSettings`) and only then clears the draft, so a failed write leaves the owner's text on screen.
 * Pressing SAVE twice is harmless: the second time there is nothing left to save ('unchanged').
 * Saving never changes `activeEventId`.
 */
export function planSave(s: BoothSettings, st: EditorState): SavePlan {
  if (!isDirty(s, st)) return { kind: 'unchanged' };
  const draft = currentDraft(s, st), errors = validateDraft(draft);
  if (hasErrors(errors)) return { kind: 'invalid', errors };
  const id = selectedProfile(s, st).id;
  return { kind: 'saved', settings: updateEventProfile(s, id, draftToInput(draft)), id };
}

// ---------------------------------------------------------------- store

/**
 * Module-level on purpose, like `sessionStore`: the unsaved draft survives the panel being re-mounted (the inactivity reset sends the
 * owner back to standby and the PIN keypad), so a pause while typing a long detail line does not lose the text. It is memory only:
 * it never reaches storage, and a page reload drops it. SAVE, CANCEL and an explicit DISCARD clear it.
 */
let state: EditorState = EMPTY_EDITOR;
const listeners = new Set<() => void>();
const set = (next: EditorState) => { if (next !== state) { state = next; listeners.forEach((l) => l()); } };

export type CommitResult = 'saved' | 'failed' | 'invalid' | 'unchanged';

/**
 * SAVE as the form performs it: plan, PERSIST, and only if the write succeeded drop the draft. A refused write ('failed') leaves the
 * owner's text on screen and still marked unsaved. `persist` is the panel's `set` (saveSettings underneath) and returns false on failure.
 */
export function commitSave(s: BoothSettings, persist: (next: BoothSettings) => boolean): CommitResult {
  const plan = planSave(s, state);
  if (plan.kind !== 'saved') return plan.kind;
  if (!persist(plan.settings)) return 'failed';
  set(cancelEdits(state));
  return 'saved';
}

export const eventEditorStore = {
  get: () => state,
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  edit: (s: BoothSettings, patch: Parameters<typeof editField>[2]) => set(editField(s, state, patch)),
  select: (id: string) => set(selectProfile(id)),
  cancel: () => set(cancelEdits(state)),
  reconcile: (s: BoothSettings) => set(reconcile(s, state)),
  /** Forget everything (tests, and DISCARD when leaving). */
  reset: () => set(EMPTY_EDITOR)
};
