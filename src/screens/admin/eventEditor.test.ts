import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beforeAll as __infoOn, afterAll as __infoOff } from 'vitest';
import { infoBlock as __infoBlock } from '../../render/info';
// These suites exercise the receipt info block, which is switched OFF in the app (render/info.ts infoBlock): turn it on for this file only.
__infoOn(() => { __infoBlock.on = true; });
__infoOff(() => { __infoBlock.on = false; });
import {
  addEventProfile,
  getActiveEvent,
  loadSettings,
  mergeSettings,
  saveSettings,
  setActiveEvent,
  updateEventProfile,
  type BoothSettings
} from '../../config/settings';
import { DEFAULT_BRANDING_TEXT, EVENT_LIMITS } from '../../config/events';
import { buildPlan } from '../../render/plan';
import { buildSnapshot } from '../../editor/model';
import { makeEventCtx } from '../../frames/prims';
import {
  EMPTY_EDITOR,
  cancelEdits,
  commitSave,
  currentDraft,
  draftFromProfile,
  draftPreviewProfile,
  draftToInput,
  editField,
  eventEditorStore,
  hasErrors,
  isDirty,
  planSave,
  reconcile,
  selectProfile,
  selectedProfile,
  textLength,
  validateDraft,
  type EditorState
} from './eventEditor';

const KEY = 'booth.settings.v1';
function fakeStorage(opts: { failSet?: boolean } = {}) {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => (data.has(k) ? data.get(k)! : null), setItem: (k: string, v: string) => { if (opts.failSet) throw new Error('quota'); data.set(k, String(v)); }, removeItem: (k: string) => void data.delete(k), clear: () => data.clear() };
}
let store: ReturnType<typeof fakeStorage>;
const install = (s = fakeStorage()) => { store = s; vi.stubGlobal('localStorage', s); return s; };
beforeEach(() => { install(); eventEditorStore.reset(); });
afterEach(() => { vi.unstubAllGlobals(); eventEditorStore.reset(); });

const base = (): BoothSettings => {
  let s = mergeSettings({});
  s = updateEventProfile(s, 'event-1', { name: 'WEDDING', header: 'RECEPTION', details: ['BALLROOM'], thankYou: 'MERCI' });
  s = addEventProfile(s, { name: 'BIRTHDAY' }, false);
  return s; // event-1 active
};
const typed = (s: BoothSettings, st: EditorState, patch: Parameters<typeof editField>[2]) => editField(s, st, patch);

describe('draft', () => {
  it('always shows the same number of detail inputs', () => {
    expect(draftFromProfile(mergeSettings({}).events[0]).details).toHaveLength(EVENT_LIMITS.detailLines);
    expect(draftFromProfile(base().events[0]).details).toEqual(['BALLROOM', '', '']);
  });
  it('follows the active profile until another one is selected', () => {
    const s = base();
    expect(selectedProfile(s, EMPTY_EDITOR).id).toBe('event-1');
    expect(selectedProfile(s, selectProfile('event-2')).id).toBe('event-2');
    expect(selectedProfile(s, selectProfile('gone')).id).toBe('event-1'); // a stale selection falls back to the active event
  });
});

describe('validation', () => {
  const draft = (o: Partial<ReturnType<typeof draftFromProfile>> = {}) => ({ ...draftFromProfile(base().events[0]), ...o });
  it('a normal draft is valid', () => expect(validateDraft(draft())).toEqual({}));
  it('the event name is required (blank and whitespace-only both fail)', () => {
    expect(validateDraft(draft({ name: '' })).name).toBe('EVENT NAME IS REQUIRED');
    expect(validateDraft(draft({ name: '    ' })).name).toBe('EVENT NAME IS REQUIRED');
  });
  it('every optional field may be empty', () => {
    expect(validateDraft(draft({ header: '', details: ['', '', ''], thankYou: '', brandingText: '' }))).toEqual({});
    expect(validateDraft(draft({ brandingEnabled: false, brandingText: '' }))).toEqual({});
  });
  it('the limit is exactly the central lineMax, per field', () => {
    const ok = 'A'.repeat(EVENT_LIMITS.lineMax), long = 'A'.repeat(EVENT_LIMITS.lineMax + 1);
    expect(validateDraft(draft({ name: ok, header: ok, thankYou: ok, brandingText: ok, details: [ok, ok, ok] }))).toEqual({});
    const e = validateDraft(draft({ name: long, header: long, thankYou: long, brandingText: long, details: [long, 'x', long] }));
    expect(Object.keys(e).sort()).toEqual(['brandingText', 'detail0', 'detail2', 'header', 'name', 'thankYou']);
    expect(e.name).toContain(`${EVENT_LIMITS.lineMax + 1} OF ${EVENT_LIMITS.lineMax}`);
  });
  it('edge spaces do not count toward the limit (they are not saved)', () => {
    expect(textLength('  abc  ')).toBe(3);
    expect(validateDraft(draft({ name: ' ' + 'A'.repeat(EVENT_LIMITS.lineMax) + ' ' }))).toEqual({});
  });
  it('characters the receipt cannot print are named, not silently removed', () => {
    const e = validateDraft(draft({ name: 'PARTY \u{1F389}', header: 'A\u200BB' }));
    expect(e.name).toContain('\u{1F389}');
    expect(e.header).toContain('U+200B');
    expect(hasErrors(e)).toBe(true);
  });
  it('accented and typographic text is fine', () => expect(validateDraft(draft({ name: 'FIESTA DE LA NI\u00D1A \u2014 \u20AC5' }))).toEqual({}));
});

describe('typing never truncates or cleans', () => {
  it('a 100-character paste stays exactly as typed in the draft and blocks SAVE', () => {
    const s = base(), long = 'W'.repeat(100);
    const st = typed(s, EMPTY_EDITOR, { name: long });
    expect(currentDraft(s, st).name).toBe(long);
    expect(planSave(s, st)).toMatchObject({ kind: 'invalid' });
    eventEditorStore.edit(s, { name: long }); // the same through the store the form uses
    expect(currentDraft(s, eventEditorStore.get()).name).toBe(long);
    expect(commitSave(s, () => { throw new Error('must not persist'); })).toBe('invalid');
    expect(currentDraft(s, eventEditorStore.get()).name).toBe(long); // still there after the refused SAVE
  });
  it('spaces and emoji stay in the draft while the owner is typing', () => {
    const s = base(), st = typed(s, EMPTY_EDITOR, { header: 'HELLO  \u{1F600} ' });
    expect(currentDraft(s, st).header).toBe('HELLO  \u{1F600} ');
  });
});

describe('dirty state', () => {
  it('is clean until something differs from the saved profile, and clean again when typed back', () => {
    const s = base();
    expect(isDirty(s, EMPTY_EDITOR)).toBe(false);
    const a = typed(s, EMPTY_EDITOR, { name: 'WEDDING 2' });
    expect(isDirty(s, a)).toBe(true);
    const b = typed(s, a, { name: 'WEDDING' });
    expect(isDirty(s, b)).toBe(false);
    expect(b.edit).toBeNull();
  });
  it('detail lines and the branding switch count as changes', () => {
    const s = base();
    expect(isDirty(s, typed(s, EMPTY_EDITOR, { detail: { index: 1, value: 'TABLE 4' } }))).toBe(true);
    expect(isDirty(s, typed(s, EMPTY_EDITOR, { brandingEnabled: false }))).toBe(true);
  });
  it('an edit belongs to ONE profile: selecting another drops it, and it never shows on the other', () => {
    const s = base();
    const a = typed(s, EMPTY_EDITOR, { name: 'CHANGED' });
    const b = selectProfile('event-2');
    expect(isDirty(s, b)).toBe(false);
    expect(currentDraft(s, b).name).toBe('BIRTHDAY');
    expect(isDirty(s, { selectedId: 'event-2', edit: a.edit })).toBe(false); // a stale edit for another profile is ignored
  });
  it('CANCEL returns to the saved values and keeps the selection', () => {
    const s = base(), a = typed(s, selectProfile('event-2'), { name: 'X' });
    const c = cancelEdits(a);
    expect(c.selectedId).toBe('event-2');
    expect(currentDraft(s, c).name).toBe('BIRTHDAY');
    expect(isDirty(s, c)).toBe(false);
  });
});

describe('planSave: explicit SAVE, nothing before it', () => {
  it('editing does not change the settings object or storage', () => {
    const s = base();
    saveSettings(s);
    const before = store.data.get(KEY);
    const snapshot = JSON.stringify(s);
    eventEditorStore.edit(s, { name: 'CHANGED', header: 'NEW' });
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(store.data.get(KEY)).toBe(before);
    expect(getActiveEvent(loadSettings()).name).toBe('WEDDING'); // what a customer would get is still the saved text
  });
  it('saves the draft into that profile only, trimmed, with blank detail lines dropped, and never changes the active event', () => {
    const s = base();
    let st = typed(s, selectProfile('event-2'), { name: '  PARTY  ' });
    st = typed(s, st, { detail: { index: 0, value: '' } });
    st = typed(s, st, { detail: { index: 1, value: ' ROOM 5 ' } });
    st = typed(s, st, { thankYou: '' });
    const plan = planSave(s, st);
    expect(plan.kind).toBe('saved');
    if (plan.kind !== 'saved') return;
    expect(plan.id).toBe('event-2');
    expect(plan.settings.events[1]).toMatchObject({ id: 'event-2', name: 'PARTY', details: ['ROOM 5'], thankYou: '' });
    expect(plan.settings.events[0]).toEqual(s.events[0]);
    expect(plan.settings.activeEventId).toBe('event-1');
  });
  it('does not mutate its input', () => {
    const s = base(), copy = JSON.parse(JSON.stringify(s));
    planSave(s, typed(s, EMPTY_EDITOR, { name: 'X' }));
    expect(s).toEqual(copy);
  });
  it('an invalid draft is refused with the errors, a clean one is "unchanged"', () => {
    const s = base();
    expect(planSave(s, EMPTY_EDITOR)).toEqual({ kind: 'unchanged' });
    const bad = planSave(s, typed(s, EMPTY_EDITOR, { name: '' }));
    expect(bad).toMatchObject({ kind: 'invalid' });
  });
  it('pressing SAVE twice is harmless: the second press has nothing left to save', () => {
    const s = base();
    const st = typed(s, EMPTY_EDITOR, { name: 'ONCE' });
    const first = planSave(s, st);
    expect(first.kind).toBe('saved');
    if (first.kind !== 'saved') return;
    expect(planSave(first.settings, cancelEdits(st))).toEqual({ kind: 'unchanged' });
  });
  it('renaming keeps the stable id, and two events with the same name stay separate', () => {
    let s = base();
    s = addEventProfile(s, { name: 'BIRTHDAY' }, false);
    const plan = planSave(s, typed(s, selectProfile('event-3'), { header: 'THIRD' }));
    expect(plan.kind).toBe('saved');
    if (plan.kind !== 'saved') return;
    expect(plan.settings.events.map((e) => [e.id, e.name, e.header])).toEqual([['event-1', 'WEDDING', 'RECEPTION'], ['event-2', 'BIRTHDAY', ''], ['event-3', 'BIRTHDAY', 'THIRD']]);
  });
});

describe('commitSave through the store (what the SAVE button runs)', () => {
  const persist = (next: BoothSettings) => saveSettings(next);
  it('saves, persists, then clears the draft; a reload shows the new text', () => {
    const s = base();
    saveSettings(s);
    eventEditorStore.edit(s, { name: 'NEW NAME' });
    expect(commitSave(s, persist)).toBe('saved');
    expect(isDirty(s, eventEditorStore.get())).toBe(false);
    expect(getActiveEvent(loadSettings()).name).toBe('NEW NAME');
  });
  it('a refused write keeps the draft and reports failure (the owner never loses the text)', () => {
    const s = base();
    eventEditorStore.edit(s, { name: 'KEEP ME' });
    install(fakeStorage({ failSet: true }));
    expect(commitSave(s, persist)).toBe('failed');
    expect(currentDraft(s, eventEditorStore.get()).name).toBe('KEEP ME');
    expect(isDirty(s, eventEditorStore.get())).toBe(true);
  });
  it('an invalid draft never reaches storage', () => {
    const s = base();
    saveSettings(s);
    const before = store.data.get(KEY);
    eventEditorStore.edit(s, { name: 'W'.repeat(60) });
    expect(commitSave(s, persist)).toBe('invalid');
    expect(store.data.get(KEY)).toBe(before);
  });
  it('a second SAVE after a successful one does not write again', () => {
    const s = base();
    eventEditorStore.edit(s, { header: 'ONCE' });
    const calls = vi.fn(persist);
    expect(commitSave(s, calls)).toBe('saved');
    expect(commitSave(mergeSettings(JSON.parse(store.data.get(KEY)!)), calls)).toBe('unchanged');
    expect(calls).toHaveBeenCalledTimes(1);
  });
  it('CANCEL discards the draft and writes nothing', () => {
    const s = base();
    saveSettings(s);
    const before = store.data.get(KEY);
    eventEditorStore.edit(s, { name: 'NOPE' });
    eventEditorStore.cancel();
    expect(isDirty(s, eventEditorStore.get())).toBe(false);
    expect(store.data.get(KEY)).toBe(before);
  });
});

describe('selection and cleanup', () => {
  it('selecting another profile drops the open edit', () => {
    const s = base();
    eventEditorStore.edit(s, { name: 'X' });
    eventEditorStore.select('event-2');
    expect(eventEditorStore.get().edit).toBeNull();
    expect(selectedProfile(s, eventEditorStore.get()).id).toBe('event-2');
  });
  it('reconcile forgets a selection or draft whose profile was deleted', () => {
    const s = base();
    const st: EditorState = { selectedId: 'event-2', edit: { id: 'event-2', draft: draftFromProfile(s.events[1]) } };
    const gone = { ...s, events: [s.events[0]] };
    expect(reconcile(gone, st)).toEqual({ selectedId: null, edit: null });
    expect(reconcile(s, st)).toBe(st); // unchanged input returns the same object (no needless re-render)
  });
  it('the store notifies subscribers and stops after unsubscribe', () => {
    const s = base(), seen = vi.fn(), off = eventEditorStore.subscribe(seen);
    eventEditorStore.edit(s, { name: 'A' });
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    eventEditorStore.edit(s, { name: 'B' });
    expect(seen).toHaveBeenCalledTimes(1);
  });
  it('switching the ACTIVE event is independent of any draft (it only changes the saved selection)', () => {
    const s = base();
    eventEditorStore.edit(s, { name: 'DRAFT ONLY' });
    const next = setActiveEvent(s, 'event-2');
    expect(next.activeEventId).toBe('event-2');
    expect(currentDraft(next, eventEditorStore.get()).name).toBe('DRAFT ONLY'); // the open draft still belongs to event-1
    expect(isDirty(next, eventEditorStore.get())).toBe(true);
  });
});

describe('preview profile and stored input', () => {
  it('the preview reads FINAL text even while the draft is invalid', () => {
    const s = base();
    const st = typed(s, EMPTY_EDITOR, { name: '  ', header: 'A\u{1F600}B', brandingText: '' });
    const p = draftPreviewProfile(currentDraft(s, st), 'event-1');
    expect(p.name).toBe('PHOTOBOOTH');
    expect(p.header).toBe('AB');
    expect(p.brandingText).toBe(DEFAULT_BRANDING_TEXT);
  });
  it('draftToInput trims and compacts, nothing more', () => {
    const d = { ...draftFromProfile(base().events[0]), name: ' X ', details: ['', ' A ', ''] };
    expect(draftToInput(d)).toMatchObject({ name: 'X', details: ['A'] });
  });
});

describe('preview: the real EP-2 plan, fed by the UNSAVED draft', () => {
  const lines = (s: BoothSettings, frame = 'kawaii') => {
    const d = currentDraft(s, eventEditorStore.get()), id = selectedProfileId(s);
    const ctx = makeEventCtx(draftPreviewProfile(d, id), new Date(2026, 9, 12, 19, 30));
    return buildPlan(buildSnapshot('single', [{ src: 'a', iw: 1600, ih: 900 }], frame), ctx, 384).cmds.flatMap((c) => (c.op === 'info' ? c.lines.map((l) => l.text) : []));
  };
  const selectedProfileId = (s: BoothSettings) => selectedProfile(s, eventEditorStore.get()).id;

  it('shows the saved text when nothing is changed', () => {
    expect(lines(base())).toEqual(expect.arrayContaining(['WEDDING', 'RECEPTION', 'BALLROOM', 'MERCI']));
  });
  it('shows what is being typed, before it is saved, and persists nothing', () => {
    const s = base();
    saveSettings(s);
    const stored = store.data.get(KEY);
    eventEditorStore.edit(s, { name: 'TYPING NOW', header: 'LIVE HEADER', thankYou: '' });
    const l = lines(s);
    expect(l).toEqual(expect.arrayContaining(['TYPING NOW', 'LIVE HEADER']));
    expect(l).not.toContain('WEDDING');
    expect(l).not.toContain('MERCI');
    expect(store.data.get(KEY)).toBe(stored);
    expect(getActiveEvent(loadSettings()).name).toBe('WEDDING');
  });
  it('follows the selected profile, not the active one', () => {
    const s = base();
    eventEditorStore.select('event-2');
    expect(lines(s)).toContain('BIRTHDAY');
    expect(lines(s)).not.toContain('WEDDING');
  });
  it('shows branding only when it is switched on in the draft', () => {
    const s = base();
    expect(lines(s)).toContain(DEFAULT_BRANDING_TEXT);
    eventEditorStore.edit(s, { brandingEnabled: false });
    expect(lines(s)).not.toContain(DEFAULT_BRANDING_TEXT);
  });
});
