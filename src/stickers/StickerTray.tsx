import { useState } from 'react';
import { CATEGORIES, STICKERS, getSticker, stickerAspect } from './registry';

/** Draws a sticker in a 100 wide box (100 tall for SVG stickers, 100 x aspect for PNG ones); wrap in a transformed <g> to place it. */
export function StickerGlyph({ id }: { id: string }) {
  const s = getSticker(id);
  if (s.src) return <image href={s.src} x={0} y={0} width={100} height={100 * stickerAspect(id)} preserveAspectRatio="none" />;
  return <g dangerouslySetInnerHTML={{ __html: s.svg }} />;
}

export function StickerTray({ onPick }: { onPick: (id: string) => void }) {
  const [cat, setCat] = useState<string>(CATEGORIES[0]);
  return (
    <div className="stk-tray">
      <div className="stk-tabs">
        {CATEGORIES.map((c) => (
          <button key={c} className={`stk-tab${c === cat ? ' on' : ''}`} onClick={() => setCat(c)}>{c.toUpperCase()}</button>
        ))}
      </div>
      <div className="stk-list">
        {STICKERS.filter((s) => s.category === cat).map((s) => (
          <button key={s.id} className="stk" aria-label={s.name} onClick={() => onPick(s.id)}>
            {s.src ? <img src={s.src} alt="" draggable={false} /> : <svg viewBox="0 0 100 100"><StickerGlyph id={s.id} /></svg>}
          </button>
        ))}
      </div>
    </div>
  );
}
