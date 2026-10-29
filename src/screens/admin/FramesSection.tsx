import { FramePreview } from '../../frames/FrameLayer';
import { FRAMES, isImageFrame } from '../../frames/registry';
import { hideableFrames, setHidden } from '../../frames/visibility';
import type { FrameDef } from '../../frames/types';
import { Hint, Switch } from './ui';
import { customFramesCard } from './CustomFramesSection';
import type { AdminCtx, SectionDef } from './types';

const POOL = hideableFrames(FRAMES);
const GROUPS: { id: string; title: string; frames: FrameDef[] }[] = [
  { id: 'receipt', title: 'RECEIPT STYLES', frames: POOL.filter((f) => !isImageFrame(f)) },
  { id: 'designs', title: 'DESIGNS', frames: POOL.filter(isImageFrame) }
];
/** One standard layout for every thumbnail, so frames are compared like for like. */
const PREVIEW_LAYOUT = 'strip-3';

function Frames({ s, set }: AdminCtx) {
  const hidden = s.frameVisibility.hidden;
  const shownCount = POOL.filter((f) => !hidden.includes(f.id)).length;
  const apply = (ids: string[], show: boolean) => set({ frameVisibility: { hidden: setHidden(hidden, ids, show) } });
  // The last visible frame cannot be switched off (the booth must offer at least one).
  const locked = (id: string) => shownCount === 1 && !hidden.includes(id);
  return (
    <>
      <Hint>Tap a frame's switch to show or hide it. Choose which frame designs guests can pick in the editor. Hidden frames are only removed from that list; a guest who already has one keeps it. New frames added later appear automatically.</Hint>
      {shownCount === 1 && <Hint>At least one frame must stay shown, so the last one cannot be switched off.</Hint>}
      {GROUPS.map((g) => {
        const ids = g.frames.map((f) => f.id);
        const anyHidden = ids.some((i) => hidden.includes(i));
        const hideNext = setHidden(hidden, ids, false);
        const canHideGroup = ids.some((i) => !hidden.includes(i)) && hideNext.length !== hidden.length; // refused (would hide the last frames) = unchanged
        return (
          <div key={g.id} className="lv-group" data-frame-group={g.id}>
            <div className="lv-head">
              <h5 className="lv-h">{g.title} <small>{g.frames.length}</small></h5>
              <div className="lv-acts">
                <button type="button" className="btn ghost" disabled={!anyHidden} onClick={() => apply(ids, true)} aria-label={`SHOW ALL ${g.title}`}>SHOW ALL</button>
                <button type="button" className="btn ghost" disabled={!canHideGroup} onClick={() => apply(ids, false)} aria-label={`HIDE ALL ${g.title}`}>HIDE ALL</button>
              </div>
            </div>
            <ul className="fg-grid" aria-label={g.title}>
              {g.frames.map((f) => {
                const shown = !hidden.includes(f.id);
                return (
                  <li key={f.id} className="fg-tile" data-shown={shown ? 'true' : 'false'}>
                    <div className="fg-thumb"><FramePreview frameId={f.id} layoutId={PREVIEW_LAYOUT} /></div>
                    <span className="fg-name">{f.name.toUpperCase()}</span>
                    <Switch label={`SHOW FRAME ${f.name.toUpperCase()}`} checked={shown} disabled={locked(f.id)} onChange={(v) => apply([f.id], v)} />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <div className="test-actions">
        <button type="button" className="btn ghost" disabled={hidden.length === 0} onClick={() => set({ frameVisibility: { hidden: [] } })}>SHOW ALL FRAMES</button>
      </div>
    </>
  );
}

export const framesSection: SectionDef = {
  id: 'frames',
  label: 'Frames',
  icon: 'frame',
  description: 'Choose which frame designs customers can pick, and add your own. Event frames are in ADMIN \u203A Events.',
  cards: [
    { id: 'frames-visibility', title: 'Frame designs in the editor', description: 'Switch frames on or off for the frame list guests see.',
      keywords: ['frame', 'frames', 'design', 'designs', 'border', 'template', 'hide', 'show', 'visible', 'choices', 'options', 'receipt styles', 'show all', ...POOL.map((f) => f.name.toLowerCase())],
      render: (c) => <Frames {...c} /> },
    customFramesCard
  ]
};
