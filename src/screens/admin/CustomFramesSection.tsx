import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from '../../components/Icon';
import type { BoothSettings } from '../../config/settings';
import { FramePreview } from '../../frames/FrameLayer';
import { MESSAGES, NAME_MAX, cleanName } from '../../frames/custom/store';
import {
  createCustomFrame, customAsset, customEnabled, customFrameDefs, customRecord, customVersion, deleteCustomFrame, getCustomStatus, isPersistent,
  removeCustomLayoutArt, renameCustomFrame, setCustomEnabled, setCustomLayoutArt, setCustomLayoutQr, subscribeCustom
} from '../../frames/custom/runtime';
import { browserDecode, prepareUpload } from '../../frames/custom/upload';
import { QR_MODULE_SLACK, checkQrGeometry, requiredSpotPercent, suggestQrSpot, validateQrSpot } from '../../frames/custom/qrArea';
import { CUSTOM_LAYOUT_IDS, LIMITS, requiredWindows, type DecodedImage } from '../../frames/custom/validate';
import type { CustomArtMeta, CustomLayoutArt, CustomLayoutId, CustomQrArea } from '../../frames/custom/types';
import { getLayout } from '../../layouts/registry';
import { getShareStore, makeSessionId } from '../../share/backend';
import { makePageQr, qrBase } from '../../share/service';
import { normalizePublicBase, resolvePageBase } from '../../share/url';
import { ConfirmDialog, Hint, SwitchRow } from './ui';
import type { AdminCtx, CardDef } from './types';

/** Owner-facing layout name, upper case like every other admin label. */
export const layoutLabel = (id: string): string => getLayout(id).name.toUpperCase();
const ACCEPT = 'image/png,image/webp';
const SAMPLE: [string, string][] = [['#f4a261', '#e76f51'], ['#8ecae6', '#219ebc'], ['#b7e4c7', '#40916c'], ['#cdb4db', '#9d4edd']];
const keyOf = (frameId: string, layoutId: string) => `${frameId}:${layoutId}`;

/** Size of the QR the booth really prints (module count), used to size the spot. Conservative when sharing is not set up yet. */
export const FALLBACK_MODULES = 41;
/** Modules of today's printed QR plus slack for a slightly longer site address. Never throws. */
export function qrModulesFor(s: Pick<BoothSettings, 'share'>, origin: string = typeof location === 'undefined' ? '' : location.origin): number {
  try {
    const store = getShareStore();
    const base = qrBase({ store: store ?? undefined, publicBase: normalizePublicBase(s.share.publicBaseUrl), pageBase: resolvePageBase({ cloud: !!store, publicBaseUrl: s.share.publicBaseUrl, origin }) });
    const r = base ? makePageQr(base, makeSessionId()) : null;
    return r && r.ok ? r.matrix.length + QR_MODULE_SLACK : FALLBACK_MODULES;
  } catch { return FALLBACK_MODULES; }
}

/**
 * The art with numbered outlines where the photos will go, over placeholder photos. The placeholders are drawn UNDER the art and use the
 * stored slots (window plus bleed), exactly like the renderer, so what the owner sees here is what a guest's photo will cover.
 */
export function ArtPreview({ src, meta, qr, draft, drawing, onSpot }: {
  src: string; meta: Pick<CustomArtMeta, 'width' | 'height' | 'windows' | 'slots'>;
  /** The saved QR spot, the one being drawn, whether dragging draws, and the callback (final = finger or mouse released). */
  qr?: CustomQrArea | null; draft?: CustomQrArea | null; drawing?: boolean; onSpot?: (a: CustomQrArea, final: boolean) => void;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const svgRef = useRef<SVGSVGElement>(null), anchor = useRef<{ x: number; y: number } | null>(null);
  const { width, height, windows, slots } = meta;
  const sw = Math.max(2, Math.round(width / 192)), r = Math.round(width / 26);
  // client point to picture pixels through the SVG's own matrix, so letterboxing (max-height) cannot skew the drawing
  const toArt = (e: RPointerEvent): { x: number; y: number } | null => {
    const svg = svgRef.current, m = svg?.getScreenCTM?.();
    if (!svg || !m) return null;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(m.inverse());
    return { x: Math.min(width, Math.max(0, p.x)), y: Math.min(height, Math.max(0, p.y)) };
  };
  const rectOf = (a: { x: number; y: number }, b: { x: number; y: number }): CustomQrArea => ({ x: Math.min(a.x, b.x) / width, y: Math.min(a.y, b.y) / height, w: Math.abs(a.x - b.x) / width, h: Math.abs(a.y - b.y) / height });
  const draw = drawing && onSpot;
  const spotBox = (a: CustomQrArea, kind: 'saved' | 'draft', label: string) => (
    <g data-spot={kind}>
      <rect x={a.x * width} y={a.y * height} width={a.w * width} height={a.h * height} fill={kind === 'saved' ? 'rgba(10,122,85,.18)' : 'rgba(29,78,216,.18)'} stroke="#fff" strokeWidth={sw * 3} />
      <rect x={a.x * width} y={a.y * height} width={a.w * width} height={a.h * height} fill="none" stroke={kind === 'saved' ? '#0a7a55' : '#1d4ed8'} strokeWidth={sw * 1.5} strokeDasharray={kind === 'draft' ? `${sw * 5} ${sw * 3}` : undefined} />
      <text x={a.x * width + sw * 4} y={a.y * height + r * 1.4} fontSize={r * 1.1} fontWeight={700} fill={kind === 'saved' ? '#0a7a55' : '#1d4ed8'} stroke="#fff" strokeWidth={sw} paintOrder="stroke">{label}</text>
    </g>
  );
  return (
    <svg ref={svgRef} className="cf-svg" style={draw ? { touchAction: 'none', cursor: 'crosshair' } : undefined} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Preview of the picture with ${windows.length} numbered photo ${windows.length === 1 ? 'window' : 'windows'}`}>
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
      {qr && spotBox(qr, 'saved', 'QR SPOT')}
      {draft && spotBox(draft, 'draft', 'NEW SPOT')}
      {draw && (
        <rect data-draw-surface="true" width={width} height={height} fill="transparent"
          onPointerDown={(e) => { const p = toArt(e); if (!p) return; anchor.current = p; try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not every browser captures */ } }}
          onPointerMove={(e) => { const p = toArt(e); if (anchor.current && p) onSpot(rectOf(anchor.current, p), false); }}
          onPointerUp={(e) => { const a = anchor.current, p = toArt(e); anchor.current = null; if (a && p) { const box = rectOf(a, p); if (box.w > 0.02 && box.h > 0.02) onSpot(box, true); } }}
          onPointerCancel={() => { anchor.current = null; }} />
      )}
    </svg>
  );
}

type Confirm = { kind: 'delete' } | { kind: 'remove'; layoutId: CustomLayoutId } | null;
/** The QR spot being worked on for the layout in the preview. `key` ties it to one frame, layout and stored picture (a replaced picture drops it). `ok` = fully checked and savable. */
type Spot = { key: string; draft: CustomQrArea | null; errors: string[]; ok: boolean; draw: boolean };

function CustomFrames({ notify, s }: AdminCtx) {
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
  const modules = useMemo(() => qrModulesFor(s), [s.share.publicBaseUrl, s.share.enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const [spot, setSpot] = useState<Spot | null>(null);
  const [spotBusy, setSpotBusy] = useState(false);
  const decoded = useRef(new Map<string, Promise<DecodedImage>>()); // the picture of the layout being previewed, decoded once for the spot checks
  const seq = useRef(0); // a newer drawing or search makes a running check stale

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
      setSelected(null); setPreviewId(null); setRenameDraft(null);
      notify('success', 'FRAME DELETED');
    } finally { if (alive.current) setBusy(null); }
  };

  const have = (layoutId: CustomLayoutId) => !!rec?.layouts[layoutId];
  const offered = frame ? CUSTOM_LAYOUT_IDS.filter(have) : [];
  const previewLayout = frame && previewId && have(previewId) ? previewId : null;
  const previewAsset = frame && previewLayout ? customAsset(frame.id, previewLayout) : null;

  // ---- QR spot (Phase 5): draw, find, save, clear. Nothing is saved that placeQr would refuse. ----
  const previewArt = frame && previewLayout ? rec?.layouts[previewLayout] : undefined;
  const spotKey = frame && previewLayout && previewArt ? `${frame.id}:${previewLayout}:${previewArt.rev ?? ''}` : '';
  const sp = spot && spot.key === spotKey ? spot : null;
  const imageOf = (art: CustomLayoutArt, key: string): Promise<DecodedImage> => {
    let p = decoded.current.get(key);
    if (!p) { if (decoded.current.size >= 1) decoded.current.clear(); p = browserDecode(art.blob); decoded.current.set(key, p); p.catch(() => { decoded.current.delete(key); }); }
    return p;
  };
  const CHECK_FAILED = 'The picture could not be checked. Remove it and upload it again.';
  const verify = async (art: CustomLayoutArt, key: string, area: CustomQrArea) => {
    const my = ++seq.current;
    setSpotBusy(true);
    try {
      const r = validateQrSpot(art, await imageOf(art, key), area, modules);
      if (!alive.current || my !== seq.current) return;
      setSpot((p) => (p && p.key === key ? (r.ok ? { ...p, draft: r.value, errors: [], ok: true } : { ...p, errors: r.errors, ok: false }) : p));
    } catch {
      if (alive.current && my === seq.current) setSpot((p) => (p && p.key === key ? { ...p, errors: [CHECK_FAILED], ok: false } : p));
    } finally { if (alive.current && my === seq.current) setSpotBusy(false); }
  };
  const onSpot = (area: CustomQrArea, final: boolean) => {
    if (!previewArt) return;
    seq.current++; setSpotBusy(false);
    const errors = checkQrGeometry(previewArt, area, modules); // cheap, so it runs while dragging; the pixel check runs on release
    setSpot({ key: spotKey, draft: area, errors, ok: false, draw: true });
    if (final && errors.length === 0) void verify(previewArt, spotKey, area);
  };
  const findSpot = async () => {
    if (!previewArt) return;
    const my = ++seq.current, key = spotKey, art = previewArt;
    setSpotBusy(true); setSpot({ key, draft: null, errors: [], ok: false, draw: false });
    try {
      await new Promise<void>((r) => setTimeout(r, 0)); // let SEARCHING show before the pixel work starts
      const found = suggestQrSpot(art, await imageOf(art, key), modules);
      if (!alive.current || my !== seq.current) return;
      setSpot({ key, draft: found, ok: !!found, draw: false, errors: found ? [] : [`No empty space big enough was found. Leave a plain one colour area at least ${requiredSpotPercent(modules)} percent of the paper width on each side, away from the photo windows, or draw a spot yourself.`] });
    } catch {
      if (alive.current && my === seq.current) setSpot({ key, draft: null, ok: false, draw: false, errors: [CHECK_FAILED] });
    } finally { if (alive.current && my === seq.current) setSpotBusy(false); }
  };
  const changeSpot = async (area: CustomQrArea | null) => {
    if (!frame || !previewLayout) return;
    const key = keyOf(frame.id, previewLayout), label = layoutLabel(previewLayout), layout = previewLayout;
    setBusy(key);
    try {
      const r = await setCustomLayoutQr(frame.id, layout, area);
      if (!alive.current) return;
      if (!r.ok) { setSpot({ key: spotKey, draft: area, errors: [r.message], ok: false, draw: false }); notify('error', area ? 'QR SPOT NOT SAVED' : 'QR SPOT NOT CLEARED'); return; }
      setSpot(null);
      notify('success', area ? `${label} QR SPOT SAVED` : `${label} QR SPOT CLEARED. THE QR PRINTS ON A STRIP BELOW THE FRAME`);
    } finally { if (alive.current) setBusy(null); }
  };

  return (
    <>
      <Hint>Add your own event special frames, for example for a wedding, a party or an anniversary. For each layout you want to offer, upload one picture with see-through (transparent) holes where the guests{'\u2019'} photos go. The app finds the holes by itself.</Hint>
      <Hint>
        PNG or WebP, {LIMITS.minWidth} to {LIMITS.maxWidth} pixels wide ({LIMITS.recommendedWidth} is best), up to {Math.round(LIMITS.maxFileBytes / 1048576)} MB. Each hole must be a plain rectangle and fully see-through, with a little picture all around it.
        A layout needs one hole per photo.
      </Hint>
      {isPersistent() === false && <Hint>This browser has not promised to keep these files. If the tablet runs very low on space it may clear them, so keep the original pictures somewhere safe.</Hint>}

      <div className="seg cf-frames" role="radiogroup" aria-label="Your frames">
        {frames.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={frame?.id === f.id} className="seg-o" disabled={!!busy}
            onClick={() => { setSelected(f.id); setPreviewId(null); setRenameDraft(null); setNameErr(''); }}>{f.name.toUpperCase()}{customEnabled(f.id) ? '' : ' (OFF)'}</button>
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
          <Hint>You can also drop a file onto a row. Use the switch above to turn the frame on or off for guests without losing its pictures.</Hint>

          {previewAsset && previewLayout && (
            <figure className="cf-prev" data-preview={previewLayout}>
              <figcaption>{layoutLabel(previewLayout)}: the numbered outlines show where the photos go. The colours are only placeholders.</figcaption>
              <div className="cf-qrbar" data-qr-state={previewArt?.qr ? 'set' : 'strip'}>
                <p className="cf-qrstate">{previewArt?.qr ? 'QR SPOT: SET. THE QR PRINTS INSIDE THE PICTURE.' : 'QR SPOT: NOT SET. THE QR PRINTS ON A STRIP BELOW THE FRAME, WITH A CUT LINE.'}</p>
                <div className="lv-acts cf-qracts">
                  <button type="button" className="btn ghost" disabled={!!busy || spotBusy} aria-pressed={!!sp?.draw} onClick={() => setSpot((p) => (p && p.key === spotKey ? { ...p, draw: !p.draw } : { key: spotKey, draft: null, errors: [], ok: false, draw: true }))}>DRAW SPOT</button>
                  <button type="button" className="btn ghost" disabled={!!busy || spotBusy} onClick={() => void findSpot()}>{spotBusy && !sp?.draft ? 'SEARCHING' : 'FIND EMPTY SPACE'}</button>
                  <button type="button" className="btn" disabled={!!busy || spotBusy || !sp?.ok} onClick={() => void changeSpot(sp?.draft ?? null)}>SAVE QR SPOT</button>
                  {previewArt?.qr && <button type="button" className="btn ghost" disabled={!!busy || spotBusy} onClick={() => void changeSpot(null)}><Icon name="trash" />CLEAR SPOT</button>}
                </div>
                {spotBusy && <p className="hint" role="status">CHECKING THE PICTURE</p>}
                {sp && sp.errors.length > 0 && <ul className="cf-err" role="alert">{sp.errors.map((m, i) => <li key={i}>{m}</li>)}</ul>}
                {sp?.ok && <p className="hint" role="status">THIS SPOT WORKS. PRESS SAVE QR SPOT TO USE IT.</p>}
                <Hint>Optional. Without a spot the QR prints on a plain strip under the frame. To put it inside the picture, press DRAW SPOT and drag a rectangle over plain empty space, or press FIND EMPTY SPACE. The spot must be one flat colour, away from the photo windows, and at least {requiredSpotPercent(modules)} percent of the paper width on each side. {s.share.enabled ? '' : 'QR codes only print when SHARE QR is on under Sharing.'}</Hint>
              </div>
              <div className="cf-prev-grid">
                <ArtPreview src={previewAsset.src} meta={previewAsset.meta} qr={previewArt?.qr ?? null} draft={sp?.draft ?? null} drawing={!!sp?.draw} onSpot={onSpot} />
                <div className="cf-how">
                  <small>HOW IT PRINTS (SAMPLE QR)</small>
                  <div className="lv-thumb"><FramePreview frameId={frame.id} layoutId={previewLayout} qr /></div>
                </div>
              </div>
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

/** The "Event special frames" card of ADMIN > Events (EventSection.tsx lists it): upload your own frames, each with an ON/OFF switch. */
export const customFramesCard: CardDef = {
  id: 'events-special-frames',
  title: 'Event special frames',
  description: 'Upload your own frames for this event and switch each one on or off for guests.',
  keywords: ['event special', 'special frames', 'special', 'event frame', 'toggle', 'on', 'off', 'switch', 'enable', 'disable', 'custom', 'own', 'upload', 'png', 'picture', 'image', 'artwork', 'frame', 'frames', 'transparent', 'window', 'windows', 'holes', 'new frame', 'rename', 'delete', 'remove', 'replace', 'preview'],
  render: (c) => <CustomFrames {...c} />
};
