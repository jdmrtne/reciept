import { FILTERS } from './registry';
import { FilterDefs, filterAttr } from './FilterLayer';

/** Filter picker: each card previews the first photo through that filter. */
export function FilterTray({ src, active, onPick }: { src: string; active: string; onPick: (id: string) => void }) {
  return (
    <div className="edit-tray">
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true"><FilterDefs prefix="ft" /></svg>
      {FILTERS.map((f) => (
        <button key={f.id} className={`lay-card${f.id === active ? ' on' : ''}`} onClick={() => onPick(f.id)}>
          <svg viewBox="0 0 120 90" className="flt-svg" aria-hidden="true">
            <rect width="120" height="90" fill="#000" />
            <image href={src} width="120" height="90" preserveAspectRatio="xMidYMid slice" filter={filterAttr('ft', f.id)} />
          </svg>
          <span>{f.name.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
}
