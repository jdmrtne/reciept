import { pathD, type Prim } from './types';
import { getFrame, resolveFramed, vectorFrameOf } from './registry';
import { getFrameAsset, type FrameAsset } from './assets';
import { framePrims, makeCtx } from './prims';
import type { FrameTextOverrides } from './frameText';
import { isSideways, readingMatrix } from '../render/orient';
import { qrMatrix, qrPath, QUIET } from '../share/qr';
import { placeQr, qrAreaFor } from '../qr/placement';

import { FONT_STACK, FONT_DISPLAY_STACK } from '../render/font';
const FONT = FONT_STACK;

/** SVG drawing of frame primitives (no pointer events, so photos underneath stay draggable). */
export function FrameLayer({ prims }: { prims: Prim[] }) {
  return (
    <g pointerEvents="none">
      {prims.map((p, i) => {
        switch (p.k) {
          case 'rect': return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.fill ?? 'none'} stroke={p.stroke} strokeWidth={p.sw} strokeDasharray={p.dash} />;
          case 'line': return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.c ?? '#000'} strokeWidth={p.sw} strokeDasharray={p.dash} />;
          case 'circle': return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.fill ?? 'none'} stroke={p.stroke} strokeWidth={p.sw} />;
          case 'path': return <path key={i} d={pathD(p.cmds)} fill={p.fill ?? 'none'} stroke={p.stroke ?? '#000'} fillRule={p.eo ? 'evenodd' : undefined} strokeWidth={p.sw} strokeLinejoin="round" strokeLinecap="round" />;
          case 'poly': return <polygon key={i} points={p.pts.map((q) => q.join(',')).join(' ')} fill={p.fill} />;
          case 'text': return <text key={i} x={p.x} y={p.y} fontSize={p.size} fontWeight={p.weight} textAnchor={p.anchor} letterSpacing={p.ls} fontFamily={p.font === 'display' ? FONT_DISPLAY_STACK : FONT} fill={p.c ?? '#000'} textLength={p.fit} lengthAdjust={p.fit ? 'spacingAndGlyphs' : undefined} xmlSpace="preserve">{p.text}</text>;
        }
      })}
    </g>
  );
}

/** PNG frame artwork over the whole canvas (editor + picker). Photos show through its transparent windows; no pointer events, so photos/stickers stay draggable. */
export function ImageFrameLayer({ asset, w, h }: { asset: FrameAsset; w: number; h: number }) {
  return <image href={asset.src} x={0} y={0} width={w} height={h} preserveAspectRatio={asset.fit === 'stretch' ? 'none' : 'xMidYMid slice'} pointerEvents="none" />;
}

/** One fixed, valid QR used only to SHOW where the real session QR lands on a print (it is not a working link). */
let sampleQr: boolean[][] | null = null;
const getSampleQr = () => (sampleQr ??= qrMatrix('https://receipt-beta.vercel.app/p/sample-qr-preview'));

/**
 * Small thumbnail for the frame picker: framed layout with placeholder photo slots under the real frame artwork.
 * `frameText`: owner text overrides to show (ADMIN > Frame text draft; default none). `qr`: also draw a sample QR where the real one will print (same placement rules as the print: the frame's declared safe area, e.g. the
 * NCL stub, otherwise a strip below the design with a cut line). Off by default so the editor's pickers are unchanged.
 */
export function FramePreview({ frameId, layoutId, qr = false, frameText }: { frameId: string; layoutId: string; qr?: boolean; frameText?: FrameTextOverrides }) {
  const L = resolveFramed(layoutId, frameId);
  const frame = getFrame(frameId), asset = getFrameAsset(frame, layoutId);
  const prims = asset ? [] : framePrims(vectorFrameOf(frame), L, makeCtx('PHOTOBOOTH', new Date(), undefined, frameText));
  const turn = isSideways(layoutId); // sideways (roll-printed) ticket: the thumbnail shows it the way it is READ (landscape), see render/orient.ts
  const matrix = qr ? getSampleQr() : null;
  const placed = matrix ? placeQr({ modules: matrix.length, occ: { width: L.width, height: L.height, slots: L.slots, stickers: [], prims, artwork: !!asset }, area: qrAreaFor(frame, layoutId) }) : null;
  const q = placed && placed.ok ? placed : null;
  const H = q ? q.canvasHeight : L.height; // a strip placement makes the paper taller; a safe-area placement does not
  return (
    <svg viewBox={turn ? `0 0 ${H} ${L.width}` : `0 0 ${L.width} ${H}`} className="lay-svg" aria-hidden="true">
      <g transform={turn ? readingMatrix(L.width) : undefined}>
        {q && H > L.height && <rect width={L.width} height={H} fill="#fff" stroke="#111" strokeWidth={3} rx={8} />}
        <rect width={L.width} height={L.height} fill="#fff" stroke="#111" strokeWidth={3} rx={8} />
        {L.slots.map((s, i) => (
          <g key={i}>
            <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="#f5f5f5" stroke={asset ? 'none' : '#111'} strokeWidth={2.5} rx={3} />
            <circle cx={s.x + s.w / 2} cy={s.y + s.h / 2} r={Math.min(s.w, s.h) * 0.16} fill="none" stroke="#111" strokeWidth={2} />
          </g>
        ))}
        {asset ? <ImageFrameLayer asset={asset} w={L.width} h={L.height} /> : <FrameLayer prims={prims} />}
        {q && matrix && (
          <g data-sample-qr={q.mode}>
            {q.cutY !== undefined && <line x1={6} y1={q.cutY} x2={L.width - 6} y2={q.cutY} stroke="#111" strokeWidth={1.5} strokeDasharray="6 4" />}
            <g transform={`translate(${q.rect.x} ${q.rect.y}) scale(${q.rect.w / (matrix.length + QUIET * 2)})`}>
              <rect width={matrix.length + QUIET * 2} height={matrix.length + QUIET * 2} fill="#fff" />
              <path transform={`translate(${QUIET} ${QUIET})`} d={qrPath(matrix)} fill="#111" shapeRendering="crispEdges" />
            </g>
          </g>
        )}
      </g>
    </svg>
  );
}
