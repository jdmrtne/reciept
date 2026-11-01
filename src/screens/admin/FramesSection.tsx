import { FramePreview } from '../../frames/FrameLayer';
import { FRAMES, isImageFrame } from '../../frames/registry';
import { hideableFrames, setHidden } from '../../frames/visibility';
import type { FrameDef } from '../../frames/types';
import { applyOrder, mergeGroupOrder } from '../../config/order';
import { Hint, Switch } from './ui';
import { DragHandle, useSortable } from './Sortable';
import { customFramesCard } from './CustomFramesSection';
import type { AdminCtx, SectionDef } from './types';

const POOL = hideableFrames(FRAMES);
const GROUPS: { id: string; title: string; frames: FrameDef[] }[] = [
  { id: 'receipt', title: 'RECEIPT STYLES', frames: POOL.filter((f) => !isImageFrame(f)) },
  { id: 'designs', title: 'DESIGNS', frames: POOL.filter(isImageFrame) }
];
/** One standard layout for every thumbnail, so frames are compared like for like. */
const PREVIEW_LAYOUT = 'strip-3';

interface TilesProps {
  title: string; frames: FrameDef[]; s: AdminCtx['s']; set: AdminCtx['set'];
  hidden: string[]; locked: (id: string) => boolean; apply: (ids: string[], show: boolean) => void;
}

/** One group's tiles, draggable into a new order. The saved order is ONE list for all frames; dragging inside a group only re-orders that group's own places in it. */
function FrameTiles({ title, frames, s, set, hidden, locked, apply }: TilesProps) {
  const fullIds = applyOrder(POOL, s.frameOrder).map((f) => f.id);
  const mine = new Set(frames.map((f) => f.id));
  const sort = useSortable(fullIds.filter((id) => mine.has(id)), (next) => set({ frameOrder: mergeGroupOrder(fullIds, next) }));
  return (
    <ul className="fg-grid" aria-label={title}>
      {sort.order.map((id) => {
        const f = frames.find((x) => x.id === id);
        if (!f) return null;
        const shown = !hidden.includes(f.id);
        return (
          <li key={f.id} ref={sort.itemRef(f.id)} className={`fg-tile${sort.draggingId === f.id ? ' is-dragging' : ''}`} data-shown={shown ? 'true' : 'false'} data-frame-id={f.id}>
            <DragHandle {...sort.handle(f.id, f.name.toUpperCase())} />
            <div className="fg-thumb"><FramePreview frameId={f.id} layoutId={PREVIEW_LAYOUT} /></div>
            <span className="fg-name">{f.name.toUpperCase()}</span>
            <Switch label={`SHOW FRAME ${f.name.toUpperCase()}`} checked={shown} disabled={locked(f.id)} onChange={(v) => apply([f.id], v)} />
          </li>
        );
      })}
    </ul>
  );
}

function Frames({ s, set }: AdminCtx) {
  const hidden = s.frameVisibility.hidden;
  const shownCount = POOL.filter((f) => !hidden.includes(f.id)).length;
  const apply = (ids: string[], show: boolean) => set({ frameVisibility: { hidden: setHidden(hidden, ids, show) } });
  // The last visible frame cannot be switched off (the booth must offer at least one).
  const locked = (id: string) => shownCount === 1 && !hidden.includes(id);
  return (
    <>
      <Hint>Switch a frame off to hide it from guests. A guest who already picked it keeps it. Hold the dotted grip on a tile and drag it to change where it appears in the frame tray (or focus the grip and use the arrow keys).</Hint>
      {shownCount === 1 && <Hint important>At least one frame must stay shown, so the last one cannot be switched off.</Hint>}
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
            <FrameTiles title={g.title} frames={g.frames} s={s} set={set} hidden={hidden} locked={locked} apply={apply} />
          </div>
        );
      })}
      <div className="test-actions">
        <button type="button" className="btn ghost" disabled={hidden.length === 0} onClick={() => set({ frameVisibility: { hidden: [] } })}>SHOW ALL FRAMES</button>
        <button type="button" className="btn ghost" disabled={s.frameOrder.length === 0} onClick={() => set({ frameOrder: [] })}>RESET ORDER</button>
      </div>
    </>
  );
}

export const framesSection: SectionDef = {
  id: 'frames',
  label: 'Frames',
  icon: 'frame',
  description: 'Choose which frame designs customers can pick, and add your own. Event frames are in ADMIN \u203A Events.',
  tabs: [{ id: 'builtin', label: 'Built-in Frames' }, { id: 'custom', label: 'Custom Frames' }],
  cards: [
    { id: 'frames-visibility', tab: 'builtin', title: 'Frame designs in the editor', description: '',
      keywords: ['frame', 'frames', 'design', 'designs', 'border', 'template', 'hide', 'show', 'visible', 'choices', 'options', 'receipt styles', 'show all', 'order', 'arrange', 'rearrange', 'drag', 'move', 'position', 'sort', 'reorder', 'reset order', ...POOL.map((f) => f.name.toLowerCase())],
      render: (c) => <Frames {...c} /> },
    customFramesCard
  ]
};
