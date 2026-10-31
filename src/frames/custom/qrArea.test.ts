// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { makeArt, STRIP, W } from './fixtures';
import { validateArtwork } from './validate';
import { EVENT_SPOT_INSET, QR_MODULE_SLACK, checkQrGeometry, insetSpot, requiredSpotPercent, requiredSpotSide, spotIsFlat, suggestQrSpot, validateQrSpot } from './qrArea';
import { placeQr } from '../../qr/placement';
import { qrMatrix } from '../../share/qr';

const REAL = qrMatrix('https://receipt-beta.vercel.app/p/abcdefghijkl').length; // what the booth prints
const MODULES = REAL + QR_MODULE_SLACK;                                          // what the spot is sized for
const H = 1760;                                                                    // 600 px of plain colour under the two windows
const fx = makeArt(W, H, STRIP(2));
const v = validateArtwork('strip-2', fx); if (!v.ok) throw new Error(v.errors.join());
const meta = v.value;
const GOOD = { x: 0.1, y: 1200 / H, w: 0.8, h: 520 / H };
const occ = (m: typeof meta) => ({ width: 384, height: Math.round(384 * m.heightRatio), slots: m.slots.map((s) => ({ x: s.x * 384, y: s.y * 384, w: s.w * 384, h: s.h * 384 })), stickers: [], prims: [], artwork: true });
const noDash = (m: string) => !/[\u2013\u2014]/.test(m) && !/\p{Extended_Pictographic}/u.test(m);

describe('QR spot rules', () => {
  it('the size rule is the real placement rule for the strictest paper, plus the margin on both sides', () => {
    expect(requiredSpotSide(MODULES)).toBe(2 * (MODULES + 8) + 6);
    expect(requiredSpotPercent(MODULES)).toBe(Math.ceil((requiredSpotSide(MODULES) / 384) * 100));
  });
  it('accepts plain empty space under the windows', () => {
    const r = validateQrSpot(meta, fx, GOOD, MODULES);
    expect(r.ok).toBe(true);
  });
  it('refuses a spot that covers a photo window, naming the window', () => {
    const r = validateQrSpot(meta, fx, { x: 0.1, y: 900 / H, w: 0.8, h: 520 / H }, MODULES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/covers photo window 2/);
  });
  it('refuses a spot that is too small, saying how big it must be', () => {
    const r = validateQrSpot(meta, fx, { x: 0.1, y: 1250 / H, w: 0.1, h: 0.1 }, MODULES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain(`${requiredSpotPercent(MODULES)} percent`);
  });
  it('refuses a spot outside the picture, an empty one and one with bad numbers', () => {
    expect(checkQrGeometry(meta, { x: 0.5, y: 0.9, w: 0.8, h: 0.5 }, MODULES)).toEqual(['The QR spot must stay inside the picture.']);
    expect(checkQrGeometry(meta, { x: 0.1, y: 0.1, w: 0, h: 0.2 }, MODULES)).toEqual(['Draw a rectangle for the QR spot.']);
    expect(checkQrGeometry(meta, { x: NaN, y: 0.1, w: 0.2, h: 0.2 }, MODULES)).toEqual(['Draw a rectangle for the QR spot.']);
  });
  it('refuses artwork drawn inside the spot (the renderer pixel gate would block every print)', () => {
    const busy = makeArt(W, H, STRIP(2), (g) => { g.fillStyle = '#fff'; g.fillRect(300, 1400, 400, 40); });
    const r = validateQrSpot(meta, busy, GOOD, MODULES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/Something is drawn inside this spot/);
    expect(spotIsFlat(busy, GOOD)).toBe(false);
    expect(spotIsFlat(fx, GOOD)).toBe(true);
  });
  it('a stray transparent hole that is not a window counts as white paper, so it is not flat against coloured art', () => {
    const stray = makeArt(W, H, [...STRIP(2), { x: 100, y: 1300, w: 60, h: 60 }]);
    const sv = validateArtwork('strip-2', stray); expect(sv.ok).toBe(true);
    if (sv.ok) expect(validateQrSpot(sv.value, stray, GOOD, MODULES).ok).toBe(false);
  });
  it('all messages are plain sentences (no dashes, no emojis)', () => {
    const msgs = [...checkQrGeometry(meta, { x: 0.1, y: 900 / H, w: 0.05, h: 0.05 }, MODULES), ...checkQrGeometry(meta, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, MODULES)];
    expect(msgs.length).toBeGreaterThan(0);
    msgs.forEach((m) => expect(noDash(m), m).toBe(true));
  });
});

describe('suggestQrSpot (FIND EMPTY SPACE)', () => {
  it('finds a spot below the windows that passes every rule and that the real placeQr accepts at 58 and 80 mm', () => {
    const s = suggestQrSpot(meta, fx, MODULES);
    expect(s).not.toBeNull();
    if (!s) return;
    expect(validateQrSpot(meta, fx, s, MODULES).ok).toBe(true);
    expect(s.y * H).toBeGreaterThanOrEqual(1160);
    for (const paperDots of [384, 576]) {
      const p = placeQr({ modules: REAL, occ: occ(meta), area: { safeArea: s }, paperDots });
      expect(p.ok && p.mode === 'safe-area', `${paperDots}`).toBe(true);
    }
  });
  it('a hand drawn good spot is also accepted by placeQr, and a spot just under the size is refused by both', () => {
    const p = placeQr({ modules: REAL, occ: occ(meta), area: { safeArea: GOOD }, paperDots: 384 });
    expect(p.ok).toBe(true);
    const need = requiredSpotSide(REAL);
    const small = { x: 0.1, y: 1250 / H, w: (need - 4) / 384, h: (need - 4) / (384 * meta.heightRatio) };
    expect(checkQrGeometry(meta, small, REAL).length).toBeGreaterThan(0);
    expect(placeQr({ modules: REAL, occ: occ(meta), area: { safeArea: small }, paperDots: 384 }).ok).toBe(false);
  });
  it('returns null when no plain area is big enough', () => {
    const tight = makeArt(W, 1400, STRIP(2));
    const tv = validateArtwork('strip-2', tight); expect(tv.ok).toBe(true);
    if (tv.ok) expect(suggestQrSpot(tv.value, tight, MODULES)).toBeNull();
  });
  it('never returns a spot over a window, even when the window colour matches the plain area', () => {
    // artwork whose border and decoration are the same flat colour: only the windows block
    const s = suggestQrSpot(meta, fx, MODULES);
    if (!s) throw new Error('no spot');
    const top = s.y * H, bottom = (s.y + s.h) * H;
    for (const w of meta.windows) expect(top >= w.y + w.h || bottom <= w.y).toBe(true);
  });
});

describe('QR spot with inset (event layouts, EL-5)', () => {
  const IN = EVENT_SPOT_INSET, r4 = (n: number) => Math.round(n * 10000) / 10000, ROUND = { x: r4(GOOD.x), y: r4(GOOD.y), w: r4(GOOD.w), h: r4(GOOD.h) }; // the validator rounds to 4 decimals first
  it('without an inset nothing changes: same value, same size rule', () => {
    const r = validateQrSpot(meta, fx, GOOD, MODULES);
    expect(r).toEqual(validateQrSpot(meta, fx, GOOD, MODULES, 0));
    expect(r.ok && r.value).toEqual(ROUND);
    expect(requiredSpotPercent(MODULES, 0)).toBe(requiredSpotPercent(MODULES));
  });
  it('saves the drawn spot shrunk by the inset on every side, still big enough for the QR', () => {
    const r = validateQrSpot(meta, fx, GOOD, MODULES, IN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual(insetSpot(meta, ROUND, IN));
    expect(r.value.x).toBeGreaterThan(GOOD.x); expect(r.value.y).toBeGreaterThan(GOOD.y);
    expect(r.value.x + r.value.w).toBeLessThan(GOOD.x + GOOD.w); expect(r.value.y + r.value.h).toBeLessThan(GOOD.y + GOOD.h);
    expect(checkQrGeometry(meta, r.value, MODULES)).toEqual([]);
    const placed = placeQr({ modules: REAL, occ: occ(meta), area: { safeArea: r.value }, paperDots: 384 });
    expect(placed.ok && placed.mode).toBe('safe-area');
  });
  it('asks for a bit more room than frames do, and says the bigger percent', () => {
    const need = requiredSpotSide(MODULES), side = (need + 2 * IN + 0.05) / 2; // between the plain minimum and the inset minimum
    const small = { x: 0.1, y: 1200 / H, w: (need + 1) / 384, h: 520 / H };
    expect(validateQrSpot(meta, fx, small, MODULES).ok).toBe(true);
    const r = validateQrSpot(meta, fx, small, MODULES, IN);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain(`at least ${requiredSpotPercent(MODULES, IN)} percent`);
    expect(requiredSpotPercent(MODULES, IN)).toBeGreaterThanOrEqual(requiredSpotPercent(MODULES));
    expect(noDash(r.errors[0])).toBe(true);
    expect(side).toBeGreaterThan(0);
  });
  it('the pixel and window rules still apply to the drawn rectangle', () => {
    expect(validateQrSpot(meta, fx, { x: 0.1, y: 900 / H, w: 0.8, h: 520 / H }, MODULES, IN).ok).toBe(false);
    expect(checkQrGeometry(meta, { x: 0.9, y: 0.5, w: 0.3, h: 0.1 }, MODULES, IN)).toEqual(['The QR spot must stay inside the picture.']);
  });
  it('find empty space returns a spot that is already inset and valid', () => {
    const plain = suggestQrSpot(meta, fx, MODULES), inset = suggestQrSpot(meta, fx, MODULES, IN);
    expect(plain).not.toBeNull(); expect(inset).not.toBeNull();
    expect(checkQrGeometry(meta, inset!, MODULES)).toEqual([]);
    expect(spotIsFlat(fx, inset!)).toBe(true);
  });
});
