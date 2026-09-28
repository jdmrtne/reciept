/** Hand-drawn line doodles, a wobbly underline and a scalloped tear edge. Pure decoration, never interactive. */
const S = ({ children }: { children: React.ReactNode }) => <svg viewBox="0 0 60 60" className="ic" aria-hidden="true">{children}</svg>;

const Star = () => <S><path d="M30 6l6.5 15.5 16.5 1.5-12.5 11 3.8 16.5L30 41.5 15.7 50.5l3.8-16.5L7 23l16.5-1.5z" /><path d="M8 8l4 3M52 6l-3 4" /></S>;
const Heart = () => <S><path d="M30 52C8 36 6 20 17 14c7-3.5 12 .5 13 6 1-5.5 6-9.5 13-6 11 6 9 22-13 38z" /><path d="M14 22c1-3 3-4.5 6-5" /></S>;
const Cam = () => <S><path d="M6 20h11l4-6h18l4 6h11v30H6z" /><circle cx="30" cy="34" r="9" /><circle cx="30" cy="34" r="3.5" /><path d="M46 25h4" /></S>;
const Smile = () => <S><circle cx="30" cy="30" r="22" /><path d="M21 24v3M39 24v3M19 35q11 12 22 0" /></S>;

/** `onHeart` makes the heart tappable (owner shortcut on the standby screen) and switches to the larger sizing. */
export function Doodles({ onHeart }: { onHeart?: () => void } = {}) {
  return (
    <div className={onHeart ? 'doodles big' : 'doodles'} aria-hidden="true">
      <span className="doodle d1"><Star /></span>
      <span className={onHeart ? 'doodle d2 tappable' : 'doodle d2'} onClick={onHeart ? (e) => { e.stopPropagation(); onHeart(); } : undefined}><Heart /></span>
      <span className="doodle d3"><Cam /></span>
      <span className="doodle d4"><Smile /></span>
    </div>
  );
}

/** Wobbly hand-drawn underline. */
export function Scribble({ className = 'tap-ul' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><path d="M2 6 Q12 1 24 5 T48 5 T74 4.5 T98 5.5" /></svg>;
}

/** Scalloped torn-paper edge (bottom of the receipt). Outlined, white fill. */
export function Tear() {
  const n = 14, w = 100 / n;
  let d = 'M0 0';
  for (let i = 0; i < n; i++) d += ` L${(i * w + w / 2).toFixed(2)} 12 L${((i + 1) * w).toFixed(2)} 0`;
  return <div className="tear" aria-hidden="true"><svg viewBox="0 0 100 12" preserveAspectRatio="none"><path d={d} /></svg></div>;
}
