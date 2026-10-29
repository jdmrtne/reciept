import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import { DEFAULT_EVENT_NAME } from '../../config/settings';
import { finalText } from '../../config/events';
import { FramePreview } from '../../frames/FrameLayer';
import { MESSAGES, NAME_MAX, cleanName } from '../../frames/custom/store';
import { customEnabled, customLayouts, customRecords, customVersion, getCustomStatus, setCustomEnabled, setCustomFrameEvent, subscribeCustom } from '../../frames/custom/runtime';
import { addEventFrame } from '../../frames/custom/addEventFrame';
import { framesOfEvent, thumbLayout, unassignedSpecialFrames } from '../../frames/custom/groups';
import { CUSTOM_LAYOUT_IDS } from '../../frames/custom/validate';
import type { CustomLayoutId } from '../../frames/custom/types';
import { FrameEditor, KEYWORDS, SpecHints, layoutLabel } from './CustomFramesSection';
import { eventEditorStore, selectedProfile, type EditorState } from './eventEditor';
import { Hint, Switch } from './ui';
import type { AdminCtx, CardDef } from './types';

/**
 * ADMIN > Events > Event frames: the FRAME GROUP of the event picked in the list above. A group is simply the special frames whose
 * `eventId` is that event (see frames/custom/groups.ts); nothing else is stored. The grid copies ADMIN > Frames (`.fg-*`, one SHOWN / HIDDEN
 * switch per tile). Whether guests get a frame depends only on that switch, never on which event is active.
 */

const useEditor = (): EditorState => useSyncExternalStore(eventEditorStore.subscribe, eventEditorStore.get, eventEditorStore.get);
const ACCEPT = 'image/png,image/webp';
const DEFAULT_ADD_LAYOUT: CustomLayoutId = 'strip-3';

/** Picks the selected event and starts the body fresh whenever that changes (grid view, closed add panel, no half-typed name). */
function EventFrames(c: AdminCtx) {
  const profile = selectedProfile(c.s, useEditor());
  return <EventFramesBody key={profile.id} {...c} eventId={profile.id} eventName={finalText(profile.name) || DEFAULT_EVENT_NAME} />;
}

function EventFramesBody({ s, notify, eventId, eventName }: AdminCtx & { eventId: string; eventName: string }) {
  useSyncExternalStore(subscribeCustom, customVersion, customVersion); // re-render on every registry change
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [layoutId, setLayoutId] = useState<CustomLayoutId>(DEFAULT_ADD_LAYOUT);
  const [file, setFile] = useState<Blob | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []); // re-armed on remount (StrictMode)

  const status = getCustomStatus();
  if (status === 'unavailable') return <Hint>{MESSAGES.unavailable}</Hint>;
  if (status === 'idle' || status === 'loading') return <Hint>Loading your frames.</Hint>;

  const records = customRecords();
  const frames = framesOfEvent(records, eventId);
  const loose = unassignedSpecialFrames(records, s.events.map((e) => e.id));
  const open = editing && frames.some((f) => f.id === editing) ? editing : null; // a frame that vanished sends you back to the grid
  const title = eventName.toUpperCase();
  const shownCount = frames.filter((f) => customEnabled(f.id)).length;

  const closeAdd = () => { setAdding(false); setName(''); setLayoutId(DEFAULT_ADD_LAYOUT); setFile(null); setErrors([]); setOver(false); };
  const back = () => { setEditing(null); setNotes([]); };

  const save = async () => {
    if (busy) return;
    setBusy(true); setErrors([]);
    try {
      const r = await addEventFrame({ eventId, name, layoutId, file });
      if (!alive.current) return;
      if (!r.ok) { setErrors(r.errors); notify('error', 'FRAME NOT ADDED'); return; }
      closeAdd(); setNotes(r.warnings); setEditing(r.frameId);
      notify('success', `FRAME ${r.name.toUpperCase()} ADDED: ${r.windows} PHOTO ${r.windows === 1 ? 'WINDOW' : 'WINDOWS'} FOUND`);
    } finally { if (alive.current) setBusy(false); }
  };

  const toggle = async (id: string, label: string, on: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await setCustomEnabled(id, on);
      if (!alive.current) return;
      if (!r.ok) { notify('error', 'COULD NOT CHANGE THIS FRAME'); return; }
      notify('success', on ? `${label} IS SHOWN. THE NEXT GUEST CAN PICK IT` : `${label} IS HIDDEN. GUESTS NO LONGER SEE IT`);
    } finally { if (alive.current) setBusy(false); }
  };

  const setAll = async (show: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      let failed = 0;
      for (const f of frames) if (customEnabled(f.id) !== show && !(await setCustomEnabled(f.id, show)).ok) failed++;
      if (!alive.current) return;
      if (failed) notify('error', `${failed} ${failed === 1 ? 'FRAME' : 'FRAMES'} COULD NOT BE CHANGED`);
      else notify('success', show ? 'ALL FRAMES OF THIS EVENT ARE SHOWN' : 'ALL FRAMES OF THIS EVENT ARE HIDDEN');
    } finally { if (alive.current) setBusy(false); }
  };

  const move = async (id: string, label: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await setCustomFrameEvent(id, eventId);
      if (!alive.current) return;
      if (!r.ok) { notify('error', 'FRAME NOT MOVED'); return; }
      notify('success', `${label} IS NOW IN ${title}`);
    } finally { if (alive.current) setBusy(false); }
  };

  if (open) {
    return (
      <>
        {notes.length > 0 && <ul className="cf-warn" aria-label="Notes about the picture">{notes.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        <FrameEditor key={open} frameId={open} s={s} notify={notify} onBack={back} onDeleted={back} />
      </>
    );
  }

  return (
    <>
      <Hint>Frames you add here belong to the event picked in the list above. Each frame is a picture with see-through (transparent) holes where the guests{'\u2019'} photos go. The app finds the holes by itself.</Hint>
      <div className="lv-group" data-event-frames={eventId}>
        <div className="lv-head">
          <h5 className="lv-h">FRAME GROUP: {title} <small>{frames.length}</small></h5>
          <div className="lv-acts">
            <button type="button" className="btn ghost" disabled={busy || shownCount === frames.length} onClick={() => void setAll(true)} aria-label={`SHOW ALL FRAMES OF ${title}`}>SHOW ALL</button>
            <button type="button" className="btn ghost" disabled={busy || shownCount === 0} onClick={() => void setAll(false)} aria-label={`HIDE ALL FRAMES OF ${title}`}>HIDE ALL</button>
          </div>
        </div>
        {frames.length === 0 && !adding && <Hint>No frames in this event yet. Press ADD FRAME.</Hint>}
        <ul className="fg-grid" aria-label={`Frames of ${title}`}>
          {frames.map((f) => {
            const shown = customEnabled(f.id), label = f.name.toUpperCase(), lay = thumbLayout(customLayouts(f.id), CUSTOM_LAYOUT_IDS);
            return (
              <li key={f.id} className="fg-tile" data-shown={shown ? 'true' : 'false'} data-event-frame={f.id}>
                <button type="button" className="fg-thumb fg-open" aria-label={`EDIT FRAME ${label}`} onClick={() => { setNotes([]); setEditing(f.id); }}>
                  {lay ? <FramePreview frameId={f.id} layoutId={lay} /> : <span className="cf-none-s">NO PICTURES</span>}
                </button>
                <button type="button" className="fg-name fg-open" onClick={() => { setNotes([]); setEditing(f.id); }}>{label}</button>
                <Switch label={`SHOW FRAME ${label}`} checked={shown} disabled={busy} onChange={(v) => void toggle(f.id, label, v)} />
              </li>
            );
          })}
          <li className="fg-tile fg-add">
            <button type="button" className="btn ghost" disabled={busy || adding} onClick={() => { setAdding(true); setErrors([]); }}><Icon name="frame" />ADD FRAME</button>
          </li>
        </ul>
      </div>

      {adding && (
        <div className={over ? 'cf-new ef-add over' : 'cf-new ef-add'} data-add-panel="true"
          onDragOver={(e) => { e.preventDefault(); if (!over) setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer?.files?.[0]; if (f) { setFile(f); setErrors([]); } }}>
          <label className={errors.length ? 'field has-err' : 'field'}>
            <span className="field-top"><span className="field-l">FRAME NAME</span><span className="field-n">{name.trim().length}/{NAME_MAX}</span></span>
            <input className="adm-in" value={name} placeholder="E.G. DANCE FLOOR" aria-label="FRAME NAME" onChange={(e) => { setName(e.target.value); setErrors([]); }} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
          </label>
          <div className="field">
            <span className="field-top"><span className="field-l">LAYOUT OF THIS PICTURE</span></span>
            <div className="seg" role="radiogroup" aria-label="LAYOUT OF THIS PICTURE">
              {CUSTOM_LAYOUT_IDS.map((l) => (
                <button key={l} type="button" role="radio" aria-checked={layoutId === l} className="seg-o" disabled={busy} onClick={() => { setLayoutId(l); setErrors([]); }}>{layoutLabel(l)}</button>
              ))}
            </div>
          </div>
          <div className="ef-pick">
            <label className="btn ghost cf-up">
              <Icon name="up" />{file ? 'CHOOSE ANOTHER PICTURE' : 'CHOOSE PICTURE'}
              <input type="file" className="cf-file" accept={ACCEPT} disabled={busy} aria-label="CHOOSE PICTURE" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) { setFile(f); setErrors([]); } }} />
            </label>
            <small className="ef-file">{file ? `PICTURE CHOSEN${(file as File).name ? `: ${(file as File).name}` : ''}` : 'NO PICTURE CHOSEN YET. YOU CAN ALSO DROP A FILE HERE'}</small>
          </div>
          <SpecHints />
          {errors.length > 0 && <ul className="cf-err" role="alert">{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>}
          <div className="test-actions">
            <button type="button" className="btn" disabled={busy || !cleanName(name) || !file} onClick={() => void save()}>{busy ? 'CHECKING' : 'SAVE FRAME'}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={closeAdd}>CANCEL</button>
          </div>
          <Hint>The frame is added only if the picture passes the check. Press SAVE FRAME, then add the other layouts from the frame page.</Hint>
        </div>
      )}

      <Hint>A frame is offered to guests when it is SHOWN, whichever event is active.</Hint>

      {loose.length > 0 && (
        <div className="lv-group" data-unassigned-frames="true">
          <div className="lv-head"><h5 className="lv-h">UNASSIGNED FRAMES <small>{loose.length}</small></h5></div>
          <Hint>These event frames were made before frame groups existed, or their event was deleted. Guests still get them while they are SHOWN. Move each one into {title}, or leave it here.</Hint>
          <ul className="lv-kids lv-flat cf-list" aria-label="Unassigned frames">
            {loose.map((f) => (
              <li key={f.id} className="cf-row" data-unassigned-frame={f.id}>
                <div className="row-l"><span>{f.name.toUpperCase()}</span><small>{customEnabled(f.id) ? 'SHOWN TO GUESTS' : 'HIDDEN FROM GUESTS'}</small></div>
                <div className="lv-acts cf-acts">
                  <button type="button" className="btn ghost" disabled={busy} aria-label={`MOVE ${f.name.toUpperCase()} TO THIS EVENT`} onClick={() => void move(f.id, f.name.toUpperCase())}>MOVE TO THIS EVENT</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** ADMIN > Events (second card): the frame group of the selected event. */
export const eventFramesCard: CardDef = {
  id: 'events-frames',
  title: 'Event frames',
  description: 'The frames of the event picked above. Add pictures and switch each frame on or off for guests.',
  keywords: ['event special', 'special frames', 'special', 'event frame', 'event frames', 'frame group', 'group', 'add frame', 'grid', 'shown', 'hidden', 'show all', 'hide all', 'unassigned', 'move', ...KEYWORDS],
  render: (c) => <EventFrames {...c} />
};
