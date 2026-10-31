import { useState, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import { EVENT_LIMITS, finalText } from '../../config/events';
import { FramePreview } from '../../frames/FrameLayer';
import type { FrameDef } from '../../frames/types';
import { FRAME_TOKENS, defaultLineText, editableFrameDefs, finalFrameText, frameTextKeys, lineLabel } from '../../frames/frameText';
import { currentFrameText, errorKey, frameTextEditorStore, frameTextPick, isFrameDirty, isFrameTextDirty, isHidden, textLength, validateFrameText } from './frameTextEditor';
import { ConfirmDialog, Hint, TextField } from './ui';
import type { AdminCtx, SectionDef } from './types';

/**
 * ADMIN "Frame text" (owner only, behind the PIN like every section): the header/footer wording inside the nine built-in receipt/ticket frames.
 * Laid out like Events: ONE editor with a frame dropdown (only the chosen frame's lines are shown, not nine long lists) and a live preview
 * of that frame in the side column. Same draft + SAVE pattern as Events. A customer's stamp captures the text when they start, so a save
 * reaches the NEXT customer only. Works for every editable frame, also one hidden in ADMIN > Frames (that only controls the guest's frame list).
 */
const PREVIEW_LAYOUT = 'strip-3';
const TOKEN_HINT = FRAME_TOKENS.map((t) => `{${t}}`).join(' ');
const useDraft = () => useSyncExternalStore(frameTextEditorStore.subscribe, frameTextEditorStore.get, frameTextEditorStore.get);
const usePick = () => useSyncExternalStore(frameTextPick.subscribe, frameTextPick.get, frameTextPick.get);

function FrameTextEditor({ c }: { c: AdminCtx }) {
  const { s, notify, busy } = c;
  const d = useDraft(), frameId = usePick(), [ask, setAsk] = useState(false);
  const frames = editableFrameDefs();
  const f = frames.find((x) => x.id === frameId) ?? frames[0];
  const text = currentFrameText(s, d), mine = text[f.id] ?? {};
  const errors = validateFrameText(text), count = Object.keys(errors).length, dirty = isFrameTextDirty(s, d), bad = count > 0;

  const persist = (ft: Parameters<Parameters<typeof frameTextEditorStore.commit>[1]>[0]) => c.set({ frameText: ft });
  const save = () => {
    const r = frameTextEditorStore.commit(s, persist);
    if (r === 'invalid') notify('error', 'FIX THE MARKED FIELDS BEFORE SAVING');
    else if (r === 'saved') notify('success', 'FRAME TEXT SAVED. THE NEXT CUSTOMER GETS IT');
  };
  const reset = () => { setAsk(false); if (frameTextEditorStore.resetFrame(s, f.id, persist)) notify('success', `${f.name.toUpperCase()} TEXT RESET TO THE BUILT-IN WORDING`); };
  const badIn = (id: string) => Object.keys(errors).some((k) => k.startsWith(`${id}/`));

  return (
    <>
      <div className="ev-bar" role="group" aria-label="Save or cancel frame text">
        <p className={dirty ? 'ev-state dirty' : 'ev-state'} role="status" aria-live="polite">
          <Icon name={dirty ? 'alert' : 'check'} />
          {dirty ? (bad ? `UNSAVED: ${count} ${count === 1 ? 'PROBLEM' : 'PROBLEMS'} TO FIX` : 'UNSAVED CHANGES') : 'NO UNSAVED CHANGES'}
        </p>
        <button type="button" className="btn ghost" disabled={!dirty || busy} onClick={() => frameTextEditorStore.cancel()}><Icon name="close" />CANCEL</button>
        <button type="button" className="btn" disabled={!dirty || bad || busy} onClick={save}><Icon name="check" />SAVE</button>
      </div>
      <label className="field">
        <span className="field-top"><span className="field-l">FRAME TO EDIT</span></span>
        <select className="adm-in" value={f.id} onChange={(e) => frameTextPick.set(e.target.value)}>
          {frames.map((x) => <option key={x.id} value={x.id}>{x.name}{badIn(x.id) ? ' (FIX)' : isFrameDirty(s, d, x.id) ? ' (UNSAVED)' : ''}</option>)}
        </select>
        <small className="field-h">Pick a frame, then change its header and footer lines. Edits to other frames are kept until you press SAVE or CANCEL.</small>
      </label>
      <p className="ev-edit-of">EDITING: <b>{f.name.toUpperCase()}</b></p>
      <div className="ft-lines">
        {frameTextKeys(f.id).map((key) => {
          const v = mine[key], hidden = isHidden(v), def = defaultLineText(f.id, key) ?? '';
          return (
            <div className="ft-line" key={`${f.id}/${key}`} data-line={key}>
              <TextField label={lineLabel(f.id, key)} hint={hidden ? 'HIDDEN: nothing prints on this line (an empty saved line is a hidden line).' : 'Empty = built-in text.'} value={v ?? ''}
                placeholder={hidden ? '(HIDDEN)' : def} counter={`${textLength(v ?? '')}/${EVENT_LIMITS.lineMax}`} error={errors[errorKey(f.id, key)]}
                onChange={(nv) => frameTextEditorStore.edit(s, f.id, key, nv === '' ? undefined : nv)} />
              <button type="button" className="btn ghost ft-hide" aria-pressed={hidden} aria-label={`${hidden ? 'SHOW' : 'HIDE'} ${lineLabel(f.id, key)}`}
                onClick={() => frameTextEditorStore.edit(s, f.id, key, hidden ? undefined : '')}>{hidden ? 'SHOW LINE' : 'HIDE LINE'}</button>
            </div>
          );
        })}
      </div>
      <Hint>{`Tokens filled in for each customer: ${TOKEN_HINT}. Anything else in braces is not printed. Up to ${EVENT_LIMITS.lineMax} characters; long text shrinks to fit, then is shortened with ...`}</Hint>
      <div className="test-actions">
        <button type="button" className="btn ghost" disabled={busy || !s.frameText[f.id]} onClick={() => setAsk(true)}><Icon name="reset" />RESET THIS FRAME</button>
      </div>
      {ask && <ConfirmDialog title="RESET THIS FRAME?" body={`All your wording for "${f.name}" goes back to the built-in text and hidden lines come back. Saved right away; the next customer gets it.`} confirmLabel="RESET" danger onCancel={() => setAsk(false)} onConfirm={reset} />}
    </>
  );
}

/** Live preview of the frame chosen in the editor, with the unsaved text. Nothing is printed, saved or sent. */
function FrameTextPreview({ c }: { c: AdminCtx }) {
  const d = useDraft(), frameId = usePick();
  const f = editableFrameDefs().find((x) => x.id === frameId) ?? editableFrameDefs()[0];
  const text = currentFrameText(c.s, d);
  return (
    <>
      <p className="ev-edit-of">PREVIEW: <b>{f.name.toUpperCase()}</b></p>
      <div className="ft-prev" aria-label={`Preview of ${f.name} with your text`}><FramePreview frameId={f.id} layoutId={PREVIEW_LAYOUT} frameText={finalFrameText(text)} /></div>
      <Hint>Shows your unsaved text. Nothing is printed, saved or sent.</Hint>
    </>
  );
}

/** This frame's own built-in phrases (tokens removed), so a search for "make a wish" finds Birthday's wording. */
const phrasesOf = (f: FrameDef) => [...new Set([...f.header.lines, ...f.footer.lines].map((l) => finalText(l.text.replace(/\{[A-Z]+\}/g, ' ')).toLowerCase()).filter((p) => p.length > 2))];

export const frameTextSection: SectionDef = {
  id: 'frameText',
  label: 'Frame text',
  icon: 'frame',
  description: 'Change the wording printed inside the built-in frames (header and footer text).',
  tabs: [{ id: 'editor', label: 'Text Editor', draft: 'frameText' }],
  cards: [
    {
      id: 'frametext-edit', tab: 'editor',
      title: 'Frame text',
      description: 'Pick a frame, then edit its header and footer wording. Saved only when you press SAVE; reaches the next customer.',
      keywords: ['frame text', 'text', 'wording', 'header', 'footer', 'caption', 'title', 'line', 'lines', 'label', 'hide line', 'reset frame', 'tokens', 'default phrases', 'words', 'edit text', 'save', 'cancel',
        ...editableFrameDefs().flatMap((f) => [f.name.toLowerCase(), f.id, ...phrasesOf(f)])],
      render: (c: AdminCtx) => <FrameTextEditor c={c} />
    },
    { id: 'frametext-preview', tab: 'editor', title: 'Frame preview', description: '', aside: true, keywords: ['preview', 'frame preview', 'sample', 'look'], render: (c: AdminCtx) => <FrameTextPreview c={c} /> }
  ]
};
