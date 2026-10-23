import { useState, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import { EVENT_LIMITS, finalText } from '../../config/events';
import { FramePreview } from '../../frames/FrameLayer';
import type { FrameDef } from '../../frames/types';
import { FRAME_TOKENS, defaultLineText, editableFrameDefs, finalFrameText, frameTextKeys, lineLabel } from '../../frames/frameText';
import { currentFrameText, errorKey, frameTextEditorStore, isFrameTextDirty, isHidden, textLength, validateFrameText } from './frameTextEditor';
import { ConfirmDialog, Hint, TextField } from './ui';
import type { AdminCtx, SectionDef } from './types';

/**
 * ADMIN "Frame text" (owner only, behind the PIN like every section): the header/footer wording inside the nine built-in receipt/ticket frames.
 * Same draft + SAVE pattern as Events. A customer's stamp captures the text when they start, so a save reaches the NEXT customer only.
 * Works for every editable frame, also one hidden in ADMIN > Frames (that only controls the guest's frame list).
 */
const PREVIEW_LAYOUT = 'strip-3';
const TOKEN_HINT = FRAME_TOKENS.map((t) => `{${t}}`).join(' ');
const useDraft = () => useSyncExternalStore(frameTextEditorStore.subscribe, frameTextEditorStore.get, frameTextEditorStore.get);

function FrameTextCard({ frameId, c }: { frameId: string; c: AdminCtx }) {
  const { s, notify, busy } = c;
  const d = useDraft(), [ask, setAsk] = useState(false);
  const f = editableFrameDefs().find((x) => x.id === frameId)!;
  const text = currentFrameText(s, d), mine = text[frameId] ?? {};
  const errors = validateFrameText(text), count = Object.keys(errors).length, dirty = isFrameTextDirty(s, d), bad = count > 0;

  const persist = (ft: Parameters<Parameters<typeof frameTextEditorStore.commit>[1]>[0]) => c.set({ frameText: ft });
  const save = () => {
    const r = frameTextEditorStore.commit(s, persist);
    if (r === 'invalid') notify('error', 'FIX THE MARKED FIELDS BEFORE SAVING');
    else if (r === 'saved') notify('success', 'FRAME TEXT SAVED. THE NEXT CUSTOMER GETS IT');
  };
  const reset = () => { setAsk(false); if (frameTextEditorStore.resetFrame(s, frameId, persist)) notify('success', `${f.name.toUpperCase()} TEXT RESET TO THE BUILT-IN WORDING`); };

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
      <div className="ft-card">
        <div className="ft-prev" aria-label={`Preview of ${f.name} with your text`}><FramePreview frameId={frameId} layoutId={PREVIEW_LAYOUT} frameText={finalFrameText(text)} /></div>
        <div className="ft-lines">
          {frameTextKeys(frameId).map((key) => {
            const v = mine[key], hidden = isHidden(v), def = defaultLineText(frameId, key) ?? '';
            return (
              <div className="ft-line" key={key} data-line={key}>
                <TextField label={lineLabel(frameId, key)} hint={hidden ? 'HIDDEN: nothing prints on this line (an empty saved line is a hidden line).' : 'Empty = built-in text.'} value={v ?? ''}
                  placeholder={hidden ? '(HIDDEN)' : def} counter={`${textLength(v ?? '')}/${EVENT_LIMITS.lineMax}`} error={errors[errorKey(frameId, key)]}
                  onChange={(nv) => frameTextEditorStore.edit(s, frameId, key, nv === '' ? undefined : nv)} />
                <button type="button" className="btn ghost ft-hide" aria-pressed={hidden} aria-label={`${hidden ? 'SHOW' : 'HIDE'} ${lineLabel(frameId, key)}`}
                  onClick={() => frameTextEditorStore.edit(s, frameId, key, hidden ? undefined : '')}>{hidden ? 'SHOW LINE' : 'HIDE LINE'}</button>
              </div>
            );
          })}
        </div>
      </div>
      <Hint>{`Tokens filled in for each customer: ${TOKEN_HINT}. Anything else in braces is not printed. Up to ${EVENT_LIMITS.lineMax} characters; long text shrinks to fit, then is shortened with ...`}</Hint>
      <div className="test-actions">
        <button type="button" className="btn ghost" disabled={busy || !s.frameText[frameId]} onClick={() => setAsk(true)}><Icon name="reset" />RESET THIS FRAME</button>
      </div>
      {ask && <ConfirmDialog title="RESET THIS FRAME?" body={`All your wording for "${f.name}" goes back to the built-in text and hidden lines come back. Saved right away; the next customer gets it.`} confirmLabel="RESET" danger onCancel={() => setAsk(false)} onConfirm={reset} />}
    </>
  );
}

/** This frame's own built-in phrases (tokens removed), so a search for "make a wish" finds Birthday only. */
const phrasesOf = (f: FrameDef) => [...new Set([...f.header.lines, ...f.footer.lines].map((l) => finalText(l.text.replace(/\{[A-Z]+\}/g, ' ')).toLowerCase()).filter((p) => p.length > 2))];

export const frameTextSection: SectionDef = {
  id: 'frameText',
  label: 'Frame text',
  icon: 'frame',
  description: 'Change the wording printed inside the built-in frames (header and footer text).',
  cards: editableFrameDefs().map((f) => ({
    id: `frametext-${f.id}`,
    title: f.name,
    description: 'Header and footer wording. Saved only when you press SAVE; reaches the next customer.',
    keywords: ['frame text', 'text', 'wording', 'header', 'footer', 'caption', 'title', 'line', 'lines', 'label', 'hide line', 'reset frame', 'tokens', 'default phrases', 'words', 'edit text', f.name.toLowerCase(), f.id, ...phrasesOf(f)],
    render: (c: AdminCtx) => <FrameTextCard frameId={f.id} c={c} />
  }))
};
