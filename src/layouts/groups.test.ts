// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LAYOUTS, STANDARD_LAYOUTS } from './registry';
import { groupedLayouts, pickerEntries, photoCount, photoCountLabel, type LayoutEntry } from './groups';
import type { LayoutDef } from './types';

const ORDINARY = ['single', 'strip-2', 'strip-3', 'strip-4', 'grid-2x2', 'classic'];
const groupsOf = (e: LayoutEntry[]) => e.flatMap((x) => (x.kind === 'group' ? [x.group] : []));
const name = (x: LayoutEntry) => (x.kind === 'layout' ? x.layout.id : `group:${x.group.id}`);

describe('layout registry', () => {
  it('has the six ordinary layouts in order and no built-in group (the NCL passes were removed)', () => {
    expect(LAYOUTS.map((l) => l.id)).toEqual(ORDINARY);
    expect(STANDARD_LAYOUTS.map((l) => l.id)).toEqual(ORDINARY);
    expect(LAYOUTS.every((l) => l.group === undefined)).toBe(true);
  });
});

describe('groupedLayouts() on the real registry', () => {
  it('is six ordinary cards, no group', () => {
    const entries = groupedLayouts();
    expect(entries.map(name)).toEqual(ORDINARY);
    expect(groupsOf(entries)).toHaveLength(0);
  });
  it('does not mutate the registry and is repeatable', () => {
    const before = LAYOUTS.map((l) => l.id).join();
    groupedLayouts(); groupedLayouts();
    expect(LAYOUTS.map((l) => l.id).join()).toBe(before);
  });
});

describe('a group is data only', () => {
  const mk = (id: string, group?: { id: string; name: string }): LayoutDef => ({ ...STANDARD_LAYOUTS[0], id, name: id, group });
  const SUMMER = { id: 'summer', name: 'Summer Special' }, GALA = { id: 'gala', name: 'Gala Special' };
  it('a group collapses at the position of its first member; interleaved members join it', () => {
    const e = groupedLayouts([mk('a'), mk('s1', SUMMER), mk('b'), mk('p1', GALA), mk('s2', SUMMER), mk('p2', GALA), mk('c')]);
    expect(e.map(name)).toEqual(['a', 'group:summer', 'b', 'group:gala', 'c']);
    expect(groupsOf(e).map((g) => g.layouts.map((l) => l.id))).toEqual([['s1', 's2'], ['p1', 'p2']]);
  });
  it('the first member names the group when members disagree; empty input gives no entries', () => {
    const e = groupedLayouts([mk('x', { id: 'g', name: 'First' }), mk('y', { id: 'g', name: 'Second' })]);
    expect(groupsOf(e)).toHaveLength(1);
    expect(groupsOf(e)[0].name).toBe('First');
    expect(groupedLayouts([])).toEqual([]);
  });
  it('pickerEntries puts groups first, each kind keeping its order', () => {
    expect(pickerEntries([mk('a'), mk('s1', SUMMER), mk('b')]).map(name)).toEqual(['group:summer', 'a', 'b']);
  });
});

describe('photo count', () => {
  it('1 PHOTO .. 4 PHOTOS for single and the three strips', () => {
    const l = (id: string) => LAYOUTS.find((x) => x.id === id)!;
    expect(['single', 'strip-2', 'strip-3', 'strip-4'].map((id) => photoCount(l(id)))).toEqual([1, 2, 3, 4]);
    expect([1, 2, 3, 4].map(photoCountLabel)).toEqual(['1 PHOTO', '2 PHOTOS', '3 PHOTOS', '4 PHOTOS']);
  });
  it('pickerEntries() on the real registry is the six ordinary layouts', () => {
    expect(pickerEntries().map(name)).toEqual(ORDINARY);
  });
});
