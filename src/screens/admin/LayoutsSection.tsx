import { FramePreview } from '../../frames/FrameLayer';
import { DEFAULT_FRAME, frameForLayout } from '../../frames/registry';
import { pickerEntries, photoCount, photoCountLabel } from '../../layouts/groups';
import { LAYOUTS } from '../../layouts/registry';
import { setHidden, visibleLayouts } from '../../layouts/visibility';
import type { LayoutDef } from '../../layouts/types';
import { Hint } from './ui';
import type { AdminCtx, SectionDef } from './types';

/** Same order the guest picker uses: the event special group first, then the ordinary layouts. */
const ENTRIES = pickerEntries(LAYOUTS);

function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <i aria-hidden="true" /><b>{checked ? 'SHOWN' : 'HIDDEN'}</b>
    </button>
  );
}

const Thumb = ({ l }: { l: LayoutDef }) => (
  <div className="lv-thumb"><FramePreview frameId={frameForLayout(l.id, DEFAULT_FRAME)} layoutId={l.id} qr /></div>
);

function Layouts({ s, set }: AdminCtx) {
  const hidden = s.layoutVisibility.hidden;
  const shownCount = visibleLayouts(LAYOUTS, hidden).length;
  const apply = (ids: string[], show: boolean) => set({ layoutVisibility: { hidden: setHidden(hidden, ids, show) } });
  // The last visible layout cannot be switched off (the booth must offer at least one).
  const locked = (id: string) => shownCount === 1 && !hidden.includes(id);
  return (
    <>
      <Hint>Choose which layouts guests see on CHOOSE YOUR STRIP. Hidden layouts are only removed from that screen; nothing else changes. New layouts added later appear automatically.</Hint>
      {shownCount === 1 && <Hint>At least one layout must stay shown, so the last one cannot be switched off.</Hint>}
      <ul className="lv-list">
        {ENTRIES.map((e) => e.kind === 'layout' ? (
          <li key={e.layout.id} className="lv-row">
            <Thumb l={e.layout} />
            <div className="row-l"><span>{e.layout.name.toUpperCase()}</span><small>{photoCountLabel(photoCount(e.layout))}</small></div>
            <Switch label={`SHOW ${e.layout.name.toUpperCase()}`} checked={!hidden.includes(e.layout.id)} disabled={locked(e.layout.id)} onChange={(v) => apply([e.layout.id], v)} />
          </li>
        ) : (
          <li key={e.group.id} className="lv-group">
            <div className="lv-row lv-parent">
              <Thumb l={e.group.layouts[0]} />
              <div className="row-l"><span>{e.group.name.toUpperCase()}</span><small>WHOLE GROUP · {e.group.layouts.length} LAYOUTS</small></div>
              <Switch label={`SHOW WHOLE GROUP ${e.group.name.toUpperCase()}`} checked={e.group.layouts.every((l) => !hidden.includes(l.id))}
                disabled={e.group.layouts.every((l) => !hidden.includes(l.id)) && shownCount === e.group.layouts.length}
                onChange={(v) => apply(e.group.layouts.map((l) => l.id), v)} />
            </div>
            <ul className="lv-kids">
              {e.group.layouts.map((l) => (
                <li key={l.id} className="lv-row">
                  <Thumb l={l} />
                  <div className="row-l"><span>{l.name.toUpperCase()}</span><small>{photoCountLabel(photoCount(l))}</small></div>
                  <Switch label={`SHOW ${l.name.toUpperCase()}`} checked={!hidden.includes(l.id)} disabled={locked(l.id)} onChange={(v) => apply([l.id], v)} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="test-actions">
        <button type="button" className="btn ghost" disabled={hidden.length === 0} onClick={() => set({ layoutVisibility: { hidden: [] } })}>SHOW ALL</button>
      </div>
    </>
  );
}

export const layoutsSection: SectionDef = {
  id: 'layouts',
  label: 'Layouts',
  icon: 'layout',
  description: 'Choose which strip layouts customers can pick.',
  cards: [
    { id: 'layouts-visibility', title: 'Layouts on the picker', description: 'Switch layouts on or off for CHOOSE YOUR STRIP.',
      keywords: ['layout', 'layouts', 'strip', 'choose your strip', 'picker', 'hide', 'show', 'visible', 'single', 'two strip', 'three strip', 'four strip', '2 x 2', 'classic', 'jlc', 'special', 'ncl', 'pass', 'boarding pass', 'group', 'choices', 'options', 'frame layouts', 'show all'],
      render: (c) => <Layouts {...c} /> }
  ]
};
