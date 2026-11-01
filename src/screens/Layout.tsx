import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { loadSettings } from '../config/settings';
import { applyOrder } from '../config/order';
import { guestLayouts } from '../layouts/visibility';
import { allLayouts } from '../layouts/registry';
import { eventGroupName } from '../frames/custom/eventLayouts';
import { eventLayoutOfferedFor, eventLayoutVersion, subscribeEventLayouts } from '../frames/custom/eventRuntime';
import { pickerEntries, photoCount, photoCountLabel, type LayoutGroup } from '../layouts/groups';
import { frameForLayoutVisible } from '../frames/visibility';
import { FramePreview } from '../frames/FrameLayer';
import { sessionStore, useSession } from '../state/session';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';

/**
 * Layouts sharing a `group` become ONE featured card + modal, listed FIRST; ordinary layouts follow as cards. Layouts the owner hid in ADMIN, event layouts switched off
 * (their own flag) and event layouts of any event that is NOT the active one are filtered out BEFORE grouping, so a group with nothing left disappears.
 * Group = event; its name is the event's name.
 */
const entriesFor = (hidden: readonly string[], events: readonly { id: string; name: string }[], activeEventId: string, order: readonly string[]) =>
  pickerEntries(guestLayouts(applyOrder(allLayouts((id) => eventGroupName(id, events), events.map((e) => e.id)), order), hidden, eventLayoutOfferedFor(activeEventId)));

/** Under the EVENT SPECIAL badge when the group has no event name (its event was deleted). */
const GROUP_FALLBACK = 'SPECIAL LAYOUTS';

const choose = (layoutId: string, hiddenFrames: readonly string[], frameOrder: readonly string[]) =>
  sessionStore.update({ layoutId, frameId: frameForLayoutVisible(layoutId, sessionStore.get().frameId, hiddenFrames, undefined, frameOrder), screen: 'camera' });

export function Layout() {
  const { layoutId } = useSession();
  // Read once per mount: the picker is mounted each time a guest reaches it, so ADMIN changes apply without a reload.
  const [{ hiddenLayouts, hiddenFrames, layoutOrder, frameOrder, events, activeEventId }] = useState(() => { const st = loadSettings(); return { hiddenLayouts: st.layoutVisibility.hidden, hiddenFrames: st.frameVisibility.hidden, layoutOrder: st.layoutOrder, frameOrder: st.frameOrder, events: st.events, activeEventId: st.activeEventId }; });
  // Event layouts load in the background after start: the cards follow the runtime, so a guest never sees a picker that is missing them for good.
  const evVersion = useSyncExternalStore(subscribeEventLayouts, eventLayoutVersion, eventLayoutVersion);
  const ENTRIES = useMemo(() => entriesFor(hiddenLayouts, events, activeEventId, layoutOrder), [hiddenLayouts, events, activeEventId, layoutOrder, evVersion]);
  // Thumbnails show the frame the guest would actually get (the first visible one when the default frame is hidden).
  const previewFrame = (id: string) => frameForLayoutVisible(id, null, hiddenFrames, undefined, frameOrder);
  // Local state on purpose: a session wipe remounts this screen (App key={session id}), which closes the modal with it.
  const [openGroup, setOpenGroup] = useState<LayoutGroup | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setOpenGroup(null), []);

  return (
    <main className="lay">
      <h2>CHOOSE YOUR STRIP</h2>
      <div className="lay-grid">
        {ENTRIES.map((e) => e.kind === 'layout' ? (
          <button key={e.layout.id} className="lay-card" onClick={() => choose(e.layout.id, hiddenFrames, frameOrder)}>
            <FramePreview frameId={previewFrame(e.layout.id)} layoutId={e.layout.id} qr />
            <span>{e.layout.name.toUpperCase()}</span>
          </button>
        ) : (
          <button
            key={e.group.id}
            className={`lay-card lay-group lay-feature${e.group.layouts.some((l) => l.id === layoutId) ? ' on' : ''}`}
            aria-haspopup="dialog"
            aria-current={e.group.layouts.some((l) => l.id === layoutId) || undefined}
            data-group={e.group.id}
            onClick={(ev) => { opener.current = ev.currentTarget; setOpenGroup(e.group); }}
          >
            <em className="lay-badge" aria-hidden="true">★ EVENT SPECIAL</em>
            <div className="lay-stack">
              <div className="lay-stack-in">
                <FramePreview frameId={previewFrame(e.group.layouts[0].id)} layoutId={e.group.layouts[0].id} qr />
              </div>
            </div>
            <span>{e.group.name || GROUP_FALLBACK}</span>
            <small className="lay-sub">{e.group.layouts.length} LAYOUTS · TAP TO OPEN</small>
          </button>
        ))}
      </div>
      <button className="btn ghost" onClick={() => sessionStore.reset()}><Icon name="close" />CANCEL</button>

      {openGroup && (
        <Modal label={openGroup.name || GROUP_FALLBACK} onClose={close} returnFocusRef={opener}>
          <div className="modal-grid">
            {openGroup.layouts.map((l) => (
              <button key={l.id} className={`lay-card${l.id === layoutId ? ' on' : ''}`} aria-current={l.id === layoutId || undefined} onClick={() => { choose(l.id, hiddenFrames, frameOrder); close(); }}>
                <FramePreview frameId={previewFrame(l.id)} layoutId={l.id} qr />
                <span>{l.name.toUpperCase()}</span>
                <small className="lay-sub">{photoCountLabel(photoCount(l))}</small>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </main>
  );
}
