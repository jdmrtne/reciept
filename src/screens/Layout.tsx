import { LAYOUTS } from '../layouts/registry';
import { resolveLayout } from '../layouts/engine';
import { sessionStore } from '../state/session';
import { Icon } from '../components/Icon';

export function Preview({ id }: { id: string }) {
  const def = LAYOUTS.find((l) => l.id === id)!;
  const L = resolveLayout(def);
  return (
    <svg viewBox={`0 0 ${L.width} ${L.height}`} className="lay-svg" aria-hidden="true">
      <rect width={L.width} height={L.height} fill="#fff" stroke="#111" strokeWidth={4} rx={10} />
      {L.border > 0 && <rect x={L.border + 6} y={L.border + 6} width={L.width - 2 * L.border - 12} height={L.height - 2 * L.border - 12} fill="none" stroke="#111" strokeWidth={2} />}
      {[L.header, L.footer].map((r, i) => r && (
        <line key={i} x1={r.x} x2={r.x + r.w} y1={i ? r.y : r.y + r.h} y2={i ? r.y : r.y + r.h} stroke="#111" strokeWidth={3} strokeDasharray="10 8" />
      ))}
      {L.slots.map((s, i) => (
        <g key={i}>
          <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="#f5f5f5" stroke="#111" strokeWidth={3} rx={4} />
          <circle cx={s.x + s.w / 2} cy={s.y + s.h / 2} r={Math.min(s.w, s.h) * 0.16} fill="none" stroke="#111" strokeWidth={2.5} />
        </g>
      ))}
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
      <button className="btn ghost" onClick={() => sessionStore.reset()}><Icon name="close" />CANCEL</button>
    </main>
  );
}
