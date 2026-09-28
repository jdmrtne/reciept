import { useState } from 'react';
import { CATEGORIES, STICKERS, getSticker } from './registry';

/** Draws a sticker in its 100×100 box; wrap in a transformed <g> to place it. */
export function StickerGlyph({ id }: { id: string }) {
  return <g dangerouslySetInnerHTML={{ __html: getSticker(id).svg }} />;
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
            <svg viewBox="0 0 100 100"><StickerGlyph id={s.id} /></svg>
          </button>
        ))}
      </div>
    </div>
  );
}
