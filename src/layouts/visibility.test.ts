// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LAYOUTS, STANDARD_LAYOUTS } from './registry';
import { pickerEntries } from './groups';
import { normalizeHidden, setHidden, visibleLayouts } from './visibility';
import type { LayoutDef } from './types';

const ALL = LAYOUTS.map((l) => l.id);
const kinds = (ids: string[], list: readonly LayoutDef[] = LAYOUTS) => pickerEntries(visibleLayouts(list, ids)).map((e) => (e.kind === 'layout' ? e.layout.id : `group:${e.group.id}`));
// a synthetic group (the built-in one was removed): the picker logic is data driven, so it is tested with made-up members
const G = { id: 'demo', name: 'Demo Special' };
const WITH_GROUP: LayoutDef[] = [...LAYOUTS, { ...LAYOUTS[0], id: 'demo-1', name: 'Demo 1', group: G }, { ...LAYOUTS[0], id: 'demo-2', name: 'Demo 2', group: G }];

describe('normalizeHidden', () => {
  it('repairs anything that is not a list of known ids', () => {
    for (const bad of [undefined, null, 'single', 5, {}, { 0: 'single' }]) expect(normalizeHidden(bad)).toEqual([]);
  });
  it('drops non-strings and unknown ids (a removed layout id too) and removes duplicates', () => {
    expect(normalizeHidden(['single', 7, null, 'nope', 'pass-1', 'single', 'classic'])).toEqual(['single', 'classic']);
  });
  it('resets to [] when every layout would be hidden', () => {
    expect(normalizeHidden(ALL)).toEqual([]);
    expect(normalizeHidden([...ALL, 'extra'])).toEqual([]);
    expect(normalizeHidden(ALL.slice(1))).toEqual(ALL.slice(1)); // one left visible is fine
  });
});

describe('visibleLayouts + pickerEntries with hidden ids', () => {
  it('nothing hidden = the six ordinary layouts in order', () => {
    expect(kinds([])).toEqual(STANDARD_LAYOUTS.map((l) => l.id));
  });
  it('a group is first, disappears when all its members are hidden, and keeps the rest when only some are', () => {
    expect(kinds([], WITH_GROUP)).toEqual(['group:demo', ...ALL]);
    expect(kinds(['demo-1', 'demo-2'], WITH_GROUP)).toEqual(ALL);
    const e = pickerEntries(visibleLayouts(WITH_GROUP, ['demo-1', 'strip-3']));
    const g = e.find((x) => x.kind === 'group');
    expect(g && g.kind === 'group' && g.group.layouts.map((l) => l.id)).toEqual(['demo-2']);
    expect(e.filter((x) => x.kind === 'layout').map((x) => (x.kind === 'layout' ? x.layout.id : ''))).toEqual(['single', 'strip-2', 'strip-4', 'grid-2x2', 'classic']);
  });
  it('only one ordinary layout left still gives a picker', () => {
    expect(kinds(ALL.filter((i) => i !== 'classic'))).toEqual(['classic']);
  });
  it('does not mutate the registry', () => {
    visibleLayouts(LAYOUTS, ['single']);
    expect(LAYOUTS.map((l) => l.id)).toEqual(ALL);
  });
});

describe('setHidden', () => {
  it('hides and shows layouts', () => {
    expect(setHidden([], ['single'], false)).toEqual(['single']);
    expect(setHidden(['single', 'classic'], ['single'], true)).toEqual(['classic']);
  });
  it('flips several layouts at once', () => {
    const two = ['single', 'classic'];
    expect(setHidden([], two, false)).toEqual(two);
    expect(setHidden(two, two, true)).toEqual([]);
  });
  it('refuses to hide the last visible layout (returns the list unchanged)', () => {
    const allButClassic = ALL.filter((i) => i !== 'classic');
    expect(setHidden(allButClassic, ['classic'], false)).toEqual(allButClassic);
  });
});
