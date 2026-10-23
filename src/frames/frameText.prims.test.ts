// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { STANDARD_LAYOUTS } from '../layouts/registry';
import { getFrame, resolveFramed } from './registry';
import { framePrims, makeCtx } from './prims';
import { EDITABLE_TEXT_FRAMES, frameTextKeys, type FrameTextOverrides } from './frameText';
import type { Prim } from './types';

type T = Extract<Prim, { k: 'text' }>;
const when = new Date(2026, 9, 2, 13, 35);
const prims = (id: string, ft?: FrameTextOverrides, layout = 'single') => framePrims(getFrame(id), resolveFramed(layout, id), makeCtx('PHOTOBOOTH', when, undefined, ft));
const texts = (id: string, ft?: FrameTextOverrides) => prims(id, ft).filter((p): p is T => p.k === 'text');
const width = (t: T) => t.text.length * (0.6 * t.size + t.ls);
const span = (t: T): [number, number] => (t.anchor === 'start' ? [t.x, t.x + width(t)] : t.anchor === 'end' ? [t.x - width(t), t.x] : [t.x - width(t) / 2, t.x + width(t) / 2]);

describe('default frame output (no overrides)', () => {
  it('matches the stored snapshot for each editable frame x standard layout', async () => {
    const all: Record<string, unknown> = {};
    for (const id of EDITABLE_TEXT_FRAMES) for (const l of STANDARD_LAYOUTS) all[`${id}/${l.id}`] = prims(id, undefined, l.id);
    await expect(JSON.stringify(all)).toMatchFileSnapshot('./__snapshots__/frameText.default.json');
  });
});

describe('framePrims with frame text', () => {
  it('an override replaces exactly one line', () => {
    const base = texts('birthday').map((t) => t.text), next = texts('birthday', { birthday: { 'footer.0': 'MAKE IT COUNT' } }).map((t) => t.text);
    expect(base).toEqual(['HAPPY', 'BIRTHDAY', 'MAKE A WISH', '2026.10.02']);
    expect(next).toEqual(['HAPPY', 'BIRTHDAY', 'MAKE IT COUNT', '2026.10.02']);
  });
  it('an empty override removes the line and nothing else moves', () => {
    const a = prims('birthday'), b = prims('birthday', { birthday: { 'header.0': '' } });
    expect(b.filter((p) => p.k === 'text').map((p) => (p as T).text)).toEqual(['BIRTHDAY', 'MAKE A WISH', '2026.10.02']);
    expect(b.filter((p) => p.k !== 'text')).toEqual(a.filter((p) => p.k !== 'text')); // bands, rules, ornaments untouched
    expect(texts('birthday', { birthday: { 'footer.1': '   ' } }).length).toBe(3); // blank text counts as hidden too
  });
  it('fills repeated tokens everywhere and removes unsupported ones', () => {
    const t = texts('minimal-receipt', { 'minimal-receipt': { 'footer.0': '{DATE} {DATE} {NOPE} {time} {TIME}' } }).map((x) => x.text);
    expect(t).toContain('2026.10.02 2026.10.02   13:35');
    expect(t.join('')).not.toMatch(/[{}]/);
    expect(texts('event', { event: { 'header.1': '{EVENT}-{EVENT}' } }).map((x) => x.text)).toContain('PHOTOBOOTH-PHOTOBOOTH');
  });
  it('an event name that contains braces is never expanded again', () => {
    const ctx = makeCtx('{DATE}', when, undefined, { 'minimal-receipt': { 'header.0': '{EVENT}' } });
    const t = framePrims(getFrame('minimal-receipt'), resolveFramed('single', 'minimal-receipt'), ctx).filter((p): p is T => p.k === 'text').map((x) => x.text);
    expect(t[0]).toBe('{DATE}');
  });
  it('long text stays inside its band, never below the 9-dot minimum', () => {
    for (const id of EDITABLE_TEXT_FRAMES) for (const layout of ['single', 'strip-3']) {
      const L = resolveFramed(layout, id), k = L.width / 384;
      const ft = { [id]: Object.fromEntries(frameTextKeys(id).map((key) => [key, 'W'.repeat(40)])) };
      for (const t of framePrims(getFrame(id), L, makeCtx('PHOTOBOOTH', when, undefined, ft)).filter((p): p is T => p.k === 'text')) {
        const band = t.y < L.header!.y + L.header!.h ? L.header! : L.footer!, [a, b] = span(t);
        expect(a, `${id} ${t.text}`).toBeGreaterThanOrEqual(band.x - 0.01);
        expect(b, `${id} ${t.text}`).toBeLessThanOrEqual(band.x + band.w + 0.01);
        expect(t.size, `${id} size`).toBeGreaterThanOrEqual(9 * k - 0.01);
      }
    }
  });
  it('short text is left exactly as it would be (no shrinking)', () => {
    const [t] = texts('event', { event: { 'header.1': 'HI' } }).filter((x) => x.text === 'HI');
    expect(t.size).toBe(10);
  });
  it('label and value on one row never overlap', () => {
    const long = 'M'.repeat(40);
    for (const ft of [{ 'footer.0': long }, { 'footer.1': long }, { 'footer.0': long, 'footer.1': long }, { 'footer.2': long, 'footer.3': long }] as Record<string, string>[]) {
      const t = texts('classic-receipt', { 'classic-receipt': ft });
      for (const [l, r] of [[t.find((x) => x.anchor === 'start' && x.y === t.filter((q) => q.anchor === 'start')[0].y)!, t.filter((x) => x.anchor === 'end')[0]], [t.filter((x) => x.anchor === 'start')[1], t.filter((x) => x.anchor === 'end')[1]]]) {
        expect(span(l)[1], JSON.stringify(ft)).toBeLessThanOrEqual(span(r)[0] + 0.01);
      }
    }
  });
  it('a hidden label gives its value the whole row', () => {
    const t = texts('classic-receipt', { 'classic-receipt': { 'footer.0': '', 'footer.1': 'V'.repeat(40) } }).filter((x) => x.anchor === 'end')[0];
    expect(t.text).toBe('V'.repeat(40));
  });
  it('ignores overrides for frames that are not editable', () => {
    const a = prims('wanted-bounty'), b = framePrims(getFrame('wanted-bounty'), resolveFramed('single', 'wanted-bounty'), makeCtx('PHOTOBOOTH', when, undefined, { 'wanted-bounty': { 'header.0': 'NOPE' } }));
    expect(b).toEqual(a);
  });
});
