import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import { EVENT_LIMITS, finalText } from '../../config/events';
import { FramePreview } from '../../frames/FrameLayer';
import type { FrameDef } from '../../frames/types';
import { FRAME_TOKENS, defaultLineText, editableFrameDefs, finalFrameText, frameTextKeys, lineLabel } from '../../frames/frameText';
import { currentFrameText, errorKey, frameTextEditorStore, frameTextPanel, isFrameTextDirty, isHidden, textLength, validateFrameText } from './frameTextEditor';
import { ConfirmDialog, Hint, TextField } from './ui';
import type { AdminCtx } from './types';

/**
 * The header/footer wording editor for ONE built-in frame, shown inside ADMIN > Frames right under the tiles when the owner taps that frame
 * (it used to be its own "Frame text" category with a dropdown). Same draft + SAVE pattern as Events: edits to every frame stay in ONE draft
 * until SAVE or CANCEL, so the owner can open several frames, change them, and save once. A customer's stamp captures the text when they
 * start, so a save reaches the NEXT customer only. Works for a frame hidden from guests too (hiding only controls the guest's frame list).
 */
const PREVIEW_LAYOUT = 'strip-3';
const TOKEN_HINT = FRAME_TOKENS.map((t) => `{${t}}`).join(' ');
export const useFrameTextDraft = () => useSyncExternalStore(frameTextEditorStore.subscribe, frameTextEditorStore.get, frameTextEditorStore.get);

/** Which frame is open in the panel (null = none). */
export const useOpenFrame = () => useSyncExternalStore(frameTextPanel.subscribe, frameTextPanel.get, frameTextPanel.get);
/** The frames whose text the owner can edit (the other tiles are not tappable). */
export const isTextEditable = (id: string) => editableFrameDefs().some((f) => f.id === id);

export function FrameTextPanel({ c, frame }: { c: AdminCtx; frame: FrameDef }) {
  const { s, notify, busy } = c;
  const d = useFrameTextDraft(), [ask, setAsk] = useState(false);
  const root = useRef<HTMLElement>(null);
  // Tapping a frame far from the top: bring its editor into view (does nothing where the browser has no scrollIntoView).
  useEffect(() => { root.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [frame.id]);
  const text = currentFrameText(s, d), mine = text[frame.id] ?? {};
  const errors = validateFrameText(text), count = Object.keys(errors).length, dirty = isFrameTextDirty(s, d), bad = count > 0;

  const persist = (ft: Parameters<Parameters<typeof frameTextEditorStore.commit>[1]>[0]) => c.set({ frameText: ft });
  const save = () => {
    const r = frameTextEditorStore.commit(s, persist);
    if (r === 'invalid') notify('error', 'FIX THE MARKED FIELDS BEFORE SAVING');
    else if (r === 'saved') notify('success', 'FRAME TEXT SAVED. THE NEXT CUSTOMER GETS IT');
  };
  const reset = () => { setAsk(false); if (frameTextEditorStore.resetFrame(s, frame.id, persist)) notify('success', `${frame.name.toUpperCase()} TEXT RESET TO THE BUILT-IN WORDING`); };

  return (
    <section ref={root} className="ft-panel" data-ft-panel={frame.id} aria-label={`Text of ${frame.name}`}>
      <div className="ev-bar" role="group" aria-label="Save or cancel frame text">
        <p className={dirty ? 'ev-state dirty' : 'ev-state'} role="status" aria-live="polite">
          <Icon name={dirty ? 'alert' : 'check'} />
          {dirty ? (bad ? `UNSAVED: ${count} ${count === 1 ? 'PROBLEM' : 'PROBLEMS'} TO FIX` : 'UNSAVED CHANGES (ALL FRAMES)') : 'NO UNSAVED CHANGES'}
        </p>
        <button type="button" className="btn ghost" disabled={!dirty || busy} onClick={() => frameTextEditorStore.cancel()}><Icon name="close" />CANCEL</button>
        <button type="button" className="btn" disabled={!dirty || bad || busy} onClick={save}><Icon name="check" />SAVE</button>
      </div>
      <div className="ft-head">
        <p className="ev-edit-of">TEXT OF: <b>{frame.name.toUpperCase()}</b></p>
        <button type="button" className="btn ghost" onClick={() => frameTextPanel.close()} aria-label={`CLOSE TEXT EDITOR OF ${frame.name.toUpperCase()}`}><Icon name="close" />CLOSE</button>
      </div>
      <div className="ft-body">
        <div className="ft-side">
          <div className="ft-prev" aria-label={`Preview of ${frame.name} with your text`}><FramePreview frameId={frame.id} layoutId={PREVIEW_LAYOUT} frameText={finalFrameText(text)} /></div>
          <Hint>Shows your unsaved text. Nothing is printed, saved or sent.</Hint>
        </div>
        <div className="ft-main">
          <div className="ft-lines">
            {frameTextKeys(frame.id).map((key) => {
              const v = mine[key], hidden = isHidden(v), def = defaultLineText(frame.id, key) ?? '';
              return (
                <div className="ft-line" key={`${frame.id}/${key}`} data-line={key}>
                  <TextField label={lineLabel(frame.id, key)} hint={hidden ? 'HIDDEN: nothing prints on this line (an empty saved line is a hidden line).' : 'Empty = built-in text.'} value={v ?? ''}
                    placeholder={hidden ? '(HIDDEN)' : def} counter={`${textLength(v ?? '')}/${EVENT_LIMITS.lineMax}`} error={errors[errorKey(frame.id, key)]}
                    onChange={(nv) => frameTextEditorStore.edit(s, frame.id, key, nv === '' ? undefined : nv)} />
                  <button type="button" className="btn ghost ft-hide" aria-pressed={hidden} aria-label={`${hidden ? 'SHOW' : 'HIDE'} ${lineLabel(frame.id, key)}`}
                    onClick={() => frameTextEditorStore.edit(s, frame.id, key, hidden ? undefined : '')}>{hidden ? 'SHOW LINE' : 'HIDE LINE'}</button>
                </div>
              );
            })}
          </div>
          <Hint>{`Tokens filled in for each customer: ${TOKEN_HINT}. Anything else in braces is not printed. Up to ${EVENT_LIMITS.lineMax} characters; long text shrinks to fit, then is shortened with ...`}</Hint>
          <div className="test-actions">
            <button type="button" className="btn ghost" disabled={busy || !s.frameText[frame.id]} onClick={() => setAsk(true)}><Icon name="reset" />RESET THIS FRAME</button>
          </div>
        </div>
      </div>
      {ask && <ConfirmDialog title="RESET THIS FRAME?" body={`All your wording for "${frame.name}" goes back to the built-in text and hidden lines come back. Saved right away; the next customer gets it.`} confirmLabel="RESET" danger onCancel={() => setAsk(false)} onConfirm={reset} />}
    </section>
  );
}

/** This frame's own built-in phrases (tokens removed), so a search for "make a wish" finds Birthday's wording. */
const phrasesOf = (f: FrameDef) => [...new Set([...f.header.lines, ...f.footer.lines].map((l) => finalText(l.text.replace(/\{[A-Z]+\}/g, ' ')).toLowerCase()).filter((p) => p.length > 2))];

/** Search words for the text editor: every wording term plus each editable frame's built-in phrases. */
export const FRAME_TEXT_KEYWORDS = ['frame text', 'text', 'wording', 'header', 'footer', 'caption', 'title', 'line', 'lines', 'label', 'hide line', 'reset frame', 'tokens', 'default phrases', 'words', 'edit text', 'save', 'cancel',
  ...editableFrameDefs().flatMap((f) => [f.id, ...phrasesOf(f)])];
