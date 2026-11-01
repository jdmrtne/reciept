import { describe, expect, it } from 'vitest';
import { applyOrder, mergeGroupOrder, moveId, normalizeOrder } from './order';
import { mergeSettings } from './settings';

const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

describe('normalizeOrder', () => {
  it('repairs bad values', () => {
    expect(normalizeOrder(undefined)).toEqual([]);
    expect(normalizeOrder('abc')).toEqual([]);
    expect(normalizeOrder(['a', 1, '', 'a', null, 'b'])).toEqual(['a', 'b']);
  });
  it('caps the length', () => {
    expect(normalizeOrder(Array.from({ length: 900 }, (_, i) => `x${i}`))).toHaveLength(500);
  });
});

describe('applyOrder', () => {
  it('empty order keeps the original order', () => expect(ids(applyOrder(items, []))).toEqual(['a', 'b', 'c', 'd']));
  it('listed ids first, in the listed order', () => expect(ids(applyOrder(items, ['c', 'a']))).toEqual(['c', 'a', 'b', 'd']));
  it('ignores unknown ids and never drops or duplicates an item', () => {
    const out = ids(applyOrder(items, ['zzz', 'd', 'd', 'b']));
    expect(out).toEqual(['d', 'b', 'a', 'c']);
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('does not change the input', () => { const copy = [...items]; applyOrder(items, ['d']); expect(items).toEqual(copy); });
});

describe('moveId', () => {
  it('moves forward and back', () => {
    expect(moveId(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveId(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
  it('clamps and ignores bad indexes', () => {
    expect(moveId(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
    expect(moveId(['a', 'b', 'c'], -1, 1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('mergeGroupOrder', () => {
  it('re-orders only the group, in the places the group held', () => {
    // full order interleaves two groups: r = receipts, d = designs
    const full = ['r1', 'd1', 'r2', 'd2', 'r3'];
    expect(mergeGroupOrder(full, ['r3', 'r1', 'r2'])).toEqual(['r3', 'd1', 'r1', 'd2', 'r2']);
    expect(mergeGroupOrder(full, ['d2', 'd1'])).toEqual(['r1', 'd2', 'r2', 'd1', 'r3']);
  });
});

describe('settings', () => {
  it('defaults to no custom order', () => {
    const s = mergeSettings({});
    expect(s.layoutOrder).toEqual([]);
    expect(s.frameOrder).toEqual([]);
  });
  it('keeps a valid saved order and repairs a bad one', () => {
    expect(mergeSettings({ layoutOrder: ['grid-2x2', 'single'], frameOrder: ['retro-receipt'] })).toMatchObject({ layoutOrder: ['grid-2x2', 'single'], frameOrder: ['retro-receipt'] });
    expect(mergeSettings({ layoutOrder: 'nope', frameOrder: [1, 2] })).toMatchObject({ layoutOrder: [], frameOrder: [] });
  });
});

describe('guest side', () => {
  it('the frame tray follows the saved order and still hides hidden frames', async () => {
    const { guestFramesForLayout } = await import('../frames/visibility');
    const all = guestFramesForLayout('strip-3', [], null).map((f) => f.id);
    expect(all.length).toBeGreaterThan(2);
    const [a, b, c] = all;
    expect(guestFramesForLayout('strip-3', [], null, undefined, [c, a]).map((f) => f.id).slice(0, 3)).toEqual([c, a, b]);
    const hidden = guestFramesForLayout('strip-3', [c], null, undefined, [c, a]).map((f) => f.id);
    expect(hidden).not.toContain(c);
    expect(hidden.slice(0, 2)).toEqual([a, b]);
  });

  it('the layout picker follows the saved order', async () => {
    const { allLayouts } = await import('../layouts/registry');
    const { pickerEntries } = await import('../layouts/groups');
    const names = (order: string[]) => pickerEntries(applyOrder(allLayouts(), order)).flatMap((e) => (e.kind === 'layout' ? [e.layout.id] : []));
    expect(names([]).slice(0, 2)).toEqual(['single', 'strip-2']);
    expect(names(['grid-2x2', 'strip-4']).slice(0, 3)).toEqual(['grid-2x2', 'strip-4', 'single']);
  });
});
