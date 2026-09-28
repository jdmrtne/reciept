import { LAYOUTS } from '../layouts/registry';
import { resolveLayout } from '../layouts/engine';
import { sessionStore } from '../state/session';

export function Preview({ id }: { id: string }) {
  const def = LAYOUTS.find((l) => l.id === id)!;
  const L = resolveLayout(def);
  return (
    <svg viewBox={`0 0 ${L.width} ${L.height}`} className="lay-svg" aria-hidden="true">
      <rect width={L.width} height={L.height} fill="#fff" />
      {L.border > 0 && <rect x={L.border} y={L.border} width={L.width - 2 * L.border} height={L.height - 2 * L.border} fill="none" stroke="#000" strokeWidth={L.border} />}
      {[L.header, L.footer].map((r, i) => r && (
        <line key={i} x1={r.x} x2={r.x + r.w} y1={i ? r.y : r.y + r.h} y2={i ? r.y : r.y + r.h} stroke="#000" strokeWidth={3} strokeDasharray="10 8" />
      ))}
      {L.slots.map((s, i) => <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill="#000" />)}
    </svg>
  );
}

export function Layout() {
  return (
    <main className="lay">
      <h2>CHOOSE YOUR STRIP</h2>
      <div className="lay-grid">
        {LAYOUTS.map((l) => (
          <button key={l.id} className="lay-card" onClick={() => sessionStore.update({ layoutId: l.id, screen: 'camera' })}>
            <Preview id={l.id} />
            <span>{l.name.toUpperCase()}</span>
          </button>
        ))}
      </div>
      <button className="btn ghost" onClick={() => sessionStore.reset()}>CANCEL</button>
    </main>
  );
}
