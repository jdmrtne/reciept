import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import { FramePreview } from '../../frames/FrameLayer';
import { MESSAGES, NAME_MAX, cleanName } from '../../frames/custom/store';
import {
  createCustomFrame, customAsset, customFrameDefs, customRecord, customVersion, deleteCustomFrame, getCustomStatus, isPersistent,
  removeCustomLayoutArt, renameCustomFrame, setCustomLayoutArt, subscribeCustom
} from '../../frames/custom/runtime';
import { prepareUpload } from '../../frames/custom/upload';
import { CUSTOM_LAYOUT_IDS, LIMITS, requiredWindows } from '../../frames/custom/validate';
import type { CustomArtMeta, CustomLayoutId } from '../../frames/custom/types';
import { getLayout } from '../../layouts/registry';
import { ConfirmDialog, Hint } from './ui';
import type { AdminCtx, CardDef } from './types';

/** Owner-facing layout name, upper case like every other admin label. */
export const layoutLabel = (id: string): string => getLayout(id).name.toUpperCase();
const ACCEPT = 'image/png,image/webp';
const SAMPLE: [string, string][] = [['#f4a261', '#e76f51'], ['#8ecae6', '#219ebc'], ['#b7e4c7', '#40916c'], ['#cdb4db', '#9d4edd']];
const keyOf = (frameId: string, layoutId: string) => `${frameId}:${layoutId}`;

/**
 * The art with numbered outlines where the photos will go, over placeholder photos. The placeholders are drawn UNDER the art and use the
 * stored slots (window plus bleed), exactly like the renderer, so what the owner sees here is what a guest's photo will cover.
 */
export function ArtPreview({ src, meta }: { src: string; meta: Pick<CustomArtMeta, 'width' | 'height' | 'windows' | 'slots'> }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { width, height, windows, slots } = meta;
  const sw = Math.max(2, Math.round(width / 192)), r = Math.round(width / 26);
  return (
    <svg className="cf-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Preview of the picture with ${windows.length} numbered photo ${windows.length === 1 ? 'window' : 'windows'}`}>
      <defs>
        {slots.map((_, i) => (
          <linearGradient key={i} id={`${uid}g${i}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={SAMPLE[i % SAMPLE.length][0]} /><stop offset="1" stopColor={SAMPLE[i % SAMPLE.length][1]} />
          </linearGradient>
        ))}
      </defs>
      <rect width={width} height={height} fill="#fff" />
      {slots.map((s, i) => <rect key={i} x={s.x * width} y={s.y * width} width={s.w * width} height={s.h * width} fill={`url(#${uid}g${i})`} />)}
      <image href={src} x={0} y={0} width={width} height={height} preserveAspectRatio="none" />
      {windows.map((w, i) => (
        <g key={i} data-window={i + 1}>
          <rect x={w.x} y={w.y} width={w.w} height={w.h} fill="none" stroke="#fff" strokeWidth={sw * 3} />
          <rect x={w.x} y={w.y} width={w.w} height={w.h} fill="none" stroke="#111" strokeWidth={sw} strokeDasharray={`${sw * 4} ${sw * 3}`} />
          <circle cx={w.x + r + sw * 2} cy={w.y + r + sw * 2} r={r} fill="#111" stroke="#fff" strokeWidth={sw} />
          <text x={w.x + r + sw * 2} y={w.y + r + sw * 2} fontSize={r * 1.3} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#fff">{i + 1}</text>
        </g>
      ))}
    </svg>
  );
}

type Confirm = { kind: 'delete' } | { kind: 'remove'; layoutId: CustomLayoutId } | null;

function CustomFrames({ notify }: AdminCtx) {
  useSyncExternalStore(subscribeCustom, customVersion, customVersion); // re-render on every registry change
  const frames = customFrameDefs();
  const [selected, setSelected] = useState<string | null>(null);
  const frame = frames.find((f) => f.id === selected) ?? frames[0] ?? null;
  const rec = frame ? customRecord(frame.id) : undefined;
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
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

  const status = getCustomStatus();
  if (status === 'unavailable') return <Hint>{MESSAGES.unavailable}</Hint>;
  if (status === 'idle' || status === 'loading') return <Hint>Loading your frames.</Hint>;

  const setMsg = (key: string, errs: string[], warns: string[]) => { setProblems((p) => ({ ...p, [key]: errs })); setNotes((p) => ({ ...p, [key]: warns })); };

  const create = async () => {
    const name = cleanName(newName);
    if (!name) { setNameErr(`Type a name for the frame, up to ${NAME_MAX} characters.`); return; }
    setBusy('frame'); setNameErr('');
    try {
      const r = await createCustomFrame(name);
      if (!alive.current) return;
      if (!r.ok) { setNameErr(r.message); notify('error', 'FRAME NOT CREATED'); return; }
      setSelected(r.value.id); setPreviewId(null); setNewName(''); setShowNew(false);
      notify('success', `FRAME ${r.value.name.toUpperCase()} CREATED. NOW ADD ITS PICTURES`);
    } finally { if (alive.current) setBusy(null); }
  };

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
      const saved = await setCustomLayoutArt(frameId, layoutId, r.art);
      if (!alive.current) return;
      if (!saved.ok) { setMsg(key, [saved.message], []); notify('error', `${label} PICTURE NOT SAVED`); return; }
      setMsg(key, [], r.warnings); setPreviewId(layoutId);
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

  const removeFrame = async (frameId: string) => {
    setBusy('frame');
    try {
      const r = await deleteCustomFrame(frameId);
      if (!alive.current) return;
      if (!r.ok) { notify('error', 'FRAME NOT DELETED'); setNameErr(r.message); return; }
      setSelected(null); setPreviewId(null); setRenameDraft(null);
      notify('success', 'FRAME DELETED');
    } finally { if (alive.current) setBusy(null); }
  };

  const have = (layoutId: CustomLayoutId) => !!rec?.layouts[layoutId];
  const offered = frame ? CUSTOM_LAYOUT_IDS.filter(have) : [];
  const previewLayout = frame && previewId && have(previewId) ? previewId : null;
  const previewAsset = frame && previewLayout ? customAsset(frame.id, previewLayout) : null;

  return (
    <>
      <Hint>Add your own frame designs. For each layout you want to offer, upload one picture with see-through (transparent) holes where the guests{'\u2019'} photos go. The app finds the holes by itself.</Hint>
      <Hint>
        PNG or WebP, {LIMITS.minWidth} to {LIMITS.maxWidth} pixels wide ({LIMITS.recommendedWidth} is best), up to {Math.round(LIMITS.maxFileBytes / 1048576)} MB. Each hole must be a plain rectangle and fully see-through, with a little picture all around it.
        A layout needs one hole per photo.
      </Hint>
      {isPersistent() === false && <Hint>This browser has not promised to keep these files. If the tablet runs very low on space it may clear them, so keep the original pictures somewhere safe.</Hint>}

      <div className="seg cf-frames" role="radiogroup" aria-label="Your frames">
        {frames.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={frame?.id === f.id} className="seg-o" disabled={!!busy}
            onClick={() => { setSelected(f.id); setPreviewId(null); setRenameDraft(null); setNameErr(''); }}>{f.name.toUpperCase()}</button>
        ))}
        <button type="button" className="btn ghost" disabled={!!busy} onClick={() => { setShowNew((v) => !v); setNameErr(''); }}><Icon name="frame" />NEW FRAME</button>
      </div>
      {frames.length === 0 && !showNew && <Hint>You have not made a frame yet. Press NEW FRAME to start.</Hint>}

      {showNew && (
        <div className="cf-new">
          <label className={nameErr ? 'field has-err' : 'field'}>
            <span className="field-top"><span className="field-l">NEW FRAME NAME</span><span className="field-n">{newName.trim().length}/{NAME_MAX}</span></span>
            <input className="adm-in" value={newName} placeholder="E.G. SUMMER PARTY" aria-invalid={nameErr ? true : undefined} onChange={(e) => { setNewName(e.target.value); setNameErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} />
            {nameErr && <small className="field-err" role="alert">{nameErr}</small>}
          </label>
          <div className="test-actions">
            <button type="button" className="btn" disabled={!!busy} onClick={() => void create()}>CREATE FRAME</button>
            <button type="button" className="btn ghost" disabled={!!busy} onClick={() => { setShowNew(false); setNewName(''); setNameErr(''); }}>CANCEL</button>
          </div>
        </div>
      )}

      {frame && rec && (
        <div className="cf-frame" data-custom-frame={frame.id}>
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
                    <small>{art ? `PICTURE ADDED: ${art.windows.length} PHOTO ${art.windows.length === 1 ? 'WINDOW' : 'WINDOWS'}, ${art.width} PX WIDE` : `MISSING: NEEDS ${need} PHOTO ${need === 1 ? 'WINDOW' : 'WINDOWS'}. GUESTS DO NOT SEE THIS FRAME ON THIS LAYOUT`}</small>
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
                  {errs.length > 0 && <ul className="cf-err" role="alert">{errs.map((m, i) => <li key={i}>{m}</li>)}</ul>}
                  {warns.length > 0 && <ul className="cf-warn">{warns.map((m, i) => <li key={i}>{m}</li>)}</ul>}
                </li>
              );
            })}
          </ul>
          <Hint>You can also drop a file onto a row. Custom frames cannot be hidden like the built in ones: remove a picture or delete the frame instead.</Hint>

          {previewAsset && previewLayout && (
            <figure className="cf-prev" data-preview={previewLayout}>
              <figcaption>{layoutLabel(previewLayout)}: the numbered outlines show where the photos go. The colours are only placeholders.</figcaption>
              <ArtPreview src={previewAsset.src} meta={previewAsset.meta} />
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

/** Second card of ADMIN > Frames (FramesSection.tsx lists it). */
export const customFramesCard: CardDef = {
  id: 'frames-custom',
  title: 'Your own frames',
  description: 'Upload your own frame pictures. Guests pick them like the built in frames.',
  keywords: ['custom', 'own', 'upload', 'png', 'picture', 'image', 'artwork', 'frame', 'frames', 'transparent', 'window', 'windows', 'holes', 'new frame', 'rename', 'delete', 'remove', 'replace', 'preview'],
  render: (c) => <CustomFrames {...c} />
};
