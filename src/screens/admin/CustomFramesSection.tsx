import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import type { BoothSettings } from '../../config/settings';
import { FramePreview } from '../../frames/FrameLayer';
import { MESSAGES, NAME_MAX, cleanName } from '../../frames/custom/store';
import {
  customAsset, customEnabled, customFrameDefs, customIsSpecial, customLayouts, customRecord, customVersion, deleteCustomFrame, getCustomStatus, isPersistent,
  removeCustomLayoutArt, renameCustomFrame, setCustomEnabled, setCustomLayoutArt, setCustomLayoutQr, subscribeCustom
} from '../../frames/custom/runtime';
import { prepareUpload } from '../../frames/custom/upload';
import { addOwnFrame } from '../../frames/custom/addOwnFrame';
import { thumbLayout } from '../../frames/custom/groups';
import { checkQrGeometry } from '../../frames/custom/qrArea';
import { CUSTOM_LAYOUT_IDS, LIMITS, requiredWindows } from '../../frames/custom/validate';
import type { CustomLayoutId } from '../../frames/custom/types';
import { getLayout } from '../../layouts/registry';
import { ConfirmDialog, Hint, Switch, SwitchRow } from './ui';
import { ArtPreview, FALLBACK_MODULES, QrSpotEditor, qrModulesFor, type SaveSpot } from './QrSpotEditor';
import type { AdminCtx, CardDef } from './types';

/** Owner-facing layout name, upper case like every other admin label. */
export const layoutLabel = (id: string): string => getLayout(id).name.toUpperCase();
const ACCEPT = 'image/png,image/webp';
export { ArtPreview, FALLBACK_MODULES, qrModulesFor };
const keyOf = (frameId: string, layoutId: string) => `${frameId}:${layoutId}`;

/** The picture rules (type, width, size, holes) and the "this browser may clear files" note. One text for every place that uploads a frame picture. */
export function SpecHints() {
  useSyncExternalStore(subscribeCustom, customVersion, customVersion); // isPersistent() changes after the first save
  return (
    <>
      <Hint>
        PNG or WebP, {LIMITS.minWidth} to {LIMITS.maxWidth} pixels wide ({LIMITS.recommendedWidth} is best), up to {Math.round(LIMITS.maxFileBytes / 1048576)} MB. One plain, fully see-through rectangular hole per photo, with a little picture around it.
      </Hint>
      {isPersistent() === false && <Hint important>This browser has not promised to keep these files. If the tablet runs very low on space it may clear them, so keep the original pictures somewhere safe.</Hint>}
    </>
  );
}

type Confirm = { kind: 'delete' } | { kind: 'remove'; layoutId: CustomLayoutId } | null;
/**
 * ONE custom frame: rename, delete, per-layout pictures (upload, replace, preview, remove) and the QR spot tools. Used by "Your own frames"
 * (ADMIN > Frames) and by the event frame groups (ADMIN > Events). It owns all of its own state, so a parent just mounts it with a frame id
 * (give it `key={frameId}` so switching frames starts clean). `onBack` adds a BACK TO GRID button, `onDeleted` runs after a successful delete,
 * `onBusyChange` tells the parent while a save is running.
 */
export function FrameEditor({ frameId, s, notify, onBack, onDeleted, onBusyChange }: Pick<AdminCtx, 's' | 'notify'> & { frameId: string; onBack?: () => void; onDeleted?: () => void; onBusyChange?: (busy: boolean) => void }) {
  useSyncExternalStore(subscribeCustom, customVersion, customVersion); // re-render on every registry change
  const rec = customRecord(frameId);
  const frame = rec ? { id: rec.id, name: rec.name } : null;
  const [nameErr, setNameErr] = useState('');
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string[]>>({});
  const [previewId, setPreviewId] = useState<CustomLayoutId | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []); // re-armed on remount (StrictMode runs the cleanup once in dev)
  const modules = useMemo(() => qrModulesFor(s), [s.share.publicBaseUrl, s.share.enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const tell = useRef(onBusyChange); tell.current = onBusyChange;
  useEffect(() => { tell.current?.(!!busy); }, [busy]);
  useEffect(() => () => { tell.current?.(false); }, []);

  const status = getCustomStatus();
  if (status === 'unavailable') return <Hint important>{MESSAGES.unavailable}</Hint>;
  if (status === 'idle' || status === 'loading') return <Hint important>Loading your frames.</Hint>;

  const setMsg = (key: string, errs: string[], warns: string[]) => { setProblems((p) => ({ ...p, [key]: errs })); setNotes((p) => ({ ...p, [key]: warns })); };

  const rename = async () => {
    if (!frame || renameDraft === null) return;
    const name = cleanName(renameDraft);
    if (!name) { setNameErr(`Type a name for the frame, up to ${NAME_MAX} characters.`); return; }
    setBusy('frame'); setNameErr('');
    try {
      const r = await renameCustomFrame(frame.id, name);
      if (!alive.current) return;
      if (!r.ok) { setNameErr(r.message); notify('error', 'FRAME NOT RENAMED'); return; }
      setRenameDraft(null); notify('success', 'FRAME RENAMED');
    } finally { if (alive.current) setBusy(null); }
  };

  const upload = async (frameId: string, layoutId: CustomLayoutId, file: Blob | null | undefined) => {
    if (!file || busy) return;
    const key = keyOf(frameId, layoutId), label = layoutLabel(layoutId);
    setBusy(key); setMsg(key, [], []);
    try {
      const r = await prepareUpload(layoutId, file);
      if (!alive.current) return;
      if (!r.ok) { setMsg(key, r.errors, []); notify('error', `${label} PICTURE NOT SAVED`); return; }
      const hadQr = !!customRecord(frameId)?.layouts[layoutId]?.qr;
      const saved = await setCustomLayoutArt(frameId, layoutId, r.art);
      if (!alive.current) return;
      if (!saved.ok) { setMsg(key, [saved.message], []); notify('error', `${label} PICTURE NOT SAVED`); return; }
      setMsg(key, [], hadQr ? [...r.warnings, 'The QR spot of the old picture was cleared. Open PREVIEW to set it again.'] : r.warnings); setPreviewId(layoutId);
      notify('success', `${label} PICTURE SAVED: ${r.art.windows.length} PHOTO ${r.art.windows.length === 1 ? 'WINDOW' : 'WINDOWS'} FOUND`);
    } finally { if (alive.current) setBusy(null); }
  };

  const removeArt = async (frameId: string, layoutId: CustomLayoutId) => {
    const key = keyOf(frameId, layoutId);
    setBusy(key); setMsg(key, [], []);
    try {
      const r = await removeCustomLayoutArt(frameId, layoutId);
      if (!alive.current) return;
      if (!r.ok) { setMsg(key, [r.message], []); notify('error', `${layoutLabel(layoutId)} PICTURE NOT REMOVED`); return; }
      if (previewId === layoutId) setPreviewId(null);
      notify('success', `${layoutLabel(layoutId)} PICTURE REMOVED. THE FRAME NO LONGER SHOWS ON THIS LAYOUT`);
    } finally { if (alive.current) setBusy(null); }
  };

  const toggle = async (frameId: string, on: boolean) => {
    setBusy('frame');
    try {
      const r = await setCustomEnabled(frameId, on);
      if (!alive.current) return;
      if (!r.ok) { notify('error', 'COULD NOT CHANGE THIS FRAME'); setNameErr(r.message); return; }
      notify('success', on ? `${r.value.name.toUpperCase()} IS ON. THE NEXT GUEST CAN PICK IT` : `${r.value.name.toUpperCase()} IS OFF. GUESTS NO LONGER SEE IT`);
    } finally { if (alive.current) setBusy(null); }
  };

  const removeFrame = async (frameId: string) => {
    setBusy('frame');
    try {
      const r = await deleteCustomFrame(frameId);
      if (!alive.current) return;
      if (!r.ok) { notify('error', 'FRAME NOT DELETED'); setNameErr(r.message); return; }
      setPreviewId(null); setRenameDraft(null);
      notify('success', 'FRAME DELETED');
      onDeleted?.();
    } finally { if (alive.current) setBusy(null); }
  };

  const have = (layoutId: CustomLayoutId) => !!rec?.layouts[layoutId];
  const offered = frame ? CUSTOM_LAYOUT_IDS.filter(have) : [];
  const previewLayout = frame && previewId && have(previewId) ? previewId : null;
  const previewAsset = frame && previewLayout ? customAsset(frame.id, previewLayout) : null;

  // ---- QR spot (Phase 5): draw, find, save, clear. Nothing is saved that placeQr would refuse. ----
  const previewArt = frame && previewLayout ? rec?.layouts[previewLayout] : undefined;
  const spotKey = frame && previewLayout && previewArt ? `${frame.id}:${previewLayout}:${previewArt.rev ?? ''}` : '';
  const saveSpot: SaveSpot = async (area) => {
    if (!frame || !previewLayout) return { ok: false, message: 'The QR spot could not be saved.' };
    setBusy(keyOf(frame.id, previewLayout));
    try {
      const r = await setCustomLayoutQr(frame.id, previewLayout, area);
      return r.ok ? { ok: true } : { ok: false, message: r.message };
    } finally { if (alive.current) setBusy(null); }
  };

  return (
    <>
      {frame && rec && (
        <div className="cf-frame" data-custom-frame={frame.id}>
          {onBack && <div className="cf-back"><button type="button" className="btn ghost" disabled={!!busy} onClick={onBack}><Icon name="back" />BACK TO GRID</button></div>}
          <div className="cf-head">
            <div className="lv-thumb cf-thumb">
              {offered.length > 0 ? <FramePreview frameId={frame.id} layoutId={offered[0]} /> : <div className="cf-none" aria-hidden="true">NO PICTURES YET</div>}
            </div>
            <div className="cf-name">
              {renameDraft === null ? (
                <>
                  <h5 className="lv-h">{frame.name.toUpperCase()}</h5>
                  <div className="lv-acts">
                    <button type="button" className="btn ghost" disabled={!!busy} onClick={() => { setRenameDraft(frame.name); setNameErr(''); }}>RENAME</button>
                    <button type="button" className="btn ghost danger" disabled={!!busy} onClick={() => setConfirm({ kind: 'delete' })}><Icon name="trash" />DELETE FRAME</button>
                  </div>
                </>
              ) : (
                <>
                  <label className={nameErr ? 'field has-err' : 'field'}>
                    <span className="field-top"><span className="field-l">FRAME NAME</span><span className="field-n">{renameDraft.trim().length}/{NAME_MAX}</span></span>
                    <input className="adm-in" value={renameDraft} aria-invalid={nameErr ? true : undefined} onChange={(e) => { setRenameDraft(e.target.value); setNameErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') void rename(); if (e.key === 'Escape') setRenameDraft(null); }} />
                    {nameErr && <small className="field-err" role="alert">{nameErr}</small>}
                  </label>
                  <div className="lv-acts">
                    <button type="button" className="btn" disabled={!!busy || renameDraft.trim() === frame.name} onClick={() => void rename()}>SAVE NAME</button>
                    <button type="button" className="btn ghost" disabled={!!busy} onClick={() => { setRenameDraft(null); setNameErr(''); }}>CANCEL</button>
                  </div>
                </>
              )}
              <small className="cf-offer" data-offered={offered.length}>
                {offered.length === 0 ? 'Guests cannot pick this frame yet. Add a picture for at least one layout.' : `Guests can pick this frame on: ${offered.map(layoutLabel).join(', ')}.`}
              </small>
            </div>
          </div>
          <SwitchRow label="SHOW THIS FRAME TO GUESTS" hint="ON: guests can pick it in the editor. OFF: hidden from guests, your pictures are kept." checked={customEnabled(frame.id)} disabled={!!busy} onChange={(v) => void toggle(frame.id, v)} />

          <ul className="lv-kids lv-flat cf-list" aria-label={`Pictures for ${frame.name}`}>
            {CUSTOM_LAYOUT_IDS.map((lid) => {
              const art = rec.layouts[lid], key = keyOf(frame.id, lid), label = layoutLabel(lid), need = requiredWindows(lid);
              const errs = problems[key] ?? [], warns = notes[key] ?? [], working = busy === key;
              return (
                <li key={lid} className={over === key ? 'cf-row over' : 'cf-row'} data-layout={lid} data-state={art ? 'ready' : 'missing'}
                  onDragOver={(e) => { e.preventDefault(); if (over !== key) setOver(key); }} onDragLeave={() => setOver((o) => (o === key ? null : o))}
                  onDrop={(e) => { e.preventDefault(); setOver(null); void upload(frame.id, lid, e.dataTransfer?.files?.[0]); }}>
                  <div className="row-l">
                    <span>{label}</span>
                    <small>{art ? `PICTURE ADDED: ${art.windows.length} PHOTO ${art.windows.length === 1 ? 'WINDOW' : 'WINDOWS'}, ${art.width} PX WIDE${art.qr ? ', QR SPOT SET' : ''}` : `MISSING: NEEDS ${need} PHOTO ${need === 1 ? 'WINDOW' : 'WINDOWS'}. GUESTS DO NOT SEE THIS FRAME ON THIS LAYOUT`}</small>
                  </div>
                  <div className="lv-acts cf-acts">
                    <label className="btn ghost cf-up">
                      <Icon name="up" />{working ? 'CHECKING' : art ? 'REPLACE' : 'UPLOAD'}
                      <input type="file" className="cf-file" accept={ACCEPT} disabled={!!busy} aria-label={`${art ? 'REPLACE' : 'UPLOAD'} ${label} PICTURE`}
                        onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void upload(frame.id, lid, f); }} />
                    </label>
                    {art && <button type="button" className="btn ghost" disabled={!!busy} aria-pressed={previewLayout === lid} aria-label={`PREVIEW ${label}`} onClick={() => setPreviewId(previewLayout === lid ? null : lid)}><Icon name="eye" />PREVIEW</button>}
                    {art && <button type="button" className="btn ghost" disabled={!!busy} aria-label={`REMOVE ${label} PICTURE`} onClick={() => setConfirm({ kind: 'remove', layoutId: lid })}><Icon name="trash" />REMOVE</button>}
                  </div>
                  {art?.qr && checkQrGeometry(art, art.qr, modules).length > 0 && <ul className="cf-err" role="alert" data-qr-warning="true"><li>The saved QR spot is too small for your current site address, so printing is blocked on this layout. Open PREVIEW and set a new spot, or clear it.</li></ul>}
                  {errs.length > 0 && <ul className="cf-err" role="alert">{errs.map((m, i) => <li key={i}>{m}</li>)}</ul>}
                  {warns.length > 0 && <ul className="cf-warn">{warns.map((m, i) => <li key={i}>{m}</li>)}</ul>}
                </li>
              );
            })}
          </ul>
          <Hint>You can also drop a file onto a row.</Hint>

          {previewAsset && previewLayout && (
            <figure className="cf-prev" data-preview={previewLayout}>
              <figcaption>{layoutLabel(previewLayout)}: the numbered outlines show where the photos go. The colours are only placeholders.</figcaption>
              {previewArt && (
                <QrSpotEditor art={previewArt} spotKey={spotKey} src={previewAsset.src} meta={previewAsset.meta} modules={modules} shareEnabled={s.share.enabled} disabled={!!busy}
                  label={layoutLabel(previewLayout)} noun="frame" onSave={saveSpot} notify={notify}
                  how={<><small>HOW IT PRINTS (SAMPLE QR)</small><div className="lv-thumb"><FramePreview frameId={frame.id} layoutId={previewLayout} qr /></div></>} />
              )}
            </figure>
          )}
        </div>
      )}

      {confirm && frame && (
        confirm.kind === 'delete'
          ? <ConfirmDialog title="DELETE THIS FRAME?" body={`${frame.name.toUpperCase()} and all of its pictures will be removed from this device. A guest who is using it right now gets the default frame. This cannot be undone.`} confirmLabel="DELETE FRAME" cancelLabel="KEEP FRAME" danger
              onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void removeFrame(frame.id); }} />
          : <ConfirmDialog title="REMOVE THIS PICTURE?" body={`The ${layoutLabel(confirm.layoutId)} picture of ${frame.name.toUpperCase()} will be removed. Guests will no longer see this frame on that layout. This cannot be undone.`} confirmLabel="REMOVE PICTURE" cancelLabel="KEEP PICTURE" danger
              onCancel={() => setConfirm(null)} onConfirm={() => { const l = confirm.layoutId; setConfirm(null); void removeArt(frame.id, l); }} />
      )}
    </>
  );
}

const DEFAULT_ADD_LAYOUT: CustomLayoutId = 'strip-3';

/**
 * ADMIN > Frames > Custom Frames: the same grid as ADMIN > Events > Event layouts. Each saved frame is a tile (picture, name, SHOWN switch);
 * tapping the picture or the name opens that frame's page (rename, delete, one picture per layout, QR spot). ADD FRAME saves a new frame
 * together with its first picture in one step, so only frames that passed the picture check ever appear in the grid.
 */
function CustomFrames({ notify, s }: AdminCtx) {
  useSyncExternalStore(subscribeCustom, customVersion, customVersion); // re-render on every registry change
  const frames = customFrameDefs().filter((f) => !customIsSpecial(f.id)); // normal own frames only: event frames live in their event (old ones are managed in Event layouts)
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
  if (status === 'unavailable') return <Hint important>{MESSAGES.unavailable}</Hint>;
  if (status === 'idle' || status === 'loading') return <Hint important>Loading your frames.</Hint>;

  const open = editing && frames.some((f) => f.id === editing) ? editing : null; // a frame that vanished (deleted) sends you back to the grid
  const shownCount = frames.filter((f) => customEnabled(f.id)).length;
  const closeAdd = () => { setAdding(false); setName(''); setLayoutId(DEFAULT_ADD_LAYOUT); setFile(null); setErrors([]); setOver(false); };
  const back = () => { setEditing(null); setNotes([]); };

  const save = async () => {
    if (busy) return;
    setBusy(true); setErrors([]);
    try {
      const r = await addOwnFrame({ name, layoutId, file });
      if (!alive.current) return;
      if (!r.ok) { setErrors(r.errors); notify('error', 'FRAME NOT ADDED'); return; }
      closeAdd(); setNotes(r.warnings);
      notify('success', `FRAME ${r.name.toUpperCase()} ADDED: ${r.windows} PHOTO ${r.windows === 1 ? 'WINDOW' : 'WINDOWS'} FOUND. TAP IT TO ADD MORE LAYOUTS`);
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
      else notify('success', show ? 'ALL YOUR FRAMES ARE SHOWN' : 'ALL YOUR FRAMES ARE HIDDEN');
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

  const openFrame = (id: string) => { setNotes([]); setEditing(id); };
  return (
    <>
      <Hint>Each frame is a picture with see-through holes where the guests{'\u2019'} photos go; the app finds the holes itself. Press ADD FRAME to save one with its first picture. Tap a frame to open it: add pictures for the other layouts, set the QR spot, rename or delete it.</Hint>
      {notes.length > 0 && <ul className="cf-warn" aria-label="Notes about the picture">{notes.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      <div className="lv-group" data-own-frames="true">
        <div className="lv-head">
          <h5 className="lv-h">YOUR FRAMES <small>{frames.length}</small></h5>
          <div className="lv-acts">
            <button type="button" className="btn ghost" disabled={busy || frames.length === 0 || shownCount === frames.length} onClick={() => void setAll(true)} aria-label="SHOW ALL YOUR FRAMES">SHOW ALL</button>
            <button type="button" className="btn ghost" disabled={busy || shownCount === 0} onClick={() => void setAll(false)} aria-label="HIDE ALL YOUR FRAMES">HIDE ALL</button>
          </div>
        </div>
        {frames.length === 0 && !adding && <Hint important>You have not added a frame yet. Press ADD FRAME to start.</Hint>}
        <ul className="fg-grid" aria-label="Your frames">
          {frames.map((f) => {
            const shown = customEnabled(f.id), label = f.name.toUpperCase(), lay = thumbLayout(customLayouts(f.id), CUSTOM_LAYOUT_IDS);
            return (
              <li key={f.id} className="fg-tile" data-shown={shown ? 'true' : 'false'} data-own-frame={f.id}>
                <button type="button" className="fg-thumb fg-open" aria-label={`OPEN FRAME ${label}`} onClick={() => openFrame(f.id)}>
                  {lay ? <FramePreview frameId={f.id} layoutId={lay} /> : <span className="cf-none-s">NO PICTURES</span>}
                </button>
                <button type="button" className="fg-name fg-open" onClick={() => openFrame(f.id)}>{label}</button>
                <Switch label={`SHOW FRAME ${label}`} checked={shown} disabled={busy} onChange={(v) => void toggle(f.id, label, v)} />
              </li>
            );
          })}
          <li className="fg-tile fg-add">
            <button type="button" className="btn ghost" disabled={busy || adding} onClick={() => { setAdding(true); setErrors([]); setNotes([]); }}><Icon name="frame" />ADD FRAME</button>
          </li>
        </ul>
      </div>

      {adding && (
        <div className={over ? 'cf-new ef-add over' : 'cf-new ef-add'} data-add-panel="true"
          onDragOver={(e) => { e.preventDefault(); if (!over) setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer?.files?.[0]; if (f) { setFile(f); setErrors([]); } }}>
          <label className={errors.length ? 'field has-err' : 'field'}>
            <span className="field-top"><span className="field-l">FRAME NAME</span><span className="field-n">{name.trim().length}/{NAME_MAX}</span></span>
            <input className="adm-in" value={name} placeholder="E.G. SUMMER PARTY" aria-label="FRAME NAME" onChange={(e) => { setName(e.target.value); setErrors([]); }} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
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
          <Hint>The frame is added only if the picture passes the check. After SAVE FRAME it appears in the grid; tap it to add the other layouts.</Hint>
        </div>
      )}

      <Hint>Guests can pick a frame while it is SHOWN and has a picture for the layout they chose.</Hint>
    </>
  );
}

/** ADMIN > Frames: your own (normal) frames. Each has a SHOWN switch. */
export const KEYWORDS = ['toggle', 'on', 'off', 'switch', 'enable', 'disable', 'custom', 'own', 'upload', 'png', 'picture', 'image', 'artwork', 'frame', 'frames', 'transparent', 'window', 'windows', 'holes', 'new frame', 'rename', 'delete', 'remove', 'replace', 'preview'];

export const customFramesCard: CardDef = {
  id: 'frames-custom', tab: 'custom',
  title: 'Your own frames',
  description: 'Add your own frame pictures. Each saved frame appears in the grid: tap it to add pictures for other layouts, then switch it shown or hidden for guests.',
  keywords: [...KEYWORDS, 'add frame', 'grid', 'shown', 'hidden', 'show all', 'hide all', 'rename', 'delete frame', 'open frame'],
  render: (c) => <CustomFrames {...c} />
};
