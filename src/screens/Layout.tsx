import { useCallback, useRef, useState } from 'react';
import { loadSettings } from '../config/settings';
import { visibleLayouts } from '../layouts/visibility';
import { LAYOUTS } from '../layouts/registry';
import { pickerEntries, photoCount, photoCountLabel, type LayoutGroup } from '../layouts/groups';
import { frameForLayoutVisible } from '../frames/visibility';
import { FramePreview } from '../frames/FrameLayer';
import { sessionStore, useSession } from '../state/session';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';

/** Layouts sharing a `group` become ONE featured card + modal, listed FIRST; ordinary layouts follow as cards. Layouts the owner hid in ADMIN are filtered out BEFORE grouping, so a group with nothing left disappears. */
const entriesFor = (hidden: readonly string[]) => pickerEntries(visibleLayouts(LAYOUTS, hidden));

const choose = (layoutId: string, hiddenFrames: readonly string[]) =>
  sessionStore.update({ layoutId, frameId: frameForLayoutVisible(layoutId, sessionStore.get().frameId, hiddenFrames), screen: 'camera' });

export function Layout() {
  const { layoutId } = useSession();
  // Read once per mount: the picker is mounted each time a guest reaches it, so ADMIN changes apply without a reload.
  const [{ ENTRIES, hiddenFrames }] = useState(() => { const st = loadSettings(); return { ENTRIES: entriesFor(st.layoutVisibility.hidden), hiddenFrames: st.frameVisibility.hidden }; });
  // Thumbnails show the frame the guest would actually get (the first visible one when the default frame is hidden).
  const previewFrame = (id: string) => frameForLayoutVisible(id, null, hiddenFrames);
  // Local state on purpose: a session wipe remounts this screen (App key={session id}), which closes the modal with it.
  const [openGroup, setOpenGroup] = useState<LayoutGroup | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setOpenGroup(null), []);

  return (
    <main className="lay">
      <h2>CHOOSE YOUR STRIP</h2>
      <div className="lay-grid">
        {ENTRIES.map((e) => e.kind === 'layout' ? (
          <button key={e.layout.id} className="lay-card" onClick={() => choose(e.layout.id, hiddenFrames)}>
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
            <span>{e.group.name}</span>
            <small className="lay-sub">{e.group.layouts.length} LAYOUTS · TAP TO OPEN</small>
          </button>
        ))}
      </div>
      <button className="btn ghost" onClick={() => sessionStore.reset()}><Icon name="close" />CANCEL</button>

      {openGroup && (
        <Modal label={openGroup.name} onClose={close} returnFocusRef={opener}>
          <div className="modal-grid">
            {openGroup.layouts.map((l) => (
              <button key={l.id} className={`lay-card${l.id === layoutId ? ' on' : ''}`} aria-current={l.id === layoutId || undefined} onClick={() => { choose(l.id, hiddenFrames); close(); }}>
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
