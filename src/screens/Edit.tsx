import { useEffect, useMemo, useRef, useState } from 'react';
import { sessionStore, useSession } from '../state/session';
import { LAYOUTS } from '../layouts/registry';
import { FRAMES, DEFAULT_FRAME, getFrame, resolveFramed } from '../frames/registry';
import { FrameLayer, FramePreview } from '../frames/FrameLayer';
import { framePrims, makeCtx } from '../frames/prims';
import { StickerGlyph, StickerTray } from '../stickers/StickerTray';
import { FilterDefs, filterAttr } from '../filters/FilterLayer';
import { FilterTray } from '../filters/FilterTray';
import { loadSettings } from '../config/settings';
import {
  MIN_STICKER, addSticker, applyCarry, buildSnapshot, clampCrop, commit, deleteObject, duplicateObject, hitSticker, keepStickers,
  loadPhotoSrcs, moveLayer, newEditor, photoRect, redo, resetEditor, stickerCorner, swapPhotos, undo, withFilter, withFrame
} from '../editor/model';
import { isPhoto, isSticker, type EditorObject, type EditorState, type PhotoObject, type Snapshot, type StickerObject } from '../editor/types';
import { Preview } from './Layout';
import { Icon } from '../components/Icon';

type Pt = { x: number; y: number };
type Gesture = { id: string; kind: 'photo' | 'sticker' | 'handle'; start: Pt; d0: number; a0: number; base: EditorObject; ptrs: Map<number, Pt> };
const DEG = 180 / Math.PI;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const centroid = (m: Map<number, Pt>) => {
  const v = [...m.values()];
  return { x: v.reduce((a, p) => a + p.x, 0) / v.length, y: v.reduce((a, p) => a + p.y, 0) / v.length };
};
const spread = (m: Map<number, Pt>) => { const [a, b] = [...m.values()]; return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
const angle = (m: Map<number, Pt>) => { const [a, b] = [...m.values()]; return b ? Math.atan2(b.y - a.y, b.x - a.x) : 0; };

export function Edit() {
  const { photos, editor, layoutId, frameId, stamp } = useSession();
  const [draft, setDraft] = useState<Snapshot | null>(null);
  const [tray, setTray] = useState<'layout' | 'frame' | 'filter' | 'sticker' | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fallbackCtx = useMemo(() => makeCtx(loadSettings().eventName), []);
  const ctx = stamp ?? fallbackCtx;
  const svg = useRef<SVGSVGElement>(null);
  const g = useRef<Gesture | null>(null);

  useEffect(() => {
    if (editor || !photos.length) return;
    loadPhotoSrcs(photos)
      .then((p) => {
        const { carry } = sessionStore.get(); // stickers + filter kept across a retake
        const s = buildSnapshot(layoutId ?? LAYOUTS[0].id, p, frameId ?? DEFAULT_FRAME);
        sessionStore.update({ editor: newEditor(carry ? applyCarry(s, carry) : s), carry: null });
      })
      .catch(() => setError('Something went wrong loading your photos. Please retake them.'));
  }, [editor, photos, layoutId, frameId]);

  if (error || !photos.length) return (
    <main className="placeholder">
      <p>{error || 'No photos yet.'}</p>
      <button className="btn" onClick={() => sessionStore.update({ screen: 'camera' })}>TAKE PHOTOS</button>
    </main>
  );
  if (!editor) return <main className="placeholder"><p className="loading">LOADING YOUR PHOTOS</p></main>;

  const set = (e: EditorState) => sessionStore.update({ editor: e, layoutId: e.present.layoutId, frameId: e.present.frameId });
  const snap = draft ?? editor.present;
  const L = resolveFramed(snap.layoutId, snap.frameId);
  const prims = framePrims(getFrame(snap.frameId), L, ctx);
  const sel = snap.objects.filter(isSticker).find((o) => o.id === selId && o.visible) ?? null;
  const maxSize = L.width * 1.2;
  const photoCount = snap.objects.filter(isPhoto).length;

  const toSvg = (e: React.PointerEvent): Pt => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const cur = (id: string) => (draft ?? editor.present).objects.find((o) => o.id === id)!;
  const rebase = () => {
    const s = g.current!;
    s.base = cur(s.id); s.start = centroid(s.ptrs); s.d0 = spread(s.ptrs); s.a0 = angle(s.ptrs);
  };

  const photoAt = (p: Pt) => snap.objects.filter(isPhoto).find((o) => o.visible && p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h);

  const down = (e: React.PointerEvent) => {
    const p = toSvg(e);
    if (swapping) { // tap one photo, then another: no drag gestures in this mode
      const ph = photoAt(p);
      if (!ph) return;
      if (!swapFrom) setSwapFrom(ph.id);
      else if (swapFrom === ph.id) setSwapFrom(null);
      else { set(commit(editor, swapPhotos(editor.present, swapFrom, ph.id))); setSwapFrom(null); setSwapping(false); }
      return;
    }
    svg.current!.setPointerCapture(e.pointerId);
    if (g.current) {
      if (g.current.kind === 'handle') return;
      g.current.ptrs.set(e.pointerId, p);
      return rebase();
    }
    const start = (id: string, kind: Gesture['kind'], d0 = 0, a0 = 0) => {
      g.current = { id, kind, start: p, d0, a0, base: cur(id), ptrs: new Map([[e.pointerId, p]]) };
    };
    if (sel) {
      const k = stickerCorner(sel);
      if (Math.hypot(p.x - k.x, p.y - k.y) <= 28) {
        const cx = sel.x + sel.w / 2, cy = sel.y + sel.h / 2;
        return start(sel.id, 'handle', Math.hypot(p.x - cx, p.y - cy), Math.atan2(p.y - cy, p.x - cx));
      }
    }
    const st = snap.objects.filter(isSticker).filter((o) => o.visible && hitSticker(o, p)).sort((a, b) => b.layer - a.layer)[0];
    if (st) { setSelId(st.id); return start(st.id, 'sticker'); }
    setSelId(null);
    const ph = photoAt(p);
    if (ph) start(ph.id, 'photo');
  };

  const move = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || !s.ptrs.has(e.pointerId)) return;
    const p = toSvg(e);
    s.ptrs.set(e.pointerId, p);
    const c = centroid(s.ptrs), multi = s.ptrs.size > 1 && s.d0 > 0;
    let next: EditorObject;
    if (s.kind === 'photo') {
      const b = s.base as PhotoObject;
      next = { ...b, crop: clampCrop(b, { zoom: multi ? b.crop.zoom * (spread(s.ptrs) / s.d0) : b.crop.zoom, ox: b.crop.ox + c.x - s.start.x, oy: b.crop.oy + c.y - s.start.y }) };
    } else {
      const b = s.base as StickerObject;
      let cx = b.x + b.w / 2, cy = b.y + b.h / 2, w = b.w, rot = b.rotation;
      if (s.kind === 'handle') {
        const vx = p.x - cx, vy = p.y - cy;
        w = clamp((b.w * Math.hypot(vx, vy)) / s.d0, MIN_STICKER, maxSize);
        rot = b.rotation + (Math.atan2(vy, vx) - s.a0) * DEG;
      } else {
        cx = clamp(cx + c.x - s.start.x, 0, L.width); cy = clamp(cy + c.y - s.start.y, 0, L.height);
        if (multi) { w = clamp((b.w * spread(s.ptrs)) / s.d0, MIN_STICKER, maxSize); rot = b.rotation + (angle(s.ptrs) - s.a0) * DEG; }
      }
      next = { ...b, x: cx - w / 2, y: cy - w / 2, w, h: w, rotation: rot };
    }
    const base = editor.present;
    setDraft({ ...base, objects: base.objects.map((o) => (o.id === s.id ? next : o)) });
  };

  const up = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s) return;
    s.ptrs.delete(e.pointerId);
    if (s.ptrs.size) return rebase();
    g.current = null;
    if (draft) set(commit(editor, draft));
    setDraft(null);
  };

  const pickLayout = (id: string) => {
    setTray(null);
    if (id === editor.present.layoutId) return;
    loadPhotoSrcs(photos)
      .then((p) => set(commit(editor, keepStickers(editor.present, buildSnapshot(id, p, editor.present.frameId)))))
      .catch(() => setError('Could not change the layout.'));
  };
  const pickFrame = (id: string) => {
    setTray(null);
    if (id !== editor.present.frameId) set(commit(editor, withFrame(editor.present, id)));
  };
  const pickFilter = (id: string) => {
    setTray(null);
    if (id !== editor.present.filterId) set(commit(editor, withFilter(editor.present, id)));
  };
  const startSwap = () => { setSelId(null); setTray(null); setSwapFrom(null); setSwapping(true); };
  const stopSwap = () => { setSwapping(false); setSwapFrom(null); };
  const retake = () => {
    const stickers = editor.present.objects.filter(isSticker);
    sessionStore.update({ carry: { stickers, filterId: editor.present.filterId }, screen: 'camera' });
  };
  const pickSticker = (id: string) => {
    const r = addSticker(editor.present, id, L.width, L.height);
    set(commit(editor, r.snap)); setSelId(r.id); setTray(null);
  };
  const trayBtn = (t: 'layout' | 'frame' | 'filter' | 'sticker') => () => { setSelId(null); setTray((x) => (x === t ? null : t)); };

  return (
    <main className="edit">
      <div className="edit-stage">
        <svg ref={svg} viewBox={`0 0 ${L.width} ${L.height}`} className="edit-svg"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <FilterDefs prefix="ed" />
          <rect width={L.width} height={L.height} fill="#fff" stroke="#111" strokeWidth={2} />
          {snap.objects.filter(isPhoto).filter((o) => o.visible).sort((a, b) => a.layer - b.layer).map((o) => {
            const r = photoRect(o);
            return (
              <g key={o.id}>
                <clipPath id={`clip-${o.id}`}><rect x={o.x} y={o.y} width={o.w} height={o.h} /></clipPath>
                <image href={o.src} x={r.x} y={r.y} width={r.w} height={r.h} preserveAspectRatio="none" filter={filterAttr('ed', snap.filterId)} clipPath={`url(#clip-${o.id})`} />
                <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="none" stroke="#000" strokeWidth={2} />
              </g>
            );
          })}
          <FrameLayer prims={prims} />
          {snap.objects.filter(isSticker).filter((o) => o.visible).sort((a, b) => a.layer - b.layer).map((o) => (
            <g key={o.id} pointerEvents="none" transform={`translate(${o.x + o.w / 2} ${o.y + o.h / 2}) rotate(${o.rotation}) scale(${o.w / 100}) translate(-50 -50)`}>
              <StickerGlyph id={o.stickerId} />
            </g>
          ))}
          {swapFrom && (() => {
            const o = snap.objects.find((x) => x.id === swapFrom);
            return o && (
              <g pointerEvents="none">
                <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="none" stroke="#fff" strokeWidth={9} />
                <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="none" stroke="#000" strokeWidth={4} strokeDasharray="14 9" />
              </g>
            );
          })()}
          {sel && (() => {
            const k = stickerCorner(sel);
            return (
              <g pointerEvents="none">
                <g transform={`rotate(${sel.rotation} ${sel.x + sel.w / 2} ${sel.y + sel.h / 2})`}>
                  <rect x={sel.x} y={sel.y} width={sel.w} height={sel.h} fill="none" stroke="#fff" strokeWidth={5} />
                  <rect x={sel.x} y={sel.y} width={sel.w} height={sel.h} fill="none" stroke="#000" strokeWidth={2} strokeDasharray="8 5" />
                </g>
                <circle cx={k.x} cy={k.y} r={16} fill="#fff" stroke="#111" strokeWidth={3.5} />
                <circle cx={k.x} cy={k.y} r={5} fill="#111" />
              </g>
            );
          })()}
        </svg>
        {tray === 'sticker' && <StickerTray onPick={pickSticker} />}
        {tray === 'filter' && <FilterTray src={snap.objects.find(isPhoto)?.src ?? photos[0]} active={snap.filterId} onPick={pickFilter} />}
        {tray === 'frame' && (
          <div className="edit-tray">
            {FRAMES.map((f) => (
              <button key={f.id} className={`lay-card${f.id === snap.frameId ? ' on' : ''}`} onClick={() => pickFrame(f.id)}>
                <FramePreview frameId={f.id} layoutId={snap.layoutId} /><span>{f.name.toUpperCase()}</span>
              </button>
            ))}
          </div>
        )}
        {tray === 'layout' && (
          <div className="edit-tray">
            {LAYOUTS.map((l) => (
              <button key={l.id} className={`lay-card${l.id === snap.layoutId ? ' on' : ''}`} onClick={() => pickLayout(l.id)}>
                <Preview id={l.id} /><span>{l.name.toUpperCase()}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {swapping ? (
        <>
          <p className="edit-hint">{swapFrom ? 'NOW TAP THE PHOTO TO SWAP WITH' : 'TAP A PHOTO TO MOVE'}</p>
          <div className="cam-bar"><button className="btn big" onClick={stopSwap}><Icon name="close" />CANCEL</button></div>
        </>
      ) : sel ? (
        <>
          <p className="edit-hint">DRAG · PINCH · TWIST · OR DRAG THE DOT TO SIZE + ROTATE</p>
          <div className="cam-bar">
            <button className="btn ghost" onClick={() => { set(commit(editor, deleteObject(editor.present, sel.id))); setSelId(null); }}><Icon name="trash" />DELETE</button>
            <button className="btn ghost" onClick={() => { const r = duplicateObject(editor.present, sel.id); set(commit(editor, r.snap)); setSelId(r.id); }}><Icon name="copy" />DUPLICATE</button>
            <button className="btn ghost" onClick={() => set(commit(editor, moveLayer(editor.present, sel.id, 1)))}><Icon name="up" />FORWARD</button>
            <button className="btn ghost" onClick={() => set(commit(editor, moveLayer(editor.present, sel.id, -1)))}><Icon name="down" />BACK</button>
            <button className="btn big" onClick={() => setSelId(null)}><Icon name="check" />DONE</button>
          </div>
        </>
      ) : (
        <>
          <p className="edit-hint">DRAG TO MOVE · PINCH TO ZOOM</p>
          <div className="cam-bar">
            <button className={`btn ghost${tray === 'layout' ? ' on' : ''}`} onClick={trayBtn('layout')}><Icon name="layout" />LAYOUT</button>
            <button className={`btn ghost${tray === 'frame' ? ' on' : ''}`} onClick={trayBtn('frame')}><Icon name="frame" />FRAME</button>
            <button className={`btn ghost${tray === 'filter' ? ' on' : ''}`} onClick={trayBtn('filter')}><Icon name="filter" />FILTER</button>
            <button className={`btn ghost${tray === 'sticker' ? ' on' : ''}`} onClick={trayBtn('sticker')}><Icon name="sticker" />STICKERS</button>
            <button className="btn ghost" disabled={photoCount < 2} onClick={startSwap}><Icon name="swap" />SWAP</button>
            <button className="btn ghost" onClick={retake}><Icon name="camera" />RETAKE</button>
          </div>
          <div className="cam-bar">
            <button className="btn ghost" disabled={!editor.past.length} onClick={() => set(undo(editor))}><Icon name="undo" />UNDO</button>
            <button className="btn ghost" disabled={!editor.future.length} onClick={() => set(redo(editor))}><Icon name="redo" />REDO</button>
            <button className="btn ghost" disabled={!editor.past.length} onClick={() => { setSelId(null); set(resetEditor(editor)); }}><Icon name="reset" />RESET</button>
            <button className="btn big" onClick={() => sessionStore.go('preview')}><Icon name="eye" />PREVIEW</button>
          </div>
        </>
      )}
    </main>
  );
}
