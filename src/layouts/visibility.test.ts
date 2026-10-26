// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LAYOUTS, PASS_LAYOUTS, STANDARD_LAYOUTS } from './registry';
import { pickerEntries } from './groups';
import { normalizeHidden, setHidden, visibleLayouts } from './visibility';

const ALL = LAYOUTS.map((l) => l.id);
const PASS = PASS_LAYOUTS.map((l) => l.id);
const kinds = (ids: string[]) => pickerEntries(visibleLayouts(LAYOUTS, ids)).map((e) => (e.kind === 'layout' ? e.layout.id : `group:${e.group.id}`));

describe('normalizeHidden', () => {
  it('repairs anything that is not a list of known ids', () => {
    for (const bad of [undefined, null, 'single', 5, {}, { 0: 'single' }]) expect(normalizeHidden(bad)).toEqual([]);
  });
  it('drops non-strings and unknown ids and removes duplicates', () => {
    expect(normalizeHidden(['single', 7, null, 'nope', 'single', 'classic'])).toEqual(['single', 'classic']);
  });
  it('resets to [] when every layout would be hidden', () => {
    expect(normalizeHidden(ALL)).toEqual([]);
    expect(normalizeHidden([...ALL, 'extra'])).toEqual([]);
    expect(normalizeHidden(ALL.slice(1))).toEqual(ALL.slice(1)); // one left visible is fine
  });
});

describe('visibleLayouts + pickerEntries with hidden ids', () => {
  it('nothing hidden = the usual picker: group first, then the six in order', () => {
    expect(kinds([])).toEqual(['group:jlc-20th-special', ...STANDARD_LAYOUTS.map((l) => l.id)]);
  });
  it('the group disappears when all four passes are hidden; ordinary layouts keep their order', () => {
    expect(kinds(PASS)).toEqual(STANDARD_LAYOUTS.map((l) => l.id));
  });
  it('hiding some passes keeps the group with the rest; hiding ordinary layouts keeps the others in order', () => {
    const e = pickerEntries(visibleLayouts(LAYOUTS, ['pass-1', 'pass-4', 'strip-3']));
    const g = e.find((x) => x.kind === 'group');
    expect(g && g.kind === 'group' && g.group.layouts.map((l) => l.id)).toEqual(['pass-2', 'pass-3']);
    expect(e.filter((x) => x.kind === 'layout').map((x) => (x.kind === 'layout' ? x.layout.id : ''))).toEqual(['single', 'strip-2', 'strip-4', 'grid-2x2', 'classic']);
  });
  it('only a group left, or only one ordinary layout left, still gives a picker', () => {
    expect(kinds(STANDARD_LAYOUTS.map((l) => l.id))).toEqual(['group:jlc-20th-special']);
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
  it('flips a whole group at once', () => {
    expect(setHidden([], PASS, false)).toEqual(PASS);
    expect(setHidden(PASS, PASS, true)).toEqual([]);
  });
  it('refuses to hide the last visible layout (returns the list unchanged)', () => {
    const allButClassic = ALL.filter((i) => i !== 'classic');
    expect(setHidden(allButClassic, ['classic'], false)).toEqual(allButClassic);
    const onlyGroup = STANDARD_LAYOUTS.map((l) => l.id);
    expect(setHidden(onlyGroup, PASS, false)).toEqual(onlyGroup);
  });
});
