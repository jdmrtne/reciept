// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LAYOUTS, NCL_GROUP, PASS_LAYOUTS, STANDARD_LAYOUTS } from './registry';
import { groupedLayouts, pickerEntries, photoCount, photoCountLabel, type LayoutEntry } from './groups';
import type { LayoutDef } from './types';

const GROUP_NAME = 'JLC 20th Anniv. Special';
const ORDINARY = ['single', 'strip-2', 'strip-3', 'strip-4', 'grid-2x2', 'classic'];
const groupsOf = (e: LayoutEntry[]) => e.flatMap((x) => (x.kind === 'group' ? [x.group] : []));

describe('layout registry is unchanged by grouping', () => {
  it('keeps the ten ids in the same order; pass layouts last', () => {
    expect(LAYOUTS.map((l) => l.id)).toEqual([...ORDINARY, 'pass-1', 'pass-2', 'pass-3', 'pass-4']);
    expect(PASS_LAYOUTS.map((l) => l.id)).toEqual(['pass-1', 'pass-2', 'pass-3', 'pass-4']);
    expect(STANDARD_LAYOUTS.map((l) => l.id)).toEqual(ORDINARY);
  });
  it('only the four pass layouts carry a group, and it is the JLC one', () => {
    expect(LAYOUTS.filter((l) => l.group).map((l) => l.id)).toEqual(['pass-1', 'pass-2', 'pass-3', 'pass-4']);
    expect(STANDARD_LAYOUTS.every((l) => l.group === undefined)).toBe(true);
    expect(NCL_GROUP.name).toBe(GROUP_NAME);
  });
});

describe('groupedLayouts() on the real registry', () => {
  const entries = groupedLayouts();
  it('ordinary layouts stay ungrouped, in order, and come first', () => {
    expect(entries.slice(0, 6).map((e) => (e.kind === 'layout' ? e.layout.id : `group:${e.group.id}`))).toEqual(ORDINARY);
    expect(entries.filter((e) => e.kind === 'layout')).toHaveLength(6);
  });
  it('is 6 ordinary entries + exactly ONE group entry (7 cards, not 10)', () => {
    expect(entries).toHaveLength(7);
    expect(groupsOf(entries)).toHaveLength(1);
    expect(entries[6].kind).toBe('group');
  });
  it('the four pass layouts are in exactly one group, in order, and nowhere else', () => {
    const [g] = groupsOf(entries);
    expect(g.layouts.map((l) => l.id)).toEqual(['pass-1', 'pass-2', 'pass-3', 'pass-4']);
    for (const l of PASS_LAYOUTS) {
      const inGroups = groupsOf(entries).filter((x) => x.layouts.includes(l)).length;
      const ungrouped = entries.filter((e) => e.kind === 'layout' && e.layout === l).length;
      expect([l.id, inGroups, ungrouped]).toEqual([l.id, 1, 0]);
    }
  });
  it(`the group name is "${GROUP_NAME}"`, () => {
    expect(groupsOf(entries)[0].name).toBe(GROUP_NAME);
  });
  it('every layout shows up exactly once (as a card or inside a group)', () => {
    const ids = entries.flatMap((e) => (e.kind === 'layout' ? [e.layout.id] : e.group.layouts.map((l) => l.id)));
    expect(ids).toEqual(LAYOUTS.map((l) => l.id));
  });
  it('does not mutate the registry and is repeatable', () => {
    const before = LAYOUTS.map((l) => l.id).join();
    groupedLayouts(); groupedLayouts();
    expect(LAYOUTS.map((l) => l.id).join()).toBe(before);
    expect(groupedLayouts().map((e) => e.kind)).toEqual(entries.map((e) => e.kind));
  });
});

describe('another group is data only', () => {
  const mk = (id: string, group?: { id: string; name: string }): LayoutDef => ({ ...STANDARD_LAYOUTS[0], id, name: id, group });
  const SUMMER = { id: 'summer', name: 'Summer Special' };
  it('a second group collapses at the position of its first member; interleaved members join it', () => {
    const list = [mk('a'), mk('s1', SUMMER), mk('b'), mk('p1', NCL_GROUP), mk('s2', SUMMER), mk('p2', NCL_GROUP), mk('c')];
    const e = groupedLayouts(list);
    expect(e.map((x) => (x.kind === 'layout' ? x.layout.id : `group:${x.group.id}`))).toEqual(['a', 'group:summer', 'b', 'group:jlc-20th-special', 'c']);
    expect(groupsOf(e).map((g) => g.layouts.map((l) => l.id))).toEqual([['s1', 's2'], ['p1', 'p2']]);
  });
  it('the first member names the group when members disagree; empty input gives no entries', () => {
    const e = groupedLayouts([mk('x', { id: 'g', name: 'First' }), mk('y', { id: 'g', name: 'Second' })]);
    expect(groupsOf(e)).toHaveLength(1);
    expect(groupsOf(e)[0].name).toBe('First');
    expect(groupedLayouts([])).toEqual([]);
  });
});

describe('photo count shown in the modal', () => {
  it('1 PHOTO .. 4 PHOTOS for pass-1..4', () => {
    expect(PASS_LAYOUTS.map(photoCount)).toEqual([1, 2, 3, 4]);
    expect(PASS_LAYOUTS.map((l) => photoCountLabel(photoCount(l)))).toEqual(['1 PHOTO', '2 PHOTOS', '3 PHOTOS', '4 PHOTOS']);
  });
});

describe('pickerEntries(): groups first', () => {
  const e = pickerEntries();
  it('the JLC group is the first card, then the six ordinary layouts in their usual order', () => {
    expect(e).toHaveLength(7);
    expect(e[0].kind).toBe('group');
    expect(e.slice(1).map((x) => (x.kind === 'layout' ? x.layout.id : 'group'))).toEqual(ORDINARY);
  });
  it('is stable and leaves groupedLayouts() and the registry untouched', () => {
    expect(pickerEntries().map((x) => x.kind)).toEqual(e.map((x) => x.kind));
    expect(LAYOUTS.map((l) => l.id)).toEqual([...ORDINARY, 'pass-1', 'pass-2', 'pass-3', 'pass-4']);
  });
});
