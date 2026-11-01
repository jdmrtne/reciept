import { useEffect, useId, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import type { BoothSettings } from '../../config/settings';
import { browserDecode } from '../../frames/custom/upload';
import { QR_MODULE_SLACK, checkQrGeometry, requiredSpotPercent, suggestQrSpot, validateQrSpot } from '../../frames/custom/qrArea';
import type { DecodedImage } from '../../frames/custom/validate';
import type { CustomArtMeta, CustomLayoutArt, CustomQrArea } from '../../frames/custom/types';
import { getShareStore, makeSessionId } from '../../share/backend';
import { makePageQr, qrBase } from '../../share/service';
import { normalizePublicBase, resolvePageBase } from '../../share/url';
import { Hint } from './ui';
import type { AdminCtx } from './types';

/** Shared by ADMIN > Frames and ADMIN > Events > Event layouts: the picture preview and the QR spot tools. */
const SAMPLE: [string, string][] = [['#f4a261', '#e76f51'], ['#8ecae6', '#219ebc'], ['#b7e4c7', '#40916c'], ['#cdb4db', '#9d4edd']];
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

type Spot = { key: string; draft: CustomQrArea | null; errors: string[]; ok: boolean; draw: boolean };
export type SaveSpot = (area: CustomQrArea | null) => Promise<{ ok: true } | { ok: false; message: string }>;
const CHECK_FAILED = 'The picture could not be checked. Remove it and upload it again.';

/**
 * The QR spot tools (DRAW SPOT, FIND EMPTY SPACE, SAVE QR SPOT, CLEAR SPOT) with the picture they work on. ONE implementation for ADMIN > Frames
 * (frames) and ADMIN > Events > Event layouts (layouts). It saves nothing that `placeQr` would refuse (`qrArea.ts`). `spotKey` ties the work to one
 * picture (a replaced picture changes it and drops a half drawn spot). `inset` is 0 for frames and EVENT_SPOT_INSET for event layouts. `onSave`
 * does the store write and its own busy handling. The caller wraps this in a <figure> with a caption.
 */
export function QrSpotEditor({ art, spotKey, src, meta, modules, inset = 0, shareEnabled, disabled, label, noun, how, onSave, notify }: {
  art: CustomLayoutArt; spotKey: string; src: string; meta: Pick<CustomArtMeta, 'width' | 'height' | 'windows' | 'slots'>; modules: number; inset?: number;
  shareEnabled: boolean; disabled?: boolean; label: string; noun: 'frame' | 'layout'; how: ReactNode; onSave: SaveSpot; notify: AdminCtx['notify'];
}) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [spotBusy, setSpotBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const decoded = useRef(new Map<string, Promise<DecodedImage>>()); // the picture, decoded once for the spot checks
  const seq = useRef(0); // a newer drawing or search makes a running check stale
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const sp = spot && spot.key === spotKey ? spot : null;
  const off = !!disabled || spotBusy || saving;
  const imageOf = (): Promise<DecodedImage> => {
    let p = decoded.current.get(spotKey);
    if (!p) { if (decoded.current.size >= 1) decoded.current.clear(); p = browserDecode(art.blob); decoded.current.set(spotKey, p); const k = spotKey; p.catch(() => { decoded.current.delete(k); }); }
    return p;
  };
  const verify = async (area: CustomQrArea) => {
    const my = ++seq.current, key = spotKey;
    setSpotBusy(true);
    try {
      const r = validateQrSpot(art, await imageOf(), area, modules, inset);
      if (!alive.current || my !== seq.current) return;
      setSpot((p) => (p && p.key === key ? (r.ok ? { ...p, draft: r.value, errors: [], ok: true } : { ...p, errors: r.errors, ok: false }) : p));
    } catch {
      if (alive.current && my === seq.current) setSpot((p) => (p && p.key === key ? { ...p, errors: [CHECK_FAILED], ok: false } : p));
    } finally { if (alive.current && my === seq.current) setSpotBusy(false); }
  };
  const onDraw = (area: CustomQrArea, final: boolean) => {
    seq.current++; setSpotBusy(false);
    const errors = checkQrGeometry(art, area, modules, inset); // cheap, so it runs while dragging; the pixel check runs on release
    setSpot({ key: spotKey, draft: area, errors, ok: false, draw: true });
    if (final && errors.length === 0) void verify(area);
  };
  const findSpot = async () => {
    const my = ++seq.current, key = spotKey;
    setSpotBusy(true); setSpot({ key, draft: null, errors: [], ok: false, draw: false });
    try {
      await new Promise<void>((r) => setTimeout(r, 0)); // let SEARCHING show before the pixel work starts
      const found = suggestQrSpot(art, await imageOf(), modules, inset);
      if (!alive.current || my !== seq.current) return;
      setSpot({ key, draft: found, ok: !!found, draw: false, errors: found ? [] : [`No empty space big enough was found. Leave a plain one colour area at least ${requiredSpotPercent(modules, inset)} percent of the paper width on each side, away from the photo windows, or draw a spot yourself.`] });
    } catch {
      if (alive.current && my === seq.current) setSpot({ key, draft: null, ok: false, draw: false, errors: [CHECK_FAILED] });
    } finally { if (alive.current && my === seq.current) setSpotBusy(false); }
  };
  const change = async (area: CustomQrArea | null) => {
    setSaving(true);
    try {
      const r = await onSave(area);
      if (!alive.current) return;
      if (!r.ok) { setSpot({ key: spotKey, draft: area, errors: [r.message], ok: false, draw: false }); notify('error', area ? 'QR SPOT NOT SAVED' : 'QR SPOT NOT CLEARED'); return; }
      setSpot(null);
      notify('success', area ? `${label} QR SPOT SAVED` : `${label} QR SPOT CLEARED. THE QR PRINTS ON A STRIP BELOW THE ${noun.toUpperCase()}`);
    } finally { if (alive.current) setSaving(false); }
  };
  return (
    <>
      <div className="cf-qrbar" data-qr-state={art.qr ? 'set' : 'strip'}>
        <p className="cf-qrstate">{art.qr ? 'QR SPOT: SET. THE QR PRINTS INSIDE THE PICTURE.' : `QR SPOT: NOT SET. THE QR PRINTS ON A STRIP BELOW THE ${noun.toUpperCase()}, WITH A CUT LINE.`}</p>
        <div className="lv-acts cf-qracts">
          <button type="button" className="btn ghost" disabled={off} aria-pressed={!!sp?.draw} onClick={() => setSpot((p) => (p && p.key === spotKey ? { ...p, draw: !p.draw } : { key: spotKey, draft: null, errors: [], ok: false, draw: true }))}>DRAW SPOT</button>
          <button type="button" className="btn ghost" disabled={off} onClick={() => void findSpot()}>{spotBusy && !sp?.draft ? 'SEARCHING' : 'FIND EMPTY SPACE'}</button>
          <button type="button" className="btn" disabled={off || !sp?.ok} onClick={() => void change(sp?.draft ?? null)}>SAVE QR SPOT</button>
          {art.qr && <button type="button" className="btn ghost" disabled={off} onClick={() => void change(null)}><Icon name="trash" />CLEAR SPOT</button>}
        </div>
        {spotBusy && <p className="hint" role="status">CHECKING THE PICTURE</p>}
        {sp && sp.errors.length > 0 && <ul className="cf-err" role="alert">{sp.errors.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        {sp?.ok && <p className="hint" role="status">THIS SPOT WORKS. PRESS SAVE QR SPOT TO USE IT.</p>}
        <Hint>Optional. Without a spot the QR prints on a plain strip under the {noun}. To place it inside the picture, press DRAW SPOT and drag over plain empty space, or press FIND EMPTY SPACE. The spot must be one flat colour, away from the photo windows, and at least {requiredSpotPercent(modules, inset)} percent of the paper width on each side. {shareEnabled ? '' : 'QR codes only print when SHARE QR is on under Sharing.'}</Hint>
      </div>
      <div className="cf-prev-grid">
        <ArtPreview src={src} meta={meta} qr={art.qr ?? null} draft={sp?.draft ?? null} drawing={!!sp?.draw} onSpot={onDraw} />
        <div className="cf-how">{how}</div>
      </div>
    </>
  );
}
