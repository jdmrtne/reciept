import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';
import type { Notice } from './types';

/* Small presentational pieces shared by every settings card. No settings logic lives here. */

/**
 * The "?" circle. Explanations stay out of sight until the owner taps it, then open as a small popup next to the circle (it floats over the
 * page, so nothing below it moves). Tap the circle again, tap outside it, or press Esc to close. Put it inside a `.help-host` next to the thing
 * it explains. The text is always in the page (just `hidden` while closed), so search and screen readers still find it. `className` styles the text.
 */
export function Help({ children, className, label = 'Show help' }: { children: ReactNode; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLElement>(null);

  /** Place the popup under the circle, kept inside the screen (flips above it when there is no room below). */
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = Math.min(440, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - 24, window.innerWidth - w - 12));
    const h = pop.current?.offsetHeight ?? 120;
    const below = r.bottom + 10;
    const top = below + h > window.innerHeight - 12 ? Math.max(12, r.top - 10 - h) : below;
    setPos({ position: 'fixed', top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { const t = e.target as Node; if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false); /* the popup is fixed: scrolling or resizing would leave it behind */
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    window.addEventListener('resize', close); document.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true); };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" className="help-btn" aria-label={label} aria-expanded={open} aria-controls={id} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}>?</button>
      <small ref={pop} id={id} role={open ? 'dialog' : undefined} style={open ? { ...pos, width: Math.min(440, window.innerWidth - 24) } : undefined} className={className ? `help-t ${className}` : 'help-t'} hidden={!open}>
        {children}
      </small>
    </>
  );
}

/**
 * A card's explanations all live behind ONE "?" beside its title: the card description first, then every (non-important) Hint inside the card.
 * A Hint finds the card through this context and moves its text into the card's popup (`slot`); `add` lets the card know it has hints so the "?" shows
 * even without a description. Before the first browser paint (and in static markup) a Hint simply renders its own "?" in place.
 */
const CardHelp = createContext<{ slot: HTMLElement | null; add: () => () => void } | null>(null);
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function SettingsCard({ title, description, tag, aside, open, children }: { title: string; description?: string; tag?: string; aside?: boolean; /** Search results: jump to the tab this card lives in. */ open?: { label: string; onOpen: () => void }; children: ReactNode }) {
  const id = useId();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [hints, setHints] = useState(0);
  const add = useCallback(() => { setHints((n) => n + 1); return () => setHints((n) => n - 1); }, []);
  const ctx = useMemo(() => ({ slot, add }), [slot, add]);
  return (
    <section className={aside ? 'card card-aside' : 'card'} aria-labelledby={id}>
      <header className="card-h">
        {tag && <span className="card-tag">{tag}</span>}
        <div className="help-host">
          <h4 id={id} className="card-t">{title}</h4>
          {(description || hints > 0) && <Help className="card-d">{description && <span className="help-p">{description}</span>}<span ref={setSlot} /></Help>}
        </div>
        {open && <button type="button" className="btn ghost adm-open" onClick={open.onOpen}>{open.label}</button>}
      </header>
      <CardHelp.Provider value={ctx}><div className="card-b">{children}</div></CardHelp.Provider>
    </section>
  );
}

/** One setting: label (+ optional plain-language hint) on the left, the control on the right. `stack` puts the control under the label. */
export function Row({ label, hint, stack, children }: { label: string; hint?: string; stack?: boolean; children: ReactNode }) {
  return (
    <div className={stack ? 'row stack' : 'row'}>
      <div className="row-l"><div className="help-host"><span>{label}</span>{hint && <Help>{hint}</Help>}</div></div>
      <div className="row-c">{children}</div>
    </div>
  );
}

/** The old −/value/+ row. Same labels, same aria-labels, same step sizes (the callers keep those). */
export function StepperRow({ label, hint, value, onMinus, onPlus, disabled }: { label: string; hint?: string; value: string; onMinus: () => void; onPlus: () => void; disabled?: boolean }) {
  return (
    <Row label={label} hint={hint}>
      <button type="button" className="btn ghost adm-b" disabled={disabled} onClick={onMinus} aria-label={`${label} less`}>{'\u2212'}</button>
      <output className="adm-v" aria-label={`${label} value`}>{value}</output>
      <button type="button" className="btn ghost adm-b" disabled={disabled} onClick={onPlus} aria-label={`${label} more`}>+</button>
    </Row>
  );
}

/** ON/OFF. Replaces the old "+ cycles the value" button, which hid what pressing it did. */
export function SwitchRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Row label={label} hint={hint}>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)}>
        <i aria-hidden="true" /><b>{checked ? 'ON' : 'OFF'}</b>
      </button>
    </Row>
  );
}

/** SHOWN / HIDDEN switch for one tile (ADMIN > Frames grid and the event frame groups). SwitchRow above is the ON / OFF row version. */
export function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <i aria-hidden="true" /><b>{checked ? 'SHOWN' : 'HIDDEN'}</b>
    </button>
  );
}

export interface Choice<T extends string | number> { value: T; label: string; icon?: string }

/** Pick one of a few. Replaces the old "+ cycles through the list" rows (PAPER, PRESET, DITHER). `value` null = none selected (e.g. CUSTOM tuning). */
export function ChoiceRow<T extends string | number>({ label, hint, value, options, onChange, disabled, note }: { label: string; hint?: string; value: T | null; options: Choice<T>[]; onChange: (v: T) => void; disabled?: boolean; note?: string }) {
  return (
    <Row label={label} hint={hint} stack>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className="seg-o" disabled={disabled} onClick={() => onChange(o.value)}>
            {o.icon && <Icon name={o.icon} />}{o.label}
          </button>
        ))}
        {note && <span className="seg-note">{note}</span>}
      </div>
    </Row>
  );
}

/**
 * `error` / `counter` are optional (EP-3 event form): the error text is shown under the input and wired with aria-invalid /
 * aria-describedby; the counter ("12/40") sits next to the label. Neither limits what can be typed: nothing is truncated while typing.
 */
export function TextField({ label, hint, value, onChange, placeholder, inputMode, disabled, error, counter }: { label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; inputMode?: 'url' | 'decimal' | 'text'; disabled?: boolean; error?: string; counter?: string }) {
  const errId = useId();
  return (
    <label className={error ? 'field has-err' : 'field'}>
      <span className="field-top"><span className="help-host"><span className="field-l">{label}</span>{hint && <Help className="field-h">{hint}</Help>}</span>{counter && <span className={error ? 'field-n bad' : 'field-n'}>{counter}</span>}</span>
      <input className="adm-in" value={value} placeholder={placeholder} inputMode={inputMode} disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}
        onChange={(e) => onChange(e.target.value)} onFocus={(e) => e.currentTarget.scrollIntoView?.({ block: 'center', behavior: 'smooth' })} />
      {error && <small id={errId} className="field-err" role="alert">{error}</small>}
    </label>
  );
}

/** Explanatory text, hidden behind a "?" circle. `important` keeps it on screen: use it only for a state the owner must see right now (a warning, an empty list, a limit reached). */
export function Hint({ children, important }: { children: ReactNode; important?: boolean }) {
  const card = useContext(CardHelp);
  const add = card?.add;
  useIsoLayoutEffect(() => (important || !add ? undefined : add()), [important, add]);
  if (important) return <p className="hint">{children}</p>;
  if (card?.slot) return createPortal(<span className="help-p">{children}</span>, card.slot);
  return <div className="help-host hint-host"><Help>{children}</Help></div>;
}

export type SaveState = 'idle' | 'saved' | 'error';
/** Settings save the moment they change (there is no Save button), so this just says so, and confirms each save. */
export function SaveStatus({ state }: { state: SaveState }) {
  const text = state === 'error' ? 'NOT SAVED' : state === 'saved' ? 'SAVED' : 'AUTO-SAVE ON';
  return (
    <p className={`save save-${state}`} role="status" aria-live="polite">
      <Icon name={state === 'error' ? 'alert' : 'check'} />{text}
    </p>
  );
}

/** Result of an action (pair, test print, check share) or a failed save. Errors stay until dismissed; successes fade (see AdminPanel). */
export function Toast({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  return (
    <div className="toast-region" aria-live="polite">
      {notice && (
        <div key={notice.id} className={`toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : undefined}>
          <Icon name={notice.kind === 'error' ? 'alert' : notice.kind === 'success' ? 'check' : 'info'} />
          <p>{notice.text}</p>
          <button type="button" className="toast-x" onClick={onDismiss} aria-label="Dismiss message"><Icon name="close" /></button>
        </div>
      )}
    </div>
  );
}

/**
 * Yes/no question in front of everything else (delete, reset, leaving with unsaved changes). The SAFE choice has the focus, Escape
 * and the backdrop mean "no". `danger` marks the confirm button as the destructive one.
 */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel = 'CANCEL', danger, onConfirm, onCancel }: { title: string; body: string; confirmLabel: string; cancelLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const tid = useId(), bid = useId();
  const safe = useRef<HTMLButtonElement>(null);
  useEffect(() => { safe.current?.focus(); }, []);
  return (
    <div className="dlg-back" onClick={onCancel}>
      <div className="dlg" role="alertdialog" aria-modal="true" aria-labelledby={tid} aria-describedby={bid} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
        <h4 id={tid} className="dlg-t">{title}</h4>
        <p id={bid} className="dlg-b">{body}</p>
        <div className="dlg-a">
          <button type="button" className="btn ghost" ref={safe} onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={danger ? 'btn danger' : 'btn'} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
