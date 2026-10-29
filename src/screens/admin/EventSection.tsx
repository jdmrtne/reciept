import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import {
  DEFAULT_BRANDING_TEXT,
  DEFAULT_EVENT_NAME,
  EVENT_LIMITS,
  addEventProfile,
  canDeleteEvent,
  deleteEventProfile,
  duplicateEventProfile,
  resetEventProfile,
  setActiveEvent,
  type BoothSettings
} from '../../config/settings';
import { DEFAULT_THANK_YOU, finalText } from '../../config/events';
import { FRAMES, isImageFrame } from '../../frames/registry';
import { makeEventCtx } from '../../frames/prims';
import { buildSnapshot } from '../../editor/model';
import { canvasToBlob, renderPreview } from '../../render/render';
import {
  commitSave,
  currentDraft,
  draftPreviewProfile,
  eventEditorStore,
  hasErrors,
  isDirty,
  selectedProfile,
  textLength,
  validateDraft,
  type EditorState
} from './eventEditor';
import { ConfirmDialog, Hint, SwitchRow, TextField } from './ui';
import { customFramesCard } from './CustomFramesSection';
import type { AdminCtx, SectionDef } from './types';

/**
 * ADMIN "Events" section (EP-3). Owner-only: it is a normal ADMIN section, so it only exists behind the PIN gate (AdminScreen).
 * It never touches a customer session: it edits SAVED profiles (`settings.events`), and a session keeps the profile snapshot it
 * started with (`session.stamp.info`, see state/stamp.ts). Rules for the owner are in docs/OWNER-GUIDE.md.
 */

const useEditor = (): EditorState => useSyncExternalStore(eventEditorStore.subscribe, eventEditorStore.get, eventEditorStore.get);
const nameOf = (name: string) => finalText(name) || DEFAULT_EVENT_NAME;
const apply = (c: AdminCtx, next: BoothSettings) => c.set({ events: next.events, activeEventId: next.activeEventId });

/** Sync guard: a second tap while an action is running does nothing (and after SAVE the draft is clean, so SAVE is a no-op anyway). */
function useOnce() {
  const busy = useRef(false);
  return (fn: () => void) => { if (busy.current) return; busy.current = true; try { fn(); } finally { busy.current = false; } };
}

type Ask = { kind: 'delete' | 'reset' | 'switch'; id: string };

// ------------------------------------------------------------------ list + actions

function EventList(c: AdminCtx) {
  const { s, notify, busy } = c;
  const st = useEditor(), once = useOnce();
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => { eventEditorStore.reconcile(s); }, [s.events]); // a profile that no longer exists cannot stay selected
  const profile = selectedProfile(s, st), dirty = isDirty(s, st);
  const isActive = profile.id === s.activeEventId, del = canDeleteEvent(s, profile.id);
  const full = s.events.length >= EVENT_LIMITS.maxEvents;
  const locked = busy || dirty; // profile-level actions wait until the open edit is saved or cancelled

  const select = (id: string) => { if (id === profile.id) return; if (dirty) setAsk({ kind: 'switch', id }); else eventEditorStore.select(id); };
  const create = () => once(() => {
    const next = addEventProfile(s, { name: 'NEW EVENT' }, false);
    const made = next.events.find((e) => !s.events.some((o) => o.id === e.id));
    if (!made) { notify('error', `THE LIMIT OF ${EVENT_LIMITS.maxEvents} EVENTS IS REACHED \u2014 DELETE ONE FIRST`); return; }
    if (apply(c, next)) { eventEditorStore.select(made.id); notify('success', 'NEW EVENT CREATED \u2014 EDIT IT BELOW. IT IS NOT ACTIVE YET'); }
  });
  const duplicate = () => once(() => {
    const next = duplicateEventProfile(s, profile.id);
    const made = next.events.find((e) => !s.events.some((o) => o.id === e.id));
    if (!made) { notify('error', `THE LIMIT OF ${EVENT_LIMITS.maxEvents} EVENTS IS REACHED \u2014 DELETE ONE FIRST`); return; }
    if (apply(c, next)) { eventEditorStore.select(made.id); notify('success', 'EVENT COPIED \u2014 THE COPY IS NOT ACTIVE'); }
  });
  const activate = () => once(() => {
    const next = setActiveEvent(s, profile.id);
    if (next.activeEventId !== profile.id) { notify('error', 'THAT EVENT NO LONGER EXISTS'); return; }
    if (apply(c, next)) notify('success', `ACTIVE EVENT: ${nameOf(profile.name)}. THE NEXT CUSTOMER USES IT`);
  });
  const remove = () => once(() => {
    const next = deleteEventProfile(s, ask?.id ?? profile.id);
    setAsk(null);
    if (next === s) { notify('error', 'THIS EVENT CANNOT BE DELETED'); return; }
    if (apply(c, next)) { eventEditorStore.select(next.activeEventId); notify('success', 'EVENT DELETED'); }
  });
  const reset = () => once(() => {
    const id = ask?.id ?? profile.id;
    setAsk(null);
    if (apply(c, resetEventProfile(s, id))) { eventEditorStore.cancel(); notify('success', 'EVENT TEXT RESET TO THE DEFAULTS'); }
  });

  const why = dirty ? 'SAVE OR CANCEL YOUR CHANGES FIRST' : !del.ok ? (del.reason === 'active' ? 'THE ACTIVE EVENT CANNOT BE DELETED \u2014 MAKE ANOTHER EVENT ACTIVE FIRST' : del.reason === 'last' ? 'THE BOOTH NEEDS AT LEAST ONE EVENT' : '') : '';

  return (
    <>
      <p className="ev-now" role="status">
        <Icon name="check" />ACTIVE EVENT: <b>{nameOf(s.events.find((e) => e.id === s.activeEventId)?.name ?? '')}</b>
      </p>
      <ul className="ev-list" aria-label="Saved events">
        {s.events.map((e) => (
          <li key={e.id}>
            <button type="button" className="ev-item" aria-current={e.id === profile.id ? 'true' : undefined} onClick={() => select(e.id)}>
              <span className="ev-main">
                <span className="ev-name">{nameOf(e.name)}</span>
                <span className="ev-sub">{finalText(e.header) || '\u2014'}<i className="ev-id">#{e.id}</i></span>
              </span>
              {e.id === s.activeEventId && <span className="ev-tag">ACTIVE</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="test-actions ev-actions">
        <button type="button" className="btn ghost" disabled={locked || full} onClick={create}><Icon name="sticker" />NEW EVENT</button>
        <button type="button" className="btn" disabled={locked || isActive} onClick={activate}><Icon name="check" />MAKE ACTIVE</button>
        <button type="button" className="btn ghost" disabled={locked || full} onClick={duplicate}><Icon name="copy" />DUPLICATE</button>
        <button type="button" className="btn ghost" disabled={locked} onClick={() => setAsk({ kind: 'reset', id: profile.id })}><Icon name="reset" />RESET TEXT</button>
        <button type="button" className="btn ghost" disabled={locked || !del.ok} onClick={() => setAsk({ kind: 'delete', id: profile.id })}><Icon name="trash" />DELETE</button>
      </div>
      {why && <Hint>{why}</Hint>}
      {full && <Hint>{`LIMIT OF ${EVENT_LIMITS.maxEvents} EVENTS REACHED.`}</Hint>}
      <Hint>MAKE ACTIVE decides what the NEXT customer gets. A customer who already started keeps the event text they started with.</Hint>

      {ask?.kind === 'switch' && (
        <ConfirmDialog title="UNSAVED CHANGES" body="You changed this event but did not save. Switching to another event throws those changes away." confirmLabel="DISCARD AND SWITCH" cancelLabel="KEEP EDITING"
          danger onCancel={() => setAsk(null)} onConfirm={() => { eventEditorStore.select(ask.id); setAsk(null); }} />
      )}
      {ask?.kind === 'delete' && (
        <ConfirmDialog title="DELETE THIS EVENT?" body={`"${nameOf(s.events.find((e) => e.id === ask.id)?.name ?? '')}" and its receipt text will be removed. This cannot be undone.`} confirmLabel="DELETE" danger onCancel={() => setAsk(null)} onConfirm={remove} />
      )}
      {ask?.kind === 'reset' && (
        <ConfirmDialog title="RESET THE TEXT?" body={`Name, header, details, thank-you and branding of "${nameOf(s.events.find((e) => e.id === ask.id)?.name ?? '')}" go back to the defaults. The event keeps its place in the list.${ask.id === s.activeEventId ? ' It is the ACTIVE event, so the next customer gets the default text.' : ''}`} confirmLabel="RESET" danger onCancel={() => setAsk(null)} onConfirm={reset} />
      )}
    </>
  );
}

// ------------------------------------------------------------------ edit form

function EventForm(c: AdminCtx) {
  const { s, notify, busy } = c;
  const st = useEditor(), once = useOnce();
  const profile = selectedProfile(s, st), draft = currentDraft(s, st), dirty = isDirty(s, st);
  const errors = validateDraft(draft), bad = hasErrors(errors), count = Object.keys(errors).length;
  const isActive = profile.id === s.activeEventId;
  const edit = (patch: Parameters<typeof eventEditorStore.edit>[1]) => eventEditorStore.edit(s, patch);
  const counter = (v: string) => `${textLength(v)}/${EVENT_LIMITS.lineMax}`;

  const save = () => once(() => {
    // Persist first; the draft is only dropped after the write succeeded, so a refused write never eats the owner's text (the panel shows the error).
    const r = commitSave(s, (next) => apply(c, next));
    if (r === 'invalid') notify('error', 'FIX THE MARKED FIELDS BEFORE SAVING');
    else if (r === 'saved') notify('success', isActive ? 'EVENT SAVED \u2014 THE NEXT CUSTOMER GETS THIS TEXT' : 'EVENT SAVED');
  });

  return (
    <>
      <div className="ev-bar" role="group" aria-label="Save or cancel">
        <p className={dirty ? 'ev-state dirty' : 'ev-state'} role="status" aria-live="polite">
          <Icon name={dirty ? 'alert' : 'check'} />
          {dirty ? (bad ? `UNSAVED \u2014 ${count} ${count === 1 ? 'PROBLEM' : 'PROBLEMS'} TO FIX` : 'UNSAVED CHANGES') : 'NO UNSAVED CHANGES'}
        </p>
        <button type="button" className="btn ghost" disabled={!dirty || busy} onClick={() => eventEditorStore.cancel()}><Icon name="close" />CANCEL</button>
        <button type="button" className="btn" disabled={!dirty || bad || busy} onClick={save}><Icon name="check" />SAVE</button>
      </div>
      <p className="ev-edit-of">EDITING: <b>{nameOf(profile.name)}</b>{isActive && <span className="ev-tag">ACTIVE</span>}<i className="ev-id">#{profile.id}</i></p>
      {isActive && <Hint>This is the active event. Nothing changes for customers until you press SAVE.</Hint>}

      <TextField label="EVENT NAME" hint="Required. Printed first, large, unless the chosen frame already shows it." value={draft.name} placeholder="MARIA & JOSE" counter={counter(draft.name)} error={errors.name}
        onChange={(v) => edit({ name: v })} />
      <TextField label="HEADER / TITLE" hint="Optional. A line under the name, e.g. WEDDING RECEPTION." value={draft.header} placeholder="WEDDING RECEPTION" counter={counter(draft.header)} error={errors.header}
        onChange={(v) => edit({ header: v })} />
      {draft.details.map((line, i) => (
        <TextField key={i} label={`DETAIL LINE ${i + 1}`} hint={i === 0 ? 'Optional. Venue, host or date, e.g. GRAND BALLROOM. Blank lines are skipped.' : 'Optional.'} value={line}
          placeholder={['GRAND BALLROOM', 'HOSTED BY THE SANTOS FAMILY', 'OCTOBER 12'][i]} counter={counter(line)} error={errors[`detail${i}` as 'detail0']}
          onChange={(v) => edit({ detail: { index: i, value: v } })} />
      ))}
      <TextField label="THANK-YOU MESSAGE" hint={`Optional. Leave blank to print no thank-you. Default: ${DEFAULT_THANK_YOU}.`} value={draft.thankYou} placeholder={DEFAULT_THANK_YOU} counter={counter(draft.thankYou)} error={errors.thankYou}
        onChange={(v) => edit({ thankYou: v })} />
      <SwitchRow label="SHOW BRANDING" hint="A small line at the bottom of the receipt" checked={draft.brandingEnabled} onChange={(v) => edit({ brandingEnabled: v })} />
      <TextField label="BRANDING TEXT" hint={`Leave blank to print "${DEFAULT_BRANDING_TEXT}".`} value={draft.brandingText} placeholder={DEFAULT_BRANDING_TEXT} disabled={!draft.brandingEnabled}
        counter={counter(draft.brandingText)} error={errors.brandingText} onChange={(v) => edit({ brandingText: v })} />
      <Hint>{`Each line holds up to ${EVENT_LIMITS.lineMax} characters. Letters, numbers, accents and common punctuation print; emoji and other scripts do not. Nothing is cut off while you type: a line that is too long is marked and cannot be saved.`}</Hint>
    </>
  );
}

// ------------------------------------------------------------------ preview (the real EP-2 plan, never printed or uploaded)

const PREVIEW_FRAME = FRAMES.find((f) => !isImageFrame(f) && !f.prints)?.id ?? FRAMES[0].id;
let samplePhoto: { src: string; iw: number; ih: number }[] | null = null;
/** A neutral stand-in picture (nothing of a customer). Made lazily because it needs a canvas. */
function samplePhotos() {
  if (samplePhoto) return samplePhoto;
  const cv = document.createElement('canvas'); cv.width = 800; cv.height = 600;
  const g = cv.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 800, 600); grd.addColorStop(0, '#d8d8d8'); grd.addColorStop(1, '#8c8c8c');
  g.fillStyle = grd; g.fillRect(0, 0, 800, 600);
  g.fillStyle = '#f4f4f4'; g.beginPath(); g.arc(400, 250, 105, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(400, 560, 210, 170, 0, Math.PI, 0); g.fill();
  samplePhoto = [{ src: cv.toDataURL('image/png'), iw: 800, ih: 600 }];
  return samplePhoto;
}

function EventPreview(c: AdminCtx) {
  const { s } = c;
  const st = useEditor();
  const profile = selectedProfile(s, st), draft = currentDraft(s, st);
  const [frameId, setFrameId] = useState(PREVIEW_FRAME);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const when = useRef(new Date()); // one sample moment; this is not a customer session
  const urlRef = useRef<string | null>(null);
  const key = JSON.stringify([draft, profile.id, frameId, s.paperWidthMm]);

  useEffect(() => {
    let dead = false;
    const t = window.setTimeout(() => {
      // The same plan and renderer that feed the printer (render/plan.ts, EP-2). No QR, no printer, no upload, no stored session.
      let drawn: Promise<Blob>;
      try {
        const ctx = makeEventCtx(draftPreviewProfile(draft, profile.id), when.current);
        drawn = renderPreview(buildSnapshot('single', samplePhotos(), frameId), ctx, s.paperWidthMm).then((cv) => canvasToBlob(cv));
      } catch { setFailed(true); return; } // no canvas on this device: say so instead of throwing from a timer
      drawn
        .then((b) => {
          if (dead) return;
          const next = URL.createObjectURL(b);
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          urlRef.current = next; setUrl(next); setFailed(false);
        })
        .catch(() => { if (!dead) setFailed(true); });
    }, 250);
    return () => { dead = true; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  return (
    <>
      <label className="field">
        <span className="field-top"><span className="field-l">PREVIEW FRAME</span></span>
        <select className="adm-in" value={frameId} onChange={(e) => setFrameId(e.target.value)}>
          {FRAMES.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <div className="ev-prev">
        {url ? <img className="ev-prev-img" src={url} alt="Sample receipt showing this event's text" /> : <p className="loading">{failed ? 'PREVIEW UNAVAILABLE' : 'DRAWING PREVIEW'}</p>}
      </div>
      <Hint>Sample photo, date and time. Shows your unsaved text. Nothing is printed, saved or sent, and the QR code is not drawn here.</Hint>
    </>
  );
}

export const eventsSection: SectionDef = {
  id: 'events',
  label: 'Events',
  icon: 'sticker',
  description: 'The text printed on every receipt, which event the next customer gets, and your own event special frames.',
  cards: [
    { id: 'events-list', title: 'Events', description: 'Pick an event to edit, make one active, add, copy or remove.', keywords: ['event', 'events', 'profile', 'active event', 'new event', 'duplicate', 'copy', 'delete', 'remove', 'reset', 'switch event', 'wedding', 'party'], render: (c) => <EventList {...c} /> },
    { id: 'events-edit', title: 'Event text', description: 'Saved only when you press SAVE.', keywords: ['event name', 'name', 'header', 'title', 'details', 'subtitle', 'venue', 'host', 'date line', 'thank you', 'thank-you message', 'branding', 'printed by memorys', 'receipt text', 'save', 'cancel'], render: (c) => <EventForm {...c} /> },
    customFramesCard,
    { id: 'events-preview', title: 'Receipt preview', description: 'How the text lands on a receipt.', aside: true, keywords: ['preview', 'receipt preview', 'sample', 'look'], render: (c) => <EventPreview {...c} /> }
  ]
};
