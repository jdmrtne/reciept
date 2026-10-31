import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import { DEFAULT_EVENT_NAME } from '../../config/settings';
import { finalText } from '../../config/events';
import { FramePreview } from '../../frames/FrameLayer';
import { customRecords, customVersion, subscribeCustom } from '../../frames/custom/runtime';
import { framesOfEvent, unassignedSpecialFrames } from '../../frames/custom/groups';
import { convertEventFrame, planConversion } from '../../frames/custom/convertEventFrame';
import { getLayout } from '../../layouts/registry';
import { MESSAGES, NAME_MAX, cleanName } from '../../frames/custom/store';
import { LIMITS } from '../../frames/custom/validate';
import { addEventLayout } from '../../frames/custom/addEventLayout';
import { replaceEventLayoutArt } from '../../frames/custom/replaceEventLayout';
import {
  deleteEventLayoutRecord, eventLayoutRecords, eventLayoutVersion, getEventLayoutStatus, initEventLayouts,
  eventLayoutAsset, renameEventLayoutRecord, setEventLayoutRecordEnabled, setEventLayoutRecordEvent, setEventLayoutRecordQr, subscribeEventLayouts
} from '../../frames/custom/eventRuntime';
import { KEYWORDS } from './CustomFramesSection';
import { QrSpotEditor, qrModulesFor, type SaveSpot } from './QrSpotEditor';
import { EVENT_SPOT_INSET } from '../../frames/custom/qrArea';
import { eventEditorStore, selectedProfile, type EditorState } from './eventEditor';
import {
  OLD_FRAMES_HELP, addedNotice, copiedNotice, copySummary, deleteLayoutBody, looseTiles, moveTargets, nameProblem, replaceNotes, shownCount, tilesOfEvent, toggleNotice, type LayoutTile
} from './eventLayoutsAdmin';
import { ConfirmDialog, Hint, Switch } from './ui';
import type { CustomFrameDef } from '../../frames/custom/types';
import type { AdminCtx, CardDef } from './types';

/**
 * ADMIN > Events > Event layouts (EL-4): every picture uploaded for an event is a LAYOUT of its own (its photo windows are found
 * from the transparent holes). The grid copies ADMIN > Frames (`.fg-*`). Whether guests get a layout depends only on its own
 * SHOWN / HIDDEN switch, never on which event is active. The old event special frames stay in the card above until Phase 6.
 */

const useEditor = (): EditorState => useSyncExternalStore(eventEditorStore.subscribe, eventEditorStore.get, eventEditorStore.get);
const ACCEPT = 'image/png,image/webp';
const nameOf = (e: { name: string }) => finalText(e.name) || DEFAULT_EVENT_NAME;

type Mode = { id: string; kind: 'rename' | 'move' } | null;

/** Picks the selected event and starts the body fresh whenever that changes (closed panels, no half-typed name). */
function EventLayouts(c: AdminCtx) {
  const profile = selectedProfile(c.s, useEditor());
  return <EventLayoutsBody key={profile.id} {...c} eventId={profile.id} eventName={nameOf(profile)} />;
}

function EventLayoutsBody({ s, notify, eventId, eventName }: AdminCtx & { eventId: string; eventName: string }) {
  useSyncExternalStore(subscribeEventLayouts, eventLayoutVersion, eventLayoutVersion); // re-render on every registry change
  useSyncExternalStore(subscribeCustom, customVersion, customVersion); // the old event frames (copy source)
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [file, setFile] = useState<Blob | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [typed, setTyped] = useState('');
  const [target, setTarget] = useState('');
  const [tileErr, setTileErr] = useState<{ id: string; errors: string[] } | null>(null);
  const [ask, setAsk] = useState<LayoutTile | null>(null);
  const [looseTarget, setLooseTarget] = useState<Record<string, string>>({});
  const [qrId, setQrId] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []); // re-armed on remount (StrictMode)
  const modules = useMemo(() => qrModulesFor(s), [s.share.publicBaseUrl, s.share.enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void initEventLayouts(); }, []); // idempotent: the kiosk already started it; this only covers a screen opened first

  const status = getEventLayoutStatus();
  if (status === 'unavailable') return <Hint>{MESSAGES.unavailable}</Hint>;
  if (status === 'idle' || status === 'loading') return <Hint>Loading your layouts.</Hint>;

  const defs = eventLayoutRecords();
  const tiles = tilesOfEvent(defs, eventId);
  const loose = looseTiles(defs, s.events.map((e) => e.id));
  const title = eventName.toUpperCase();
  const shown = shownCount(tiles);
  const others = (current: string) => moveTargets(s.events, current, nameOf);

  const qrDef = qrId ? defs.find((d) => d.id === qrId) : undefined;
  const qrAsset = qrDef ? eventLayoutAsset(qrDef.id) : null;

  const oldFrames = [...framesOfEvent(customRecords(), eventId), ...unassignedSpecialFrames(customRecords(), s.events.map((e) => e.id))];

  const closeAdd = () => { setAdding(false); setName(''); setFile(null); setErrors([]); setOver(false); };
  const closeMode = () => { setMode(null); setTyped(''); setTarget(''); };

  /** One action at a time. Anything async re-checks `alive` before it touches state. */
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { if (alive.current) setBusy(false); }
  };

  const save = () => run(async () => {
    setErrors([]);
    const r = await addEventLayout({ eventId, name, file });
    if (!alive.current) return;
    if (!r.ok) { setErrors(r.errors); notify('error', 'LAYOUT NOT ADDED'); return; }
    closeAdd(); setNotes(r.warnings);
    notify('success', addedNotice(r.name.toUpperCase(), r.windows));
  });

  const toggle = (t: LayoutTile, on: boolean) => run(async () => {
    const r = await setEventLayoutRecordEnabled(t.id, on);
    if (!alive.current) return;
    notify(r.ok ? 'success' : 'error', r.ok ? toggleNotice(t.label, on) : 'COULD NOT CHANGE THIS LAYOUT');
  });

  const setAll = (on: boolean) => run(async () => {
    let failed = 0;
    for (const t of tiles) if (t.shown !== on && !(await setEventLayoutRecordEnabled(t.id, on)).ok) failed++;
    if (!alive.current) return;
    if (failed) notify('error', `${failed} ${failed === 1 ? 'LAYOUT' : 'LAYOUTS'} COULD NOT BE CHANGED`);
    else notify('success', on ? 'ALL LAYOUTS OF THIS EVENT ARE SHOWN' : 'ALL LAYOUTS OF THIS EVENT ARE HIDDEN');
  });

  const rename = (t: LayoutTile) => run(async () => {
    const problem = nameProblem(typed);
    if (problem) { setTileErr({ id: t.id, errors: [problem] }); return; }
    const r = await renameEventLayoutRecord(t.id, typed);
    if (!alive.current) return;
    if (!r.ok) { setTileErr({ id: t.id, errors: [r.message] }); notify('error', 'LAYOUT NOT RENAMED'); return; }
    closeMode(); setTileErr(null);
    notify('success', `LAYOUT IS NOW CALLED ${r.value.name.toUpperCase()}`);
  });

  const move = (t: LayoutTile, to: string, toLabel: string) => run(async () => {
    const r = await setEventLayoutRecordEvent(t.id, to);
    if (!alive.current) return;
    if (!r.ok) { setTileErr({ id: t.id, errors: [r.message] }); notify('error', 'LAYOUT NOT MOVED'); return; }
    closeMode(); setTileErr(null);
    notify('success', `${t.label} IS NOW IN ${toLabel}`);
  });

  const replace = (t: LayoutTile, f: Blob) => run(async () => {
    setTileErr(null); setNotes([]);
    const r = await replaceEventLayoutArt(t.id, f);
    if (!alive.current) return;
    if (!r.ok) { setTileErr({ id: t.id, errors: r.errors }); notify('error', 'PICTURE NOT REPLACED'); return; }
    setNotes(replaceNotes(r.hadQrSpot, r.warnings));
    notify('success', `PICTURE OF ${t.label} REPLACED: ${r.windows} ${r.windows === 1 ? 'PHOTO WINDOW' : 'PHOTO WINDOWS'} FOUND`);
  });

  /** The QR spot of one layout. The spot is saved inset (EVENT_SPOT_INSET) so the QR code always has clear paper around it. */
  const saveSpot = (id: string): SaveSpot => async (area) => {
    setBusy(true);
    try {
      const r = await setEventLayoutRecordQr(id, area);
      return r.ok ? { ok: true } : { ok: false, message: r.message };
    } finally { if (alive.current) setBusy(false); }
  };

  /** Copy one old event frame into hidden layouts of the picked event. The frame is never changed. */
  const copyFrame = (frame: CustomFrameDef) => run(async () => {
    const r = await convertEventFrame(frame, eventId, defs, (l) => getLayout(l).name);
    if (!alive.current) return;
    notify(r.failed.length ? 'error' : 'success', copiedNotice(r.created.length, r.skipped, r.failed.length));
  });

  const remove = (t: LayoutTile) => run(async () => {
    const r = await deleteEventLayoutRecord(t.id);
    if (!alive.current) return;
    setAsk(null);
    notify(r.ok ? 'success' : 'error', r.ok ? `LAYOUT ${t.label} DELETED` : 'LAYOUT NOT DELETED');
  });

  const tile = (t: LayoutTile) => {
    const editing = mode && mode.id === t.id ? mode.kind : null;
    const dests = others(t.eventId);
    const problems = tileErr && tileErr.id === t.id ? tileErr.errors : [];
    return (
      <li key={t.id} className="fg-tile el-tile" data-shown={t.shown ? 'true' : 'false'} data-event-layout={t.id}>
        <div className="fg-thumb"><FramePreview frameId={t.id} layoutId={t.id} /></div>
        <span className="fg-name">{t.label}</span>
        <small className="ef-file" data-layout-photos={t.photos}>{t.photoText}</small>
        <small className="ef-file" data-layout-qr={defs.find((d) => d.id === t.id)?.art.qr ? 'set' : 'none'}>{defs.find((d) => d.id === t.id)?.art.qr ? 'QR SPOT SET' : 'NO QR SPOT'}</small>
        <Switch label={`SHOW LAYOUT ${t.label}`} checked={t.shown} disabled={busy} onChange={(v) => void toggle(t, v)} />
        {editing === 'rename' && (
          <div className="el-panel">
            <input className="adm-in" value={typed} maxLength={NAME_MAX} aria-label={`NEW NAME FOR ${t.label}`} onChange={(e) => { setTyped(e.target.value); setTileErr(null); }} onKeyDown={(e) => { if (e.key === 'Enter') void rename(t); }} />
            <div className="el-acts">
              <button type="button" className="btn" disabled={busy || !cleanName(typed)} onClick={() => void rename(t)}>SAVE NAME</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => { closeMode(); setTileErr(null); }}>CANCEL</button>
            </div>
          </div>
        )}
        {editing === 'move' && (
          <div className="el-panel">
            {dests.length === 0
              ? <Hint>There is no other event to move this layout to. Create one in the Event List first.</Hint>
              : <select className="adm-in" value={target} aria-label={`MOVE ${t.label} TO`} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">PICK AN EVENT</option>
                  {dests.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>}
            <div className="el-acts">
              <button type="button" className="btn" disabled={busy || !target} onClick={() => void move(t, target, dests.find((d) => d.id === target)?.label ?? '')}>MOVE LAYOUT</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={closeMode}>CANCEL</button>
            </div>
          </div>
        )}
        {!editing && (
          <div className="el-acts">
            <button type="button" className="btn ghost" disabled={busy} aria-label={`RENAME ${t.label}`} onClick={() => { setMode({ id: t.id, kind: 'rename' }); setTyped(defs.find((d) => d.id === t.id)?.name ?? ''); setTileErr(null); }}>RENAME</button>
            <label className={busy ? 'btn ghost cf-up disabled' : 'btn ghost cf-up'}>
              <Icon name="up" />REPLACE PICTURE
              <input type="file" className="cf-file" accept={ACCEPT} disabled={busy} aria-label={`REPLACE PICTURE OF ${t.label}`} onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void replace(t, f); }} />
            </label>
            <button type="button" className="btn ghost" disabled={busy} aria-label={`QR SPOT OF ${t.label}`} aria-pressed={qrId === t.id} onClick={() => setQrId(qrId === t.id ? null : t.id)}>QR SPOT</button>
            <button type="button" className="btn ghost" disabled={busy} aria-label={`MOVE ${t.label} TO ANOTHER EVENT`} onClick={() => { setMode({ id: t.id, kind: 'move' }); setTarget(''); setTileErr(null); }}>MOVE</button>
            <button type="button" className="btn ghost" disabled={busy} aria-label={`DELETE ${t.label}`} onClick={() => setAsk(t)}>DELETE</button>
          </div>
        )}
        {problems.length > 0 && <ul className="cf-err" role="alert">{problems.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      </li>
    );
  };

  return (
    <>
      <Hint>Every picture you add here becomes a layout of the event picked in the list above. Each picture needs see through (transparent) holes where the guests{'\u2019'} photos go. The app finds the holes by itself and counts them: that is the number of photos the layout takes.</Hint>
      {notes.length > 0 && <ul className="cf-warn" aria-label="Notes about the picture">{notes.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      <div className="lv-group" data-event-layouts={eventId}>
        <div className="lv-head">
          <h5 className="lv-h">EVENT LAYOUTS: {title} <small>{tiles.length}</small></h5>
          <div className="lv-acts">
            <button type="button" className="btn ghost" disabled={busy || shown === tiles.length} onClick={() => void setAll(true)} aria-label={`SHOW ALL LAYOUTS OF ${title}`}>SHOW ALL</button>
            <button type="button" className="btn ghost" disabled={busy || shown === 0} onClick={() => void setAll(false)} aria-label={`HIDE ALL LAYOUTS OF ${title}`}>HIDE ALL</button>
          </div>
        </div>
        {tiles.length === 0 && !adding && <Hint>No layouts in this event yet. Press ADD LAYOUT.</Hint>}
        <ul className="fg-grid" aria-label={`Layouts of ${title}`}>
          {tiles.map(tile)}
          <li className="fg-tile fg-add">
            <button type="button" className="btn ghost" disabled={busy || adding} onClick={() => { setAdding(true); setErrors([]); setNotes([]); }}><Icon name="frame" />ADD LAYOUT</button>
          </li>
        </ul>
      </div>

      {adding && (
        <div className={over ? 'cf-new ef-add over' : 'cf-new ef-add'} data-add-panel="true"
          onDragOver={(e) => { e.preventDefault(); if (!over) setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer?.files?.[0]; if (f) { setFile(f); setErrors([]); } }}>
          <label className={errors.length ? 'field has-err' : 'field'}>
            <span className="field-top"><span className="field-l">LAYOUT NAME</span><span className="field-n">{name.trim().length}/{NAME_MAX}</span></span>
            <input className="adm-in" value={name} placeholder="E.G. DANCE FLOOR" aria-label="LAYOUT NAME" onChange={(e) => { setName(e.target.value); setErrors([]); }} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
          </label>
          <div className="ef-pick">
            <label className="btn ghost cf-up">
              <Icon name="up" />{file ? 'CHOOSE ANOTHER PICTURE' : 'CHOOSE PICTURE'}
              <input type="file" className="cf-file" accept={ACCEPT} disabled={busy} aria-label="CHOOSE PICTURE" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) { setFile(f); setErrors([]); } }} />
            </label>
            <small className="ef-file">{file ? `PICTURE CHOSEN${(file as File).name ? `: ${(file as File).name}` : ''}` : 'NO PICTURE CHOSEN YET. YOU CAN ALSO DROP A FILE HERE'}</small>
          </div>
          <Hint>PNG or WebP, {LIMITS.minWidth} to {LIMITS.maxWidth} pixels wide ({LIMITS.recommendedWidth} is best), up to {Math.round(LIMITS.maxFileBytes / 1048576)} MB. Make 1 to {LIMITS.maxWindows} holes, one for each photo. Each hole must be a plain rectangle, fully transparent, with a little picture all around it. A hole that touches the edge of the picture is ignored.</Hint>
          {errors.length > 0 && <ul className="cf-err" role="alert">{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>}
          <div className="test-actions">
            <button type="button" className="btn" disabled={busy || !cleanName(name) || !file} onClick={() => void save()}>{busy ? 'CHECKING' : 'SAVE LAYOUT'}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={closeAdd}>CANCEL</button>
          </div>
          <Hint>The layout is added only if the picture passes the check.</Hint>
        </div>
      )}

      {qrDef && qrAsset && (
        <figure className="cf-prev el-qr" data-qr-editor={qrDef.id}>
          <figcaption>QR SPOT OF {qrDef.name.toUpperCase()}: the numbered outlines show where the photos go. The colours are only placeholders.</figcaption>
          <QrSpotEditor key={qrDef.id} art={qrDef.art} spotKey={`${qrDef.id}:${qrDef.art.rev ?? ''}`} src={qrAsset.src} meta={qrAsset.meta} modules={modules} inset={EVENT_SPOT_INSET} shareEnabled={s.share.enabled}
            disabled={busy} label={qrDef.name.toUpperCase()} noun="layout" onSave={saveSpot(qrDef.id)} notify={notify}
            how={<><small>HOW IT PRINTS (SAMPLE QR)</small><div className="lv-thumb"><FramePreview frameId={qrDef.id} layoutId={qrDef.id} qr /></div></>} />
          <div className="el-acts"><button type="button" className="btn ghost" disabled={busy} onClick={() => setQrId(null)}>CLOSE QR SPOT</button></div>
        </figure>
      )}

      <Hint>A layout is offered to guests when it is SHOWN, whichever event is active. It is only ever used with its own picture.</Hint>

      {oldFrames.length > 0 && (
        <div className="lv-group" data-old-event-frames="true">
          <div className="lv-head"><h5 className="lv-h">OLD EVENT FRAMES: {title} <small>{oldFrames.length}</small></h5></div>
          <Hint>{OLD_FRAMES_HELP}</Hint>
          <ul className="lv-kids lv-flat cf-list" aria-label="Old event frames">
            {oldFrames.map((f) => {
              const plan = planConversion(f, defs, (l) => getLayout(l).name);
              return (
                <li key={f.id} className="cf-row" data-old-frame={f.id}>
                  <div className="row-l"><span>{f.name.toUpperCase()}</span><small>{copySummary(plan.total, plan.done)}</small></div>
                  <div className="lv-acts cf-acts">
                    <button type="button" className="btn ghost" disabled={busy || plan.items.length === 0} aria-label={`COPY ${f.name.toUpperCase()} TO LAYOUTS`} onClick={() => void copyFrame(f)}>COPY TO LAYOUTS</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {loose.length > 0 && (
        <div className="lv-group" data-unassigned-layouts="true">
          <div className="lv-head"><h5 className="lv-h">UNASSIGNED LAYOUTS <small>{loose.length}</small></h5></div>
          <Hint>These layouts belong to no event, because their event was deleted. Guests still get them while they are SHOWN. Give each one an event, or leave it here.</Hint>
          <ul className="lv-kids lv-flat cf-list" aria-label="Unassigned layouts">
            {loose.map((t) => {
              const dests = others(''), pick = looseTarget[t.id] ?? eventId;
              return (
                <li key={t.id} className="cf-row" data-unassigned-layout={t.id}>
                  <div className="row-l"><span>{t.label}</span><small>{t.photoText}. {t.stateText}</small></div>
                  <div className="lv-acts cf-acts">
                    <select className="adm-in" value={pick} aria-label={`EVENT FOR ${t.label}`} onChange={(e) => setLooseTarget({ ...looseTarget, [t.id]: e.target.value })}>
                      {dests.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                    </select>
                    <button type="button" className="btn ghost" disabled={busy || !dests.some((d) => d.id === pick)} aria-label={`ASSIGN ${t.label} TO AN EVENT`} onClick={() => void move(t, pick, dests.find((d) => d.id === pick)?.label ?? '')}>ASSIGN</button>
                    <button type="button" className="btn ghost" disabled={busy} aria-label={`DELETE ${t.label}`} onClick={() => setAsk(t)}>DELETE</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {ask && <ConfirmDialog title="DELETE THIS LAYOUT?" body={deleteLayoutBody(ask.label)} confirmLabel="DELETE LAYOUT" cancelLabel="KEEP LAYOUT" danger onConfirm={() => void remove(ask)} onCancel={() => setAsk(null)} />}
    </>
  );
}

/** ADMIN > Events (third card): the event layouts of the selected event, and the unassigned ones. */
export const eventLayoutsCard: CardDef = {
  id: 'events-layouts', tab: 'uploads',
  title: 'Event layouts',
  description: 'The layouts of the event picked above. Add a picture to make a layout, set where its QR code prints, then switch each one on or off for guests.',
  keywords: ['event special', 'event layout', 'event layouts', 'special layout', 'special layouts', 'layout', 'layouts', 'add layout', 'photo windows', 'windows', 'photos', 'grid', 'shown', 'hidden', 'show all', 'hide all', 'rename', 'replace picture', 'replace', 'move', 'delete', 'unassigned', 'assign', 'qr spot', 'qr', 'qr code', 'old frames', 'copy to layouts', 'convert', 'draw spot', 'find empty space', 'clear spot', ...KEYWORDS],
  render: (c) => <EventLayouts {...c} />
};
