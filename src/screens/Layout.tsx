import { LAYOUTS } from '../layouts/registry';
import { DEFAULT_FRAME } from '../frames/registry';
import { FramePreview } from '../frames/FrameLayer';
import { sessionStore } from '../state/session';
import { Icon } from '../components/Icon';

export function Layout() {
  return (
    <main className="lay">
      <h2>CHOOSE YOUR STRIP</h2>
      <div className="lay-grid">
        {LAYOUTS.map((l) => (
          <button key={l.id} className="lay-card" onClick={() => sessionStore.update({ layoutId: l.id, screen: 'camera' })}>
            <FramePreview frameId={DEFAULT_FRAME} layoutId={l.id} />
            <span>{l.name.toUpperCase()}</span>
          </button>
        ))}
      </div>
      <button className="btn ghost" onClick={() => sessionStore.reset()}><Icon name="close" />CANCEL</button>
    </main>
  );
}
