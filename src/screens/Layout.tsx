import { useCallback, useRef, useState } from 'react';
import { LAYOUTS } from '../layouts/registry';
import { groupedLayouts, photoCount, photoCountLabel, type LayoutGroup } from '../layouts/groups';
import { DEFAULT_FRAME, frameForLayout } from '../frames/registry';
import { FramePreview } from '../frames/FrameLayer';
import { sessionStore, useSession } from '../state/session';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';

/** Computed once: the registry is static data. Ordinary layouts stay cards; layouts sharing a `group` become one card + modal. */
const ENTRIES = groupedLayouts(LAYOUTS);

const choose = (layoutId: string) =>
  sessionStore.update({ layoutId, frameId: frameForLayout(layoutId, sessionStore.get().frameId), screen: 'camera' });

export function Layout() {
  const { layoutId } = useSession();
  // Local state on purpose: a session wipe remounts this screen (App key={session id}), which closes the modal with it.
  const [openGroup, setOpenGroup] = useState<LayoutGroup | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setOpenGroup(null), []);

  return (
    <main className="lay">
      <h2>CHOOSE YOUR STRIP</h2>
      <div className="lay-grid">
        {ENTRIES.map((e) => e.kind === 'layout' ? (
          <button key={e.layout.id} className="lay-card" onClick={() => choose(e.layout.id)}>
            <FramePreview frameId={frameForLayout(e.layout.id, DEFAULT_FRAME)} layoutId={e.layout.id} />
            <span>{e.layout.name.toUpperCase()}</span>
          </button>
        ) : (
          <button
            key={e.group.id}
            className={`lay-card lay-group${e.group.layouts.some((l) => l.id === layoutId) ? ' on' : ''}`}
            aria-haspopup="dialog"
            aria-current={e.group.layouts.some((l) => l.id === layoutId) || undefined}
            data-group={e.group.id}
            onClick={(ev) => { opener.current = ev.currentTarget; setOpenGroup(e.group); }}
          >
            <div className="lay-stack">
              <div className="lay-stack-in">
                <FramePreview frameId={frameForLayout(e.group.layouts[0].id, DEFAULT_FRAME)} layoutId={e.group.layouts[0].id} />
              </div>
            </div>
            <span>{e.group.name}</span>
            <small className="lay-sub">{e.group.layouts.length} LAYOUTS</small>
          </button>
        ))}
      </div>
      <button className="btn ghost" onClick={() => sessionStore.reset()}><Icon name="close" />CANCEL</button>

      {openGroup && (
        <Modal label={openGroup.name} onClose={close} returnFocusRef={opener}>
          <div className="modal-grid">
            {openGroup.layouts.map((l) => (
              <button key={l.id} className={`lay-card${l.id === layoutId ? ' on' : ''}`} aria-current={l.id === layoutId || undefined} onClick={() => { choose(l.id); close(); }}>
                <FramePreview frameId={frameForLayout(l.id, DEFAULT_FRAME)} layoutId={l.id} />
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
