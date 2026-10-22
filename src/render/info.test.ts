// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { buildPlan, verifyPlanQr, type Cmd, type RenderPlan } from './plan';
import { INFO_GAP_TOP, INFO_INSET, INFO_MIN_SIZE, INFO_PAD_BOTTOM, fitLine, infoItems, layoutInfo } from './info';
import { addSticker, buildSnapshot } from '../editor/model';
import { isSticker } from '../editor/types';
import { FRAMES, getFrame, isImageFrame, resolveFramed } from '../frames/registry';
import { makeCtx, makeEventCtx } from '../frames/prims';
import { LAYOUTS as ALL_LAYOUTS } from '../layouts/registry';
const LAYOUTS = ALL_LAYOUTS.filter((l) => !l.frame); // landscape tickets (own frame, own shape) are covered in ticket/ticket.test.ts
import { PAPER_DOTS } from '../layouts/engine';
import { DEFAULT_EVENT_PROFILE, EVENT_LIMITS, getActiveEvent, type EventProfile } from '../config/events';
import { CUT_HALF, QrPlacementError, rotatedBounds } from '../qr/placement';
import type { FrameCtx, Prim } from '../frames/types';

const photos = [{ src: 'a', iw: 1600, ih: 900 }, { src: 'b', iw: 1600, ih: 900 }];
const matrix = Array.from({ length: 37 }, (_, r) => Array.from({ length: 37 }, (_, c) => (r * 7 + c * 3) % 5 === 0));
const WHEN = new Date(2026, 9, 2, 13, 35); // 2026.10.02 13:35, device-local

/** A profile exactly as the app produces it: stored → `getActiveEvent` (the EP-1 FINAL level) → the session stamp. */
const finalProfile = (o: Partial<EventProfile> = {}): EventProfile => {
  const p: EventProfile = { ...DEFAULT_EVENT_PROFILE, details: [], ...o };
  return getActiveEvent({ events: [p], activeEventId: p.id });
};
const stampOf = (o: Partial<EventProfile> = {}, d = WHEN): FrameCtx => makeEventCtx(finalProfile(o), d);
const FULL: Partial<EventProfile> = { name: 'ZEBRA FEST', header: 'WEDDING RECEPTION', details: ['GRAND BALLROOM', 'TABLE 12'], thankYou: 'MERCI BEAUCOUP', brandingEnabled: true, brandingText: 'Printed by Memorys' };

const infoOf = (p: RenderPlan) => p.cmds.find((c): c is Extract<Cmd, { op: 'info' }> => c.op === 'info');
const qrOf = (p: RenderPlan) => p.cmds.find((c): c is Extract<Cmd, { op: 'qr' }> => c.op === 'qr')!;
const textsOf = (p: RenderPlan) => p.cmds.flatMap((c) => (c.op === 'frame' || c.op === 'info' ? c.prims : [])).filter((x): x is Extract<Prim, { k: 'text' }> => x.k === 'text').map((x) => x.text);
const kindsOf = (p: RenderPlan) => infoOf(p)?.lines.map((l) => l.kind) ?? [];
const snapOf = (layout: string, frame: string) => buildSnapshot(layout, photos, frame);
const GLYPH = 0.62; // the occupancy estimate used by qr/placement.ts

afterEach(() => { vi.useRealTimers(); });

describe('every frame × layout × paper width × QR on/off', () => {
  for (const f of FRAMES.filter((f) => f.id !== 'boarding-pass')) for (const l of LAYOUTS) {
    it(`${f.id} (${isImageFrame(f) ? 'image' : 'vector'}) × ${l.id}`, () => {
      const ctx = stampOf(FULL);
      const frameH = resolveFramed(l.id, f.id).height;
      for (const mm of [58, 80] as const) for (const withQr of [false, true]) {
        const dots = PAPER_DOTS[mm], tag = `${mm}mm qr=${withQr}`;
        const plan = buildPlan(snapOf(l.id, f.id), ctx, dots, withQr ? { matrix, paperDots: dots } : undefined);
        const info = infoOf(plan);
        expect(info, tag).toBeDefined();
        const { rect, lines } = info!;

        // BELOW the frame canvas: it cannot cover a face, a photo slot, the artwork or a sticker.
        expect(rect.y, tag).toBeGreaterThanOrEqual(frameH);
        for (const c of plan.cmds) if (c.op === 'photo') expect(c.slot.y + c.slot.h, tag).toBeLessThanOrEqual(rect.y);

        // Legible and inside the safe width, lines stacked without overlap.
        let prevBottom = rect.y + INFO_GAP_TOP - 1e-6;
        for (const ln of lines) {
          expect(ln.size, `${tag} ${ln.kind}`).toBeGreaterThanOrEqual(INFO_MIN_SIZE);
          const w = [...ln.text].length * (GLYPH * ln.size + ln.ls);
          expect(w, `${tag} ${ln.kind} fits`).toBeLessThanOrEqual(rect.w - 2 * INFO_INSET + 1e-6);
          expect(ln.y - 0.9 * ln.size, `${tag} ${ln.kind} no overlap`).toBeGreaterThanOrEqual(prevBottom);
          prevBottom = ln.y + 0.3 * ln.size;
        }
        expect(prevBottom).toBeCloseTo(rect.y + rect.h, 6);

        // Design height is final BEFORE the QR is placed: the canvas ends at the info block, or below the QR strip.
        if (!withQr) {
          expect(plan.unitsH, tag).toBeCloseTo(rect.y + rect.h + INFO_PAD_BOTTOM, 6);
          expect(plan.cmds.some((c) => c.op === 'qr'), tag).toBe(false);
        } else {
          const q = qrOf(plan);
          expect(plan.cmds[plan.cmds.length - 1].op, tag).toBe('qr'); // still always last
          expect(q.mode, tag).toBe('strip');
          expect(q.designHeight, tag).toBeCloseTo(rect.y + rect.h, 6);
          expect(q.frameHeight, tag).toBe(frameH);
          expect(q.cutY! - CUT_HALF, `${tag} scissors clear of the text`).toBeGreaterThanOrEqual(rect.y + rect.h - 1e-6);
          expect(q.rect.y, `${tag} QR below the cut line`).toBeGreaterThan(q.cutY!);
          expect(verifyPlanQr(plan), tag).toEqual({ ok: true });
          expect(plan.unitsH, tag).toBeGreaterThan(q.rect.y + q.rect.h);
        }
        expect(plan.height, tag).toBe(Math.round(plan.unitsH * plan.k));
        expect(plan.width, tag).toBe(dots);
      }
    });
  }
});

describe('the design itself is untouched', () => {
  const plain = makeCtx('PHOTOBOOTH', WHEN);                       // no info: the pre-EP-2 plan
  const withDefault = makeEventCtx({ ...DEFAULT_EVENT_PROFILE, details: [] }, WHEN); // default profile: info block + same frame text
  for (const f of FRAMES.filter((f) => f.id !== 'boarding-pass')) for (const l of LAYOUTS) {
    it(`${f.id} × ${l.id}: same photos, frame, stickers; the block is only added`, () => {
      const snap = addSticker(snapOf(l.id, f.id), 'heart', 384, 700).snap;
      const before = buildPlan(snap, plain, 384), after = buildPlan(snap, withDefault, 384);
      expect(after.cmds.filter((c) => c.op !== 'info')).toEqual(before.cmds);
      expect(before.cmds.some((c) => c.op === 'info')).toBe(false);
      expect(after.unitsH).toBeGreaterThan(before.unitsH);
    });
  }
});

describe('event text', () => {
  const plan = (frame: string, o = FULL, layout = 'single') => buildPlan(snapOf(layout, frame), stampOf(o), 384);

  it('an image (PNG) frame gets every item, in order, with the session date and time', () => {
    const p = plan('kawaii');
    expect(kindsOf(p)).toEqual(['event', 'header', 'detail', 'detail', 'datetime', 'thanks', 'brand']);
    expect(infoOf(p)!.lines.map((l) => l.text)).toEqual(['ZEBRA FEST', 'WEDDING RECEPTION', 'GRAND BALLROOM', 'TABLE 12', '2026.10.02  13:35', 'MERCI BEAUCOUP', 'Printed by Memorys']);
  });
  it('the 2 vector frames with no text of their own behave the same way', () => {
    for (const id of ['wanted-bounty', 'straw-hat-wanted']) expect(kindsOf(plan(id)), id).toEqual(['event', 'header', 'detail', 'detail', 'datetime', 'thanks', 'brand']);
  });
  it('classic receipt already prints event, date, time and the thank-you: the block adds only header, details and branding', () => {
    const p = plan('classic-receipt');
    expect(kindsOf(p)).toEqual(['header', 'detail', 'detail', 'brand']);
    expect(textsOf(p)).toContain('MERCI BEAUCOUP'); // the frame's own thank-you line now carries the profile text
    expect(textsOf(p)).not.toContain('THANK YOU');
  });
  it('minimal receipt prints event/date/time itself, so the block adds the thank-you', () => expect(kindsOf(plan('minimal-receipt'))).toEqual(['header', 'detail', 'detail', 'thanks', 'brand']));
  it('birthday prints only the date, so the block adds event and the time alone', () => {
    const p = plan('birthday');
    expect(kindsOf(p)).toEqual(['event', 'header', 'detail', 'detail', 'datetime', 'thanks', 'brand']);
    expect(infoOf(p)!.lines.find((l) => l.kind === 'datetime')!.text).toBe('13:35');
  });

  it('branding can be switched off', () => {
    for (const id of ['kawaii', 'classic-receipt']) expect(kindsOf(plan(id, { ...FULL, brandingEnabled: false })), id).not.toContain('brand');
  });
  it('a blank branding text falls back to the default line', () => {
    expect(infoOf(plan('kawaii', { ...FULL, brandingText: '   ' }))!.lines.at(-1)!.text).toBe('Printed by Memorys');
  });
  it('a custom branding text is printed', () => {
    expect(infoOf(plan('kawaii', { ...FULL, brandingText: 'Made with love' }))!.lines.at(-1)!.text).toBe('Made with love');
  });
  it('empty optional fields leave nothing behind', () => {
    const p = plan('kawaii', { name: 'ZEBRA FEST', header: '', details: [], thankYou: '', brandingEnabled: false });
    expect(kindsOf(p)).toEqual(['event', 'datetime']);
  });
  it('a frame that prints everything, with nothing else configured, adds no block at all (no extra paper)', () => {
    const quiet = stampOf({ header: '', details: [], thankYou: '', brandingEnabled: false });
    const p = buildPlan(snapOf('single', 'classic-receipt'), quiet, 384);
    expect(infoOf(p)).toBeUndefined();
    expect(p.unitsH).toBe(resolveFramed('single', 'classic-receipt').height);
  });
  it('the default profile prints the default thank-you and branding on every frame', () => {
    for (const f of FRAMES.filter((f) => f.id !== 'boarding-pass')) {
      const p = buildPlan(snapOf('single', f.id), stampOf(), 384);
      const t = textsOf(p);
      expect(t.filter((x) => x === 'THANK YOU'), f.id).toHaveLength(1);
      expect(t.filter((x) => x === 'Printed by Memorys'), f.id).toHaveLength(1);
    }
  });
  it('a ctx without an event profile (thumbnails, old callers) produces no block on any frame', () => {
    for (const f of FRAMES.filter((f) => f.id !== 'boarding-pass')) expect(infoOf(buildPlan(snapOf('single', f.id), makeCtx('PHOTOBOOTH', WHEN), 384)), f.id).toBeUndefined();
  });
});

describe('no duplicate event information, on every frame', () => {
  // Distinct values so a match can only come from the event profile or the stamp.
  const ctx = stampOf({ name: 'ZEBRA FEST', thankYou: 'MERCI BEAUCOUP' });
  const count = (texts: string[], needle: string) => texts.filter((t) => t.includes(needle)).length;
  for (const f of FRAMES.filter((f) => f.id !== 'boarding-pass')) for (const l of ['single', 'strip-3']) {
    it(`${f.id} × ${l}: event name, date, time and thank-you each appear exactly once`, () => {
      const t = textsOf(buildPlan(snapOf(l, f.id), ctx, 384));
      expect(count(t, 'ZEBRA FEST'), 'event').toBe(1);
      expect(count(t, '2026.10.02'), 'date').toBe(1);
      expect(count(t, '13:35'), 'time').toBe(1);
      expect(count(t, 'MERCI BEAUCOUP'), 'thank-you').toBe(1);
    });
  }
  it('infoItems leaves out exactly what the frame declares', () => {
    const c = stampOf(FULL);
    const kinds = (p?: Parameters<typeof infoItems>[1]) => infoItems(c, p).map((i) => i.kind);
    expect(kinds()).toEqual(['event', 'header', 'detail', 'detail', 'datetime', 'thanks', 'brand']);
    expect(kinds({ event: true })).not.toContain('event');
    expect(infoItems(c, { date: true }).find((i) => i.kind === 'datetime')!.text).toBe('13:35');
    expect(infoItems(c, { time: true }).find((i) => i.kind === 'datetime')!.text).toBe('2026.10.02');
    expect(kinds({ date: true, time: true })).not.toContain('datetime');
    expect(kinds({ thankYou: true })).not.toContain('thanks');
  });
});

describe('long text and unsupported characters', () => {
  const longProfile = { name: 'W'.repeat(40), header: 'H'.repeat(40), details: ['D'.repeat(40), 'E'.repeat(40), 'F'.repeat(40)], thankYou: 'T'.repeat(40), brandingText: 'B'.repeat(40) };
  it('maximum-length lines (EP-1 limit) all fit at or above the legibility floor on 58 mm paper, without wrapping or truncation', () => {
    for (const id of ['kawaii', 'minimal-receipt']) {
      const p = buildPlan(snapOf('single', id), stampOf(longProfile), 384);
      for (const ln of infoOf(p)!.lines) {
        expect(ln.size, `${id} ${ln.kind}`).toBeGreaterThanOrEqual(INFO_MIN_SIZE);
        expect(ln.text.endsWith('...'), `${id} ${ln.kind} not truncated`).toBe(false);
        expect([...ln.text].length * (GLYPH * ln.size + ln.ls), `${id} ${ln.kind}`).toBeLessThanOrEqual(384 - 2 * INFO_INSET + 1e-6);
      }
      expect(infoOf(p)!.lines.filter((l) => l.kind === 'detail')).toHaveLength(EVENT_LIMITS.detailLines);
    }
  });
  it('a line is never wrapped: one prim per item', () => {
    const p = buildPlan(snapOf('single', 'kawaii'), stampOf(longProfile), 384), info = infoOf(p)!;
    expect(info.prims).toHaveLength(info.lines.length);
  });
  it('hand-built oversized input (bypassing EP-1) is capped, then shrunk, then truncated with "..." as a last resort', () => {
    const raw = { ...finalProfile(), name: 'X'.repeat(300), header: 'Y'.repeat(300) } as EventProfile;
    const p = buildPlan(snapOf('single', 'kawaii'), makeCtx('X', WHEN, raw), 384);
    for (const ln of infoOf(p)!.lines) expect([...ln.text].length, ln.kind).toBeLessThanOrEqual(EVENT_LIMITS.lineMax);
    const f = fitLine('Z'.repeat(120), { size: 12, ls: 2 }, 360);
    expect(f.text.endsWith('...')).toBe(true);
    expect([...f.text].length * (GLYPH * f.size + f.ls)).toBeLessThanOrEqual(360 + 1e-6);
    expect(f.size).toBeGreaterThanOrEqual(INFO_MIN_SIZE);
  });
  it('shrinking keeps size and spacing together and never goes below the floor', () => {
    const f = fitLine('M'.repeat(40), { size: 16, ls: 2 }, 360);
    expect(f.size).toBeLessThan(16);
    expect(f.size).toBeGreaterThanOrEqual(INFO_MIN_SIZE);
    expect(f.ls).toBeLessThan(2);
  });
  it('characters the Latin font cannot draw never reach the canvas, even when a caller skips the EP-1 sanitiser', () => {
    const raw = { ...finalProfile(), name: 'PARTY \u{1F389} \u65E5\u672C\u8A9E \u00D1ANDU', header: 'A\u200BB\u0000C', details: ['\u{1F600}'], thankYou: '\u{1F44D}', brandingEnabled: false } as EventProfile;
    const p = buildPlan(snapOf('single', 'kawaii'), makeCtx('X', WHEN, raw), 384);
    const all = infoOf(p)!.lines.map((l) => l.text);
    expect(all).toContain('PARTY \u00D1ANDU'); // removed, not substituted; accents survive
    expect(all).toContain('ABC');
    expect(all.join('')).not.toMatch(/[^\u0020-\u007E\u00A1-\u00FF\u0152\u0153\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/);
    expect(all).toHaveLength(3); // emoji-only detail and thank-you vanish instead of leaving blank lines (name, header, date/time)
  });
});

describe('date and time: one session stamp, one policy', () => {
  it('the block shows the stamp it is given, not the clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 2, 13, 35));
    const ctx = stampOf(FULL);
    const snap = snapOf('single', 'kawaii');
    const first = buildPlan(snap, ctx, 384);
    vi.setSystemTime(new Date(2031, 0, 1, 23, 59)); // the clock moves on (another minute, another year)
    const later = buildPlan(snap, ctx, 384);
    expect(later).toEqual(first);
    expect(infoOf(later)!.lines.find((l) => l.kind === 'datetime')!.text).toBe('2026.10.02  13:35');
  });
  it('preview (2×), print, 80 mm and GIF widths carry identical event text from the same stamp', () => {
    const ctx = stampOf(FULL), snap = snapOf('strip-3', 'kawaii');
    const widths = [384, 768, 576, 1152, 320];
    const infos = widths.map((w) => infoOf(buildPlan(snap, ctx, w))!);
    for (const i of infos) { expect(i.lines).toEqual(infos[0].lines); expect(i.rect).toEqual(infos[0].rect); expect(i.prims).toEqual(infos[0].prims); }
  });
  it('the block is identical with and without a QR (the QR never changes the design)', () => {
    const ctx = stampOf(FULL), snap = snapOf('grid-2x2', 'kawaii');
    expect(infoOf(buildPlan(snap, ctx, 384, { matrix }))).toEqual(infoOf(buildPlan(snap, ctx, 384)));
  });
  it('a damaged stamp value is skipped, never printed', () => {
    const bad: FrameCtx = { ...stampOf(FULL), date: 'NaN.NaN.NaN', time: '??' };
    const p = buildPlan(snapOf('single', 'kawaii'), bad, 384);
    expect(kindsOf(p)).not.toContain('datetime');
    expect(textsOf(p).join(' ')).not.toContain('NaN');
  });
  it('an invalid Date can never produce NaN text', () => {
    const p = buildPlan(snapOf('single', 'kawaii'), makeEventCtx(finalProfile(FULL), new Date(NaN)), 384);
    expect(textsOf(p).join(' ')).not.toContain('NaN');
    expect(infoOf(p)!.lines.find((l) => l.kind === 'datetime')!.text).toMatch(/^\d{4}\.\d{2}\.\d{2}  \d{2}:\d{2}$/);
  });
  it('no screen mints its own timestamp: every screen goes through state/stamp.ts', () => {
    // Source guard (cheap, deliberate): a screen that calls makeCtx(...) itself would bring back per-screen clocks.
    for (const f of ['Standby', 'PreviewScreen', 'PrintScreen', 'ShareScreen', 'Edit']) {
      const src = readFileSync(`src/screens/${f}.tsx`, 'utf8');
      expect(src, f).not.toMatch(/\bmakeCtx\s*\(/);
      expect(src, f).toMatch(/state\/stamp/);
    }
  });
});

describe('stickers that hang below the frame', () => {
  it('the block starts below the lowest sticker and the QR strip below the block', () => {
    const L = resolveFramed('single', 'kawaii');
    let snap = addSticker(snapOf('single', 'kawaii'), 'heart', 384, L.height).snap;
    snap = { ...snap, objects: snap.objects.map((o) => (isSticker(o) ? { ...o, y: L.height - o.h / 2, rotation: 25 } : o)) };
    const st = snap.objects.filter(isSticker).map((s) => rotatedBounds(s));
    const bottom = Math.max(...st.map((r) => r.y + r.h));
    expect(bottom).toBeGreaterThan(L.height); // really hangs past the frame
    const plan = buildPlan(snap, stampOf(FULL), 384, { matrix }), info = infoOf(plan)!;
    expect(info.rect.y).toBeGreaterThanOrEqual(bottom - 1e-6);
    expect(verifyPlanQr(plan)).toEqual({ ok: true });
    expect(qrOf(plan).cutY! - CUT_HALF).toBeGreaterThanOrEqual(info.rect.y + info.rect.h - 1e-6);
  });
});

describe('QR regression with the block in place', () => {
  const ctx = stampOf(FULL);
  it('no QR requested: no qr command, no cut line, the design ends at the block', () => {
    const p = buildPlan(snapOf('single', 'kawaii'), ctx, 384);
    expect(p.cmds.some((c) => c.op === 'qr')).toBe(false);
    expect(verifyPlanQr(p)).toEqual({ ok: true });
  });
  it('the existing failure behaviour is kept: no strip allowed and no safe area → the export is refused', () => {
    expect(() => buildPlan(snapOf('single', 'kawaii'), ctx, 384, { matrix, allowStrip: false })).toThrow(QrPlacementError);
  });
  it('the export gate still catches a QR moved onto the block text', () => {
    const p = buildPlan(snapOf('single', 'kawaii'), ctx, 384, { matrix }), info = infoOf(p)!;
    const bad = { ...p, cmds: p.cmds.map((c) => (c.op === 'qr' ? { ...c, rect: { x: 100, y: info.rect.y + 2, w: 80, h: 80 } } : c)) };
    expect(verifyPlanQr(bad).ok).toBe(false);
  });
  it('the export gate catches a cut line dragged onto the block text', () => {
    const p = buildPlan(snapOf('single', 'kawaii'), ctx, 384, { matrix }), info = infoOf(p)!;
    const bad = { ...p, cmds: p.cmds.map((c) => (c.op === 'qr' ? { ...c, cutY: info.rect.y + info.rect.h / 2 } : c)) };
    expect(verifyPlanQr(bad).ok).toBe(false);
  });
  it('the export gate catches block text pushed onto the cut line', () => {
    const p = buildPlan(snapOf('single', 'kawaii'), ctx, 384, { matrix }), q = qrOf(p);
    const bad = { ...p, cmds: p.cmds.map((c) => (c.op === 'info' ? { ...c, prims: c.prims.map((x) => (x.k === 'text' ? { ...x, y: q.cutY! } : x)) } : c)) };
    expect(verifyPlanQr(bad).ok).toBe(false);
  });
  it('with no event info the QR plan is exactly what it was before EP-2 (no frameHeight, designHeight = frame canvas)', () => {
    const p = buildPlan(snapOf('single', 'kawaii'), makeCtx('PHOTOBOOTH', WHEN), 384, { matrix }), q = qrOf(p);
    expect('frameHeight' in q).toBe(false);
    expect(q.designHeight).toBe(resolveFramed('single', 'kawaii').height);
  });
});

describe('layoutInfo', () => {
  it('returns null for nothing to print', () => expect(layoutInfo([], 384, 500)).toBeNull());
  it('starts INFO_GAP_TOP below `top` and centres every line', () => {
    const b = layoutInfo([{ kind: 'event', text: 'HELLO' }], 384, 500)!;
    expect(b.rect).toMatchObject({ x: 0, y: 500, w: 384 });
    expect(b.lines[0].y - 0.9 * b.lines[0].size).toBeCloseTo(500 + INFO_GAP_TOP, 6);
    expect(b.prims[0]).toMatchObject({ k: 'text', anchor: 'middle', x: 192 });
  });
  it('items follow the order they are given and groups are spaced further apart than lines of one group', () => {
    const b = layoutInfo([{ kind: 'event', text: 'A' }, { kind: 'header', text: 'B' }, { kind: 'thanks', text: 'C' }], 384, 0)!;
    const gap = (i: number) => (b.lines[i + 1].y - 0.9 * b.lines[i + 1].size) - (b.lines[i].y + 0.3 * b.lines[i].size);
    expect(gap(0)).toBeCloseTo(3, 6);
    expect(gap(1)).toBeCloseTo(7, 6);
  });
});

describe('frame inventory used by these tests', () => {
  it('covers every frame and layout in the registry (nothing skipped)', () => {
    expect(FRAMES.length).toBeGreaterThan(0);
    expect(LAYOUTS.length).toBeGreaterThan(0);
    expect(FRAMES.filter(isImageFrame).every((f) => getFrame(f.id) === f)).toBe(true);
  });
});
