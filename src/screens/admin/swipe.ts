/**
 * Swipe-to-change-tab, kept separate from React so the decision can be unit tested.
 *
 * A gesture counts only when it is clearly a quick sideways flick that STARTED on plain page background. It is ignored when:
 *  - it starts on (or inside) anything that has its own use for a horizontal drag or a tap: form fields, buttons, links, sliders,
 *    previews, images, drop zones, or anything marked data-no-swipe;
 *  - it starts inside something that can itself scroll sideways (a wide table, the tab bar);
 *  - it is mostly vertical (the person is scrolling), too short, too slow, or uses more than one finger.
 */
export interface Point { x: number; y: number; t: number }
export interface SwipeLimits { minDx: number; maxSlope: number; maxMs: number }
export const SWIPE: SwipeLimits = { minDx: 64, maxSlope: 0.55, maxMs: 700 };

/** -1 = go to the previous tab (swipe right), +1 = next tab (swipe left), 0 = not a tab swipe. */
export function swipeDirection(a: Point, b: Point, lim: SwipeLimits = SWIPE): -1 | 0 | 1 {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) < lim.minDx) return 0;
  if (Math.abs(dy) > Math.abs(dx) * lim.maxSlope) return 0; // mostly vertical: that is scrolling
  if (b.t - a.t > lim.maxMs) return 0; // a slow drag is not a flick
  return dx < 0 ? 1 : -1;
}

/** Elements that own horizontal or tap gestures. */
export const NO_SWIPE_SELECTOR = [
  'input', 'textarea', 'select', 'button', 'a[href]', 'label', 'summary', 'canvas', 'svg', 'img', 'video', 'output',
  '[contenteditable="true"]', '[role="slider"]', '[role="switch"]', '[role="radio"]', '[role="tab"]', '[role="tablist"]', '[role="dialog"]', '[role="alertdialog"]',
  '[data-no-swipe]', '.cf-row', '.test-prev', '.ev-prev', '.ft-prev', '.cf-prev'
].join(',');

/** True when a swipe may start from `target`: not on a control/preview, and not inside anything that scrolls sideways (up to `root`). */
export function canStartSwipe(target: EventTarget | null, root: Element): boolean {
  let el = target instanceof Element ? target : null;
  if (!el) return false;
  if (el.closest(NO_SWIPE_SELECTOR)) return false;
  for (; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const ox = typeof getComputedStyle === 'function' ? getComputedStyle(el).overflowX : '';
      if (ox === 'auto' || ox === 'scroll') return false;
    }
  }
  return true;
}

/**
 * Wire touch listeners onto `root`. Listeners are passive and never call preventDefault, so vertical scrolling, taps and
 * on-screen keyboards behave exactly as before. Returns the cleanup.
 */
export function attachSwipe(root: HTMLElement, onSwipe: (dir: -1 | 1) => void, lim: SwipeLimits = SWIPE): () => void {
  let start: Point | null = null;
  const down = (e: TouchEvent) => {
    start = null;
    if (e.touches.length !== 1 || !canStartSwipe(e.target, root)) return;
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const up = (e: TouchEvent) => {
    const a = start; start = null;
    if (!a || e.changedTouches.length !== 1) return;
    if (window.getSelection?.()?.toString()) return; // the person was selecting text
    const t = e.changedTouches[0];
    const d = swipeDirection(a, { x: t.clientX, y: t.clientY, t: Date.now() }, lim);
    if (d) onSwipe(d);
  };
  const cancel = () => { start = null; };
  root.addEventListener('touchstart', down, { passive: true });
  root.addEventListener('touchend', up, { passive: true });
  root.addEventListener('touchcancel', cancel, { passive: true });
  return () => { root.removeEventListener('touchstart', down); root.removeEventListener('touchend', up); root.removeEventListener('touchcancel', cancel); };
}
