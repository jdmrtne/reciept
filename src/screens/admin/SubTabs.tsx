import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { TabDef } from './types';

/** DOM ids shared by the tab buttons and their panels (aria-controls / aria-labelledby). */
export const tabId = (prefix: string, id: string) => `${prefix}-t-${id}`;
export const panelId = (prefix: string, id: string) => `${prefix}-p-${id}`;

/**
 * The compact horizontal tab bar under a category heading (ARIA tabs pattern, automatic activation).
 * One row only: when the labels do not fit, the BAR scrolls sideways, never the settings panel and never a second row.
 * Left/Right move between tabs, Home/End jump to the first/last. Only the selected tab is in the Tab order.
 * `dirty` marks a tab that holds an unsaved draft, so the owner can see it from another tab.
 */
export function SubTabs({ tabs, active, onSelect, label, prefix, dirty }: { tabs: TabDef[]; active: string; onSelect: (id: string) => void; label: string; prefix: string; dirty?: (t: TabDef) => boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  const btns = useRef<Record<string, HTMLButtonElement | null>>({});

  // keep the selected tab in view inside the bar (swiping or keys can select one that is scrolled out of sight)
  useEffect(() => {
    const b = bar.current, el = btns.current[active];
    if (!b || !el) return;
    const want = el.offsetLeft - (b.clientWidth - el.offsetWidth) / 2;
    b.scrollTo?.({ left: Math.max(0, want), behavior: 'smooth' });
  }, [active]);

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === active);
    const to = e.key === 'ArrowRight' ? Math.min(tabs.length - 1, i + 1) : e.key === 'ArrowLeft' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    if (to !== i) { onSelect(tabs[to].id); btns.current[tabs[to].id]?.focus(); }
  };

  return (
    <div className="adm-tabs" role="tablist" aria-label={label} aria-orientation="horizontal" ref={bar} onKeyDown={key}>
      {tabs.map((t) => {
        const on = t.id === active, d = !!dirty?.(t);
        return (
          <button key={t.id} type="button" role="tab" id={tabId(prefix, t.id)} aria-selected={on} aria-controls={panelId(prefix, t.id)} tabIndex={on ? 0 : -1}
            className={on ? 'adm-tab on' : 'adm-tab'} ref={(el) => { btns.current[t.id] = el; }} onClick={() => onSelect(t.id)}>
            {t.label}{d && <i className="adm-tab-dot" role="img" aria-label="unsaved changes" />}
          </button>
        );
      })}
    </div>
  );
}
