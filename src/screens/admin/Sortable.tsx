import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../../components/Icon';
import { moveId } from '../../config/order';

/**
 * Drag-to-rearrange for the ADMIN lists (layouts, frames). Works with finger, pen and mouse (pointer events, not HTML5 drag-and-drop,
 * which does not exist on touch screens) and with the keyboard (focus the grip, then the arrow keys move the item one place).
 *
 * The item follows the pointer by changing places live with whatever it is dragged over; the order is saved once, when the finger lifts.
 * Escape (or the browser cancelling the gesture) drops it back where it was. Near the top or bottom edge the list scrolls on its own.
 */

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The nearest ancestor that scrolls vertically, or null (the window scrolls). */
function scrollParent(el: Element | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

export interface HandleProps {
  'data-drag-handle': string;
  'aria-label': string;
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

export function useSortable(ids: readonly string[], onCommit: (next: string[]) => void) {
  const [drag, setDrag] = useState<{ id: string; ids: string[] } | null>(null);
  const live = useRef<{ id: string; ids: string[] } | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const focusId = useRef<string | null>(null);
  const idsRef = useRef(ids); idsRef.current = ids;
  const commitRef = useRef(onCommit); commitRef.current = onCommit;
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []); // leaving the screen mid-drag removes the window listeners

  // After a keyboard move React re-inserts the item, which drops focus: give it back to the grip that moved.
  useEffect(() => {
    const id = focusId.current;
    if (!id) return;
    focusId.current = null;
    els.current.get(id)?.querySelector<HTMLElement>('[data-drag-handle]')?.focus();
  });

  const begin = (id: string, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    stop.current?.();
    const start = [...idsRef.current];
    live.current = { id, ids: start };
    setDrag(live.current);
    const scroller = scrollParent(e.currentTarget);
    let x = e.clientX, y = e.clientY, raf = 0;
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    /** Swap with whichever other item the pointer is over. */
    const hit = () => {
      const cur = live.current;
      if (!cur) return;
      for (const [other, el] of els.current) {
        if (other === cur.id) continue;
        const r = el.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        const from = cur.ids.indexOf(cur.id), to = cur.ids.indexOf(other);
        if (from >= 0 && to >= 0 && from !== to) { live.current = { id: cur.id, ids: moveId(cur.ids, from, to) }; setDrag(live.current); }
        return;
      }
    };
    /** Scroll while the pointer is held near the top or bottom edge of the scrolling area. */
    const tick = () => {
      const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const dy = y < box.top + 64 ? -14 : y > box.bottom - 64 ? 14 : 0;
      if (dy) { if (scroller) scroller.scrollTop += dy; else window.scrollBy(0, dy); hit(); }
      raf = requestAnimationFrame(tick);
    };
    const move = (ev: PointerEvent) => { x = ev.clientX; y = ev.clientY; hit(); };
    const finish = (save: boolean) => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      document.body.style.userSelect = prevSelect;
      const done = live.current;
      live.current = null; stop.current = null;
      setDrag(null);
      if (save && done && !sameIds(done.ids, start)) commitRef.current(done.ids);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finish(false); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    raf = requestAnimationFrame(tick);
    stop.current = () => finish(false);
  };

  const keyMove = (id: string, e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const d = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    const list = idsRef.current, from = list.indexOf(id), to = from + d;
    if (from < 0 || to < 0 || to >= list.length) return;
    focusId.current = id;
    commitRef.current(moveId(list, from, to));
  };

  return {
    /** The ids in the order to DRAW (the live order while an item is held). */
    order: drag ? drag.ids : [...ids],
    /** The id being dragged right now, or null. */
    draggingId: drag?.id ?? null,
    /** Put on the item's outer element so the drag can tell what the pointer is over. */
    itemRef: (id: string) => (el: HTMLElement | null) => { if (el) els.current.set(id, el); else els.current.delete(id); },
    /** Spread onto <DragHandle />. `label` is the item's name, for screen readers. */
    handle: (id: string, label: string): HandleProps => ({
      'data-drag-handle': '',
      'aria-label': `MOVE ${label} (DRAG, OR USE THE ARROW KEYS)`,
      onPointerDown: (e) => begin(id, e),
      onKeyDown: (e) => keyMove(id, e)
    })
  };
}

/** The grip the owner holds to move an item. */
export function DragHandle(props: HandleProps) {
  return <button type="button" className="drag-grip" {...props}><Icon name="grip" /></button>;
}
