// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { makeArt, STRIP, W } from './fixtures';
import { validateArtwork } from './validate';
import { QR_MODULE_SLACK, checkQrGeometry, requiredSpotPercent, requiredSpotSide, spotIsFlat, suggestQrSpot, validateQrSpot } from './qrArea';
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
