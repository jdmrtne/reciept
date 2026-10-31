import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import { DEFAULT_EVENT_NAME } from '../../config/settings';
import { finalText } from '../../config/events';
import { FramePreview } from '../../frames/FrameLayer';
import { customRecords, customVersion, deleteCustomFrame, subscribeCustom } from '../../frames/custom/runtime';
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
  OLD_FRAMES_HELP, addedNotice, copiedNotice, copySummary, deleteLayoutBody, looseTiles, moveTargets, nameProblem, replaceNotes, shownCount, tileOf, tilesOfEvent, toggleNotice, type LayoutTile
} from './eventLayoutsAdmin';
import { ConfirmDialog, Hint, Switch } from './ui';
import type { CustomFrameDef } from '../../frames/custom/types';
import type { AdminCtx, CardDef } from './types';

/**
 * ADMIN > Events > Event layouts (EL-4): every picture uploaded for an event is a LAYOUT of its own (its photo windows are found
 * from the transparent holes). The grid copies ADMIN > Frames (`.fg-*`). A layout is offered to guests only while its event is the
 * ACTIVE one AND its own SHOWN / HIDDEN switch is on, so two events never show their specials at once.
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
  const [askFrame, setAskFrame] = useState<CustomFrameDef | null>(null);
  const [looseTarget, setLooseTarget] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null); // the layout whose settings page is open (null = the grid)
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []); // re-armed on remount (StrictMode)
  const modules = useMemo(() => qrModulesFor(s), [s.share.publicBaseUrl, s.share.enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void initEventLayouts(); }, []); // idempotent: the kiosk already started it; this only covers a screen opened first

  const status = getEventLayoutStatus();
  if (status === 'unavailable') return <Hint important>{MESSAGES.unavailable}</Hint>;
  if (status === 'idle' || status === 'loading') return <Hint important>Loading your layouts.</Hint>;

  const defs = eventLayoutRecords();
  const tiles = tilesOfEvent(defs, eventId);
  const loose = looseTiles(defs, s.events.map((e) => e.id));
  const title = eventName.toUpperCase();
  const shown = shownCount(tiles);
  const others = (current: string) => moveTargets(s.events, current, nameOf);

  // A layout that was deleted or moved to another event closes its own page by itself.
  const openDef = openId ? defs.find((d) => d.id === openId && d.eventId === eventId) : undefined;
  const openAsset = openDef ? eventLayoutAsset(openDef.id) : null;

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

  /** Delete one OLD event frame (the upload card for them is gone). Its layouts copies are separate and stay. */
  const removeFrame = (f: CustomFrameDef) => run(async () => {
    const r = await deleteCustomFrame(f.id);
    if (!alive.current) return;
    setAskFrame(null);
    notify(r.ok ? 'success' : 'error', r.ok ? `FRAME ${f.name.toUpperCase()} DELETED` : 'FRAME NOT DELETED');
  });

  const remove = (t: LayoutTile) => run(async () => {
    const r = await deleteEventLayoutRecord(t.id);
    if (!alive.current) return;
    setAsk(null);
    if (r.ok) setOpenId(null);
    notify(r.ok ? 'success' : 'error', r.ok ? `LAYOUT ${t.label} DELETED` : 'LAYOUT NOT DELETED');
  });

  /** The grid tile: the picture, its name and the SHOWN switch, nothing else. Tapping the picture or the name opens the layout's settings page. */
  const open = (id: string) => { setOpenId(id); setNotes([]); setTileErr(null); closeMode(); };
  const tile = (t: LayoutTile) => (
    <li key={t.id} className="fg-tile el-tile" data-shown={t.shown ? 'true' : 'false'} data-event-layout={t.id}>
      <button type="button" className="fg-thumb fg-open" aria-label={`OPEN SETTINGS OF ${t.label}`} onClick={() => open(t.id)}><FramePreview frameId={t.id} layoutId={t.id} /></button>
      <button type="button" className="fg-name fg-open" onClick={() => open(t.id)}>{t.label}</button>
      <Switch label={`SHOW LAYOUT ${t.label}`} checked={t.shown} disabled={busy} onChange={(v) => void toggle(t, v)} />
    </li>
  );

  /** The settings page of one layout. It opens on the QR view (spot editor + how it prints); the other buttons sit below it. */
  const settings = (t: LayoutTile) => {
    const def = openDef!, editing = mode && mode.id === t.id ? mode.kind : null;
    const dests = others(t.eventId);
    const problems = tileErr && tileErr.id === t.id ? tileErr.errors : [];
    const side = (
      <div className="el-side">
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
          ? <Hint important>There is no other event to move this layout to. Create one in the Event List first.</Hint>
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
        <button type="button" className="btn ghost" disabled={busy} aria-label={`RENAME ${t.label}`} onClick={() => { setMode({ id: t.id, kind: 'rename' }); setTyped(def.name); setTileErr(null); }}>RENAME</button>
        <label className={busy ? 'btn ghost cf-up disabled' : 'btn ghost cf-up'}>
          <Icon name="up" />REPLACE PICTURE
          <input type="file" className="cf-file" accept={ACCEPT} disabled={busy} aria-label={`REPLACE PICTURE OF ${t.label}`} onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void replace(t, f); }} />
        </label>
        <button type="button" className="btn ghost" disabled={busy} aria-label={`MOVE ${t.label} TO ANOTHER EVENT`} onClick={() => { setMode({ id: t.id, kind: 'move' }); setTarget(''); setTileErr(null); }}>MOVE</button>
        <button type="button" className="btn ghost" disabled={busy} aria-label={`DELETE ${t.label}`} onClick={() => setAsk(t)}>DELETE</button>
      </div>
    )}
      </div>
    );
    return (
      <div className="el-detail" data-layout-settings={t.id}>
        <div className="lv-head">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => { setOpenId(null); closeMode(); setTileErr(null); setNotes([]); }}><Icon name="close" />BACK TO LAYOUTS</button>
          <h5 className="lv-h">{t.label} <small data-layout-photos={t.photos}>{t.photoText}</small></h5>
        </div>
        {notes.length > 0 && <ul className="cf-warn" aria-label="Notes about the picture">{notes.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        {openAsset ? (
          <figure className="cf-prev el-qr" data-qr-editor={t.id}>
            <figcaption>QR SPOT: the numbered outlines show where the photos go. The colours are only placeholders. <span data-layout-qr={def.art.qr ? 'set' : 'none'}>{def.art.qr ? 'QR SPOT SET' : 'NO QR SPOT'}</span></figcaption>
            <QrSpotEditor key={t.id} art={def.art} spotKey={`${t.id}:${def.art.rev ?? ''}`} src={openAsset.src} meta={openAsset.meta} modules={modules} inset={EVENT_SPOT_INSET} shareEnabled={s.share.enabled}
              disabled={busy} label={t.label} noun="layout" onSave={saveSpot(t.id)} notify={notify}
              how={<><small>HOW IT PRINTS (SAMPLE QR)</small><div className="lv-thumb"><FramePreview frameId={t.id} layoutId={t.id} qr /></div>{side}</>} />
          </figure>
        ) : <><Hint important>The picture of this layout is not ready. Go back and open it again.</Hint>{side}</>}
        {problems.length > 0 && <ul className="cf-err" role="alert">{problems.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      </div>
    );
  };

  const dialogs = (
    <>
      {askFrame && <ConfirmDialog title="DELETE THIS OLD FRAME?" body={`${askFrame.name.toUpperCase()} and its pictures will be removed from this device. Layouts you copied from it are kept. This cannot be undone.`} confirmLabel="DELETE FRAME" cancelLabel="KEEP FRAME" danger onConfirm={() => void removeFrame(askFrame)} onCancel={() => setAskFrame(null)} />}
      {ask && <ConfirmDialog title="DELETE THIS LAYOUT?" body={deleteLayoutBody(ask.label)} confirmLabel="DELETE LAYOUT" cancelLabel="KEEP LAYOUT" danger onConfirm={() => void remove(ask)} onCancel={() => setAsk(null)} />}
    </>
  );

  if (openDef) return <>{settings(tileOf(openDef))}{dialogs}</>;

  return (
    <>
      <Hint>Each picture you add becomes a layout of the event picked above. Tap a layout to open its settings. Pictures need see-through holes where the guests{'\u2019'} photos go; the app finds and counts them.</Hint>
      {notes.length > 0 && <ul className="cf-warn" aria-label="Notes about the picture">{notes.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      <div className="lv-group" data-event-layouts={eventId}>
        <div className="lv-head">
          <h5 className="lv-h">EVENT LAYOUTS: {title} <small>{tiles.length}</small></h5>
          <div className="lv-acts">
            <button type="button" className="btn ghost" disabled={busy || shown === tiles.length} onClick={() => void setAll(true)} aria-label={`SHOW ALL LAYOUTS OF ${title}`}>SHOW ALL</button>
            <button type="button" className="btn ghost" disabled={busy || shown === 0} onClick={() => void setAll(false)} aria-label={`HIDE ALL LAYOUTS OF ${title}`}>HIDE ALL</button>
          </div>
        </div>
        {tiles.length === 0 && !adding && <Hint important>No layouts in this event yet. Press ADD LAYOUT.</Hint>}
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
          <Hint>PNG or WebP, {LIMITS.minWidth} to {LIMITS.maxWidth} pixels wide ({LIMITS.recommendedWidth} is best), up to {Math.round(LIMITS.maxFileBytes / 1048576)} MB. 1 to {LIMITS.maxWindows} plain, fully transparent rectangular holes, one per photo, with a little picture around each. Holes touching the edge are ignored.</Hint>
          {errors.length > 0 && <ul className="cf-err" role="alert">{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>}
          <div className="test-actions">
            <button type="button" className="btn" disabled={busy || !cleanName(name) || !file} onClick={() => void save()}>{busy ? 'CHECKING' : 'SAVE LAYOUT'}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={closeAdd}>CANCEL</button>
          </div>
        </div>
      )}

      <Hint>Guests see a layout when it is SHOWN and its event is ACTIVE.</Hint>

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
                    <button type="button" className="btn ghost" disabled={busy} aria-label={`DELETE FRAME ${f.name.toUpperCase()}`} onClick={() => setAskFrame(f)}>DELETE FRAME</button>
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
          <Hint>These layouts belong to no event, because their event was deleted. Guests do not get them until you give each one an event.</Hint>
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

      {dialogs}
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
