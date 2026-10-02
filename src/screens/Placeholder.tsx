import { sessionStore } from '../state/session';
import { Icon } from '../components/Icon';

/** Temporary target for "Tap to start" until Phase 3 (layout selection). */
export function Placeholder({ title }: { title: string }) {
  return (
    <main className="placeholder">
      <h2>{title}</h2>
      <p>Coming in a later phase.</p>
      <button className="btn" onClick={() => sessionStore.reset()}><Icon name="home" />BACK TO START</button>
    </main>
  );
}
