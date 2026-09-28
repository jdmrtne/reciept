import { pathD, type Prim } from './types';
import { getFrame, resolveFramed } from './registry';
import { framePrims, makeCtx } from './prims';

import { FONT_STACK } from '../render/font';
const FONT = FONT_STACK;

/** SVG drawing of frame primitives (no pointer events, so photos underneath stay draggable). */
export function FrameLayer({ prims }: { prims: Prim[] }) {
  return (
    <g pointerEvents="none">
      {prims.map((p, i) => {
        switch (p.k) {
          case 'rect': return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.fill ?? 'none'} stroke={p.stroke} strokeWidth={p.sw} strokeDasharray={p.dash} />;
          case 'line': return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke="#000" strokeWidth={p.sw} strokeDasharray={p.dash} />;
          case 'circle': return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.fill ?? 'none'} stroke={p.stroke} strokeWidth={p.sw} />;
          case 'path': return <path key={i} d={pathD(p.cmds)} fill={p.fill ?? 'none'} stroke={p.stroke ?? '#000'} strokeWidth={p.sw} strokeLinejoin="round" strokeLinecap="round" />;
          case 'poly': return <polygon key={i} points={p.pts.map((q) => q.join(',')).join(' ')} fill={p.fill} />;
          case 'text': return <text key={i} x={p.x} y={p.y} fontSize={p.size} fontWeight={p.weight} textAnchor={p.anchor} letterSpacing={p.ls} fontFamily={FONT} fill="#000" xmlSpace="preserve">{p.text}</text>;
        }
      })}
    </g>
  );
}

/** Small thumbnail for the frame picker: framed layout with black photo slots. */
export function FramePreview({ frameId, layoutId }: { frameId: string; layoutId: string }) {
  const L = resolveFramed(layoutId, frameId);
  const prims = framePrims(getFrame(frameId), L, makeCtx('PHOTOBOOTH'));
  return (
    <svg viewBox={`0 0 ${L.width} ${L.height}`} className="lay-svg" aria-hidden="true">
      <rect width={L.width} height={L.height} fill="#fff" stroke="#111" strokeWidth={3} rx={8} />
      {L.slots.map((s, i) => (
        <g key={i}>
          <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="#f5f5f5" stroke="#111" strokeWidth={2.5} rx={3} />
          <circle cx={s.x + s.w / 2} cy={s.y + s.h / 2} r={Math.min(s.w, s.h) * 0.16} fill="none" stroke="#111" strokeWidth={2} />
        </g>
      ))}
      <FrameLayer prims={prims} />
    </svg>
  );
}
