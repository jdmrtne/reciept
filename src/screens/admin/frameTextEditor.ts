import { EVENT_LIMITS, finalText, unsupportedChars } from '../../config/events';
import { EDITABLE_TEXT_FRAMES, frameTextKeys, normalizeFrameText, type FrameTextOverrides } from '../../frames/frameText';
import type { BoothSettings } from '../../config/settings';
import { textLength } from './eventEditor';

/**
 * ADMIN > Frame text editor logic: the same DRAFT + SAVE + unsaved-changes pattern as the event editor (eventEditor.ts). PURE except the
 * small module-level store at the bottom. The draft is the whole `frameText` map as TYPED (not trimmed, not truncated); `null` = no unsaved
 * edits. Nothing reaches settings until SAVE, and an invalid draft is never stored, so no text is silently cut.
 * Draft meaning per line: key absent = built-in text, '' (or blank) = hidden line, anything else = the owner's text.
 */
export type FrameTextDraft = FrameTextOverrides | null;
export { textLength };

export const currentFrameText = (s: BoothSettings, d: FrameTextDraft): FrameTextOverrides => d ?? s.frameText;

const same = (a: FrameTextOverrides, b: FrameTextOverrides): boolean => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((f) => {
    const x = a[f], y = b[f];
    return !!y && Object.keys(x).length === Object.keys(y).length && Object.keys(x).every((k) => x[k] === y[k]);
  });
};
export const isFrameTextDirty = (s: BoothSettings, d: FrameTextDraft): boolean => !!d && !same(d, s.frameText);
/** Does this ONE frame have unsaved edits? (Used to mark it in the frame dropdown.) */
export const isFrameDirty = (s: BoothSettings, d: FrameTextDraft, frameId: string): boolean => !!d && !same({ [frameId]: d[frameId] ?? {} }, { [frameId]: s.frameText[frameId] ?? {} });

/** A line the owner blanked on purpose: stored '' and prints nothing. */
export const isHidden = (v: string | undefined): boolean => v !== undefined && finalText(v) === '';

/** Same wording and rules as the event editor's line check. */
export function checkLine(raw: string): string | undefined {
  const bad = unsupportedChars(raw);
  if (bad.length) return `CANNOT BE PRINTED: ${bad.join(' ')}. REMOVE ${bad.length === 1 ? 'IT' : 'THEM'}`;
  const n = textLength(raw);
  if (n > EVENT_LIMITS.lineMax) return `TOO LONG: ${n} OF ${EVENT_LIMITS.lineMax} CHARACTERS. SHORTEN IT`;
  return undefined;
}
export const errorKey = (frameId: string, key: string) => `${frameId}/${key}`;
export function validateFrameText(t: FrameTextOverrides): Record<string, string> {
  const e: Record<string, string> = {};
  for (const id of EDITABLE_TEXT_FRAMES) for (const k of frameTextKeys(id)) {
    const v = t[id]?.[k], m = v === undefined ? undefined : checkLine(v);
    if (m) e[errorKey(id, k)] = m;
  }
  return e;
}

/** One line changed. `value` undefined = back to the built-in text. Typing back to what is saved makes the draft clean again. */
export function editLine(s: BoothSettings, d: FrameTextDraft, frameId: string, key: string, value: string | undefined): FrameTextDraft {
  const base = currentFrameText(s, d), lines = { ...(base[frameId] ?? {}) };
  if (value === undefined) delete lines[key]; else lines[key] = value;
  const next: FrameTextOverrides = { ...base };
  if (Object.keys(lines).length) next[frameId] = lines; else delete next[frameId];
  return same(next, s.frameText) ? null : next;
}

export type CommitResult = 'saved' | 'failed' | 'invalid' | 'unchanged';
/** SAVE: validate, trim every line, let `mergeSettings` repair it, persist; the draft is dropped only if the write succeeded. */
export function planFrameTextSave(s: BoothSettings, d: FrameTextDraft): { kind: 'saved'; frameText: FrameTextOverrides } | { kind: 'invalid' | 'unchanged' } {
  if (!d || !isFrameTextDirty(s, d)) return { kind: 'unchanged' };
  if (Object.keys(validateFrameText(d)).length) return { kind: 'invalid' };
  const trimmed = Object.fromEntries(Object.entries(d).map(([f, l]) => [f, Object.fromEntries(Object.entries(l).map(([k, v]) => [k, finalText(v)]))]));
  return { kind: 'saved', frameText: normalizeFrameText(trimmed) };
}

let draft: FrameTextDraft = null;
const listeners = new Set<() => void>();
const set = (next: FrameTextDraft) => { if (next !== draft) { draft = next; listeners.forEach((l) => l()); } };

/** Module-level on purpose (like eventEditorStore): the unsaved draft survives the panel re-mounting after the inactivity reset. Memory only. */
export const frameTextEditorStore = {
  get: () => draft,
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  edit: (s: BoothSettings, frameId: string, key: string, value: string | undefined) => set(editLine(s, draft, frameId, key, value)),
  cancel: () => set(null),
  reset: () => set(null),
  commit(s: BoothSettings, persist: (frameText: FrameTextOverrides) => boolean): CommitResult {
    const plan = planFrameTextSave(s, draft);
    if (plan.kind !== 'saved') return plan.kind;
    if (!persist(plan.frameText)) return 'failed';
    set(null);
    return 'saved';
  },
  /** RESET THIS FRAME: saved immediately (after the owner confirmed); other frames' unsaved edits stay in the draft. */
  resetFrame(s: BoothSettings, frameId: string, persist: (frameText: FrameTextOverrides) => boolean): boolean {
    const { [frameId]: _gone, ...saved } = s.frameText;
    void _gone;
    if (!persist(saved)) return false;
    if (draft) { const { [frameId]: _d, ...rest } = draft; void _d; set(same(rest, saved) ? null : rest); }
    return true;
  }
};

let picked: string = EDITABLE_TEXT_FRAMES[0];
const pickListeners = new Set<() => void>();
/**
 * Which frame the ADMIN > Frame text editor and its preview are showing (the dropdown). Module-level so the editor card and the preview card
 * share it. Switching frames never touches the draft: the draft holds every frame's unsaved lines, and one SAVE writes them all.
 */
export const frameTextPick = {
  get: () => picked,
  subscribe(l: () => void) { pickListeners.add(l); return () => { pickListeners.delete(l); }; },
  set(id: string) {
    if (!(EDITABLE_TEXT_FRAMES as readonly string[]).includes(id) || id === picked) return;
    picked = id; pickListeners.forEach((l) => l());
  }
};
