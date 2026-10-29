import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Icon } from './Icon';

// `a[href]`, not `[href]`: SVG <image href> (the layout thumbnails) matches the latter but is not focusable.
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  /** Accessible name AND the visible title. */
  label: string;
  /** Called for CLOSE, Escape and a backdrop tap. The caller decides what closing means (here: just hide it). */
  onClose: () => void;
  /** Focus goes back here when the modal unmounts (the control that opened it), if it is still on the page. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  closeLabel?: string;
  children: ReactNode;
}

/**
 * Small kiosk dialog: black-and-white card over a dimmed backdrop. role="dialog" aria-modal, focus moves in on open and is trapped
 * (Tab / Shift+Tab wrap, focus that strays outside is pulled back), Escape and a backdrop tap close it, the page behind does not scroll,
 * and focus returns to `returnFocusRef` on close. It keeps NO state of its own beyond what is below, so whoever renders it owns "open":
 * a session wipe (App remounts every screen on a new session id) therefore closes it, and the scroll lock is released on unmount.
 * Clicks and key presses are not stopped, so the inactivity timer (hooks/useInactivity.ts) still sees a customer who is busy in here.
 */
export function Modal({ label, onClose, returnFocusRef, closeLabel = 'CLOSE', children }: ModalProps) {
  const dlg = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const downOnBackdrop = useRef<boolean | null>(null);

  useEffect(() => {
    const root = dlg.current;
    if (!root) return;
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // the page behind must not scroll
    (focusables()[0] ?? root).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (f.length === 0) { e.preventDefault(); root.focus(); return; }
      const first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (!root.contains(at)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (at === first || at === root)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Node && !root.contains(e.target)) (focusables()[0] ?? root).focus();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn);
      document.body.style.overflow = prevOverflow;
      const back = returnFocusRef?.current;
      if (back && back.isConnected) back.focus(); // absent after a session wipe or a screen change: nothing to restore
    };
  }, [returnFocusRef]);

  return (
    <div
      className="modal-back"
      // Close only when the press AND the release are on the backdrop, so dragging out of the card never closes it.
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const started = downOnBackdrop.current;
        downOnBackdrop.current = null;
        if (e.target === e.currentTarget && started !== false) closeRef.current();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={dlg}>
        <header className="modal-head">
          <h3 className="modal-title">{label}</h3>
          <button type="button" className="btn ghost modal-close" onClick={() => closeRef.current()}><Icon name="close" />{closeLabel}</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
