import { useId, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import type { Notice } from './types';

/* Small presentational pieces shared by every settings card. No settings logic lives here. */

export function SettingsCard({ title, description, tag, aside, children }: { title: string; description?: string; tag?: string; aside?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section className={aside ? 'card card-aside' : 'card'} aria-labelledby={id}>
      <header className="card-h">
        {tag && <span className="card-tag">{tag}</span>}
        <h4 id={id} className="card-t">{title}</h4>
        {description && <p className="card-d">{description}</p>}
      </header>
      <div className="card-b">{children}</div>
    </section>
  );
}

/** One setting: label (+ optional plain-language hint) on the left, the control on the right. `stack` puts the control under the label. */
export function Row({ label, hint, stack, children }: { label: string; hint?: string; stack?: boolean; children: ReactNode }) {
  return (
    <div className={stack ? 'row stack' : 'row'}>
      <div className="row-l"><span>{label}</span>{hint && <small>{hint}</small>}</div>
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

export function TextField({ label, hint, value, onChange, placeholder, inputMode, disabled }: { label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; inputMode?: 'url' | 'decimal' | 'text'; disabled?: boolean }) {
  return (
    <label className="field">
      <span className="field-l">{label}</span>
      {hint && <small className="field-h">{hint}</small>}
      <input className="adm-in" value={value} placeholder={placeholder} inputMode={inputMode} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="hint">{children}</p>;
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
