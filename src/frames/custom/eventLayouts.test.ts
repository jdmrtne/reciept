// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EVENT_LAYOUT_PREFIX, EVENT_NO_GROUP_ID, eventGroupName, isEventLayoutId, isEventLayoutShown, layoutsOfEvent, toLayoutDef, unassignedEventLayouts, type EventLayoutDef } from './eventLayouts';
import { LIMITS, validateArtwork, validateEventLayoutArt } from './validate';
import { CUSTOM_FRAME_PREFIX, type CustomLayoutArt } from './types';
import { LAYOUTS } from '../../layouts/registry';
import { resolveLayout, slotCount } from '../../layouts/engine';
import { groupedLayouts, pickerEntries, photoCount } from '../../layouts/groups';
import { visibleLayouts } from '../../layouts/visibility';
import { makeArt, STRIP, W, heightFor, type Hole } from './fixtures';

/** n stacked windows, 912 x 200 px, on a 1152 wide picture. */
const rows = (n: number): Hole[] => Array.from({ length: n }, (_, i) => ({ x: 120, y: 60 + i * 280, w: 912, h: 200 }));
const picture = (holes: Hole[]) => makeArt(W, Math.max(...holes.map((h) => h.y + h.h)) + 60, holes);
const metaOf = (holes: Hole[]) => { const r = validateEventLayoutArt(picture(holes)); if (!r.ok) throw new Error(r.errors.join(' ')); return r.value; };
const def = (id: string, eventId: string, createdAt: number, holes: Hole[] = rows(2), extra: Partial<EventLayoutDef> = {}): EventLayoutDef =>
  ({ id, name: `Layout ${id}`, eventId, createdAt, updatedAt: createdAt, art: { ...metaOf(holes), blob: new Blob([]) } as CustomLayoutArt, ...extra });
const noDash = (m: string) => !/[\u2013\u2014]/.test(m) && !/\p{Extended_Pictographic}/u.test(m);

describe('LIMITS.maxWindows', () => {
  it('is one constant, 8 to start with', () => expect(LIMITS.maxWindows).toBe(8));
  it('leaves every existing limit as it was', () => {
    expect(LIMITS).toMatchObject({ maxFileBytes: 8 * 1024 * 1024, minWidth: 576, maxWidth: 2304, recommendedWidth: 1152, minHeightRatio: 0.4, maxHeightRatio: 5, maxPixels: 16_000_000, minFill: 0.97, bleedPx: 3, minGapPx: 8 });
  });
});

describe('validateEventLayoutArt', () => {
  it.each([1, 2, 3, 5, LIMITS.maxWindows])('accepts %i windows and counts them itself', (n) => {
    const r = validateEventLayoutArt(picture(rows(n)));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.windows).toHaveLength(n); expect(r.value.slots).toHaveLength(n); expect(r.value.mime).toBe('image/png'); }
  });
  it('rejects a picture with no windows, in plain words', () => {
    const r = validateEventLayoutArt(makeArt(W, 700, []));
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.errors[0]).toContain('No photo windows were found'); expect(r.errors.every(noDash)).toBe(true); }
  });
  it('rejects more than LIMITS.maxWindows', () => {
    const r = validateEventLayoutArt(picture(rows(LIMITS.maxWindows + 1)));
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.errors[0]).toContain(`at most ${LIMITS.maxWindows}`); expect(r.errors.every(noDash)).toBe(true); }
  });
  it('applies the same rectangle rule as standard layouts', () => {
    const r = validateEventLayoutArt(makeArt(W, 700, [{ x: 120, y: 100, w: 912, h: 500, round: 200 }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('not a plain rectangle');
  });
  it('applies the same spacing rule as standard layouts', () => {
    const r = validateEventLayoutArt(makeArt(W, 700, [{ x: 100, y: 100, w: 400, h: 400 }, { x: 504, y: 100, w: 400, h: 400 }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('touch or overlap');
  });
  it('ignores a transparent area that touches the edge but warns about it', () => {
    const r = validateEventLayoutArt(makeArt(W, 700, [{ x: 120, y: 100, w: 912, h: 300 }, { x: 0, y: 450, w: 200, h: 250 }]));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.windows).toHaveLength(1); expect(r.warnings.join(' ')).toContain('the edge of the image'); expect(r.warnings.every(noDash)).toBe(true); }
  });
  it('gives the same slots, ratio and order as validateArtwork on the same picture', () => {
    const a = makeArt(W, heightFor(STRIP(3)), STRIP(3)), std = validateArtwork('strip-3', a), ev = validateEventLayoutArt(a);
    expect(std.ok && ev.ok).toBe(true);
    if (std.ok && ev.ok) expect(ev.value).toEqual(std.value);
  });
  it('carries the mime type it is given', () => {
    const r = validateEventLayoutArt(picture(rows(1)), 'image/webp');
    expect(r.ok && r.value.mime).toBe('image/webp');
  });
});

describe('ids', () => {
  it('start with evl- and never equal a built-in layout id or a custom frame id', () => {
    expect(EVENT_LAYOUT_PREFIX).toBe('evl-');
    expect(EVENT_LAYOUT_PREFIX.startsWith(CUSTOM_FRAME_PREFIX)).toBe(false);
    for (const l of LAYOUTS) { expect(isEventLayoutId(l.id)).toBe(false); expect(l.id.startsWith(EVENT_LAYOUT_PREFIX)).toBe(false); }
    expect(isEventLayoutId('custom-abc')).toBe(false);
    expect(isEventLayoutId('evl-abc')).toBe(true);
  });
  it('refuses the bare prefix, empty and missing ids', () => {
    expect(isEventLayoutId('evl-')).toBe(false);
    expect(isEventLayoutId('')).toBe(false);
    expect(isEventLayoutId(null)).toBe(false);
    expect(isEventLayoutId(undefined)).toBe(false);
  });
});

describe('toLayoutDef', () => {
  it.each([1, 3, 6])('a %i window picture resolves to that many slots through the existing manual path', (n) => {
    const d = def('evl-a', 'e1', 1, rows(n)), l = toLayoutDef(d, 'MARIA');
    expect(l.arrangement.kind).toBe('manual');
    expect(slotCount(l)).toBe(n);
    expect(photoCount(l)).toBe(n);
    const r = resolveLayout(l, 1152);
    expect(r.height).toBe(Math.round(d.art.heightRatio * 1152));
    r.slots.forEach((s, i) => { expect(s.x).toBe(Math.round(d.art.slots[i].x * 1152)); expect(s.y).toBe(Math.round(d.art.slots[i].y * 1152)); expect(s.w).toBe(Math.round(d.art.slots[i].w * 1152)); expect(s.h).toBe(Math.round(d.art.slots[i].h * 1152)); });
    expect(r.header).toBeNull(); expect(r.footer).toBeNull(); expect(r.border).toBe(0);
  });
  it('has no padding, gap, border, header or footer, whatever the paper width', () => {
    const l = toLayoutDef(def('evl-a', 'e1', 1), '');
    expect([l.padding, l.gap, l.border, l.headerHeight, l.footerHeight]).toEqual([0, 0, 0, 0, 0]);
    for (const w of [384, 576]) { const r = resolveLayout(l, w); expect(r.width).toBe(w); expect(r.slots).toHaveLength(2); }
  });
  it('group id = event id and the group name is what it is given', () => {
    expect(toLayoutDef(def('evl-a', 'e1', 1), 'MARIA').group).toEqual({ id: 'e1', name: 'MARIA' });
    expect(toLayoutDef(def('evl-b', '', 1), '').group).toEqual({ id: EVENT_NO_GROUP_ID, name: '' });
  });
  it('copies the slots, so the stored art is never shared with the layout', () => {
    const d = def('evl-a', 'e1', 1), l = toLayoutDef(d, '');
    if (l.arrangement.kind === 'manual') { l.arrangement.slots[0].x = 9; expect(d.art.slots[0].x).not.toBe(9); }
  });
  it('plugs into the picker group machinery: one EVENT SPECIAL group per event, listed before the default layouts', () => {
    const a = toLayoutDef(def('evl-a', 'e1', 1), 'MARIA'), b = toLayoutDef(def('evl-b', 'e1', 2), 'MARIA'), c = toLayoutDef(def('evl-c', 'e2', 3), 'SAM');
    const all = [...LAYOUTS, a, b, c];
    const grouped = groupedLayouts(all), picker = pickerEntries(all);
    expect(grouped.filter((e) => e.kind === 'group')).toHaveLength(2);
    expect(picker.slice(0, 2).every((e) => e.kind === 'group')).toBe(true);
    expect(picker.slice(2).map((e) => (e.kind === 'layout' ? e.layout.id : ''))).toEqual(LAYOUTS.map((l) => l.id));
    const g = picker[0];
    expect(g.kind === 'group' && g.group.id).toBe('e1');
    expect(g.kind === 'group' && g.group.layouts.map((l) => l.id)).toEqual(['evl-a', 'evl-b']);
    expect(g.kind === 'group' && g.group.name).toBe('MARIA');
  });
  it('a group whose layouts are all switched off disappears (the caller filters by isEventLayoutShown before grouping)', () => {
    const shown = def('evl-a', 'e1', 1), off = def('evl-b', 'e2', 2, rows(2), { enabled: false });
    const list = [shown, off].filter(isEventLayoutShown).map((d) => toLayoutDef(d, ''));
    const groups = pickerEntries(visibleLayouts([...LAYOUTS, ...list], [])).filter((e) => e.kind === 'group');
    expect(groups).toHaveLength(1);
  });
});

describe('isEventLayoutShown', () => {
  it('is shown unless enabled is exactly false', () => {
    expect(isEventLayoutShown({})).toBe(true);
    expect(isEventLayoutShown({ enabled: true })).toBe(true);
    expect(isEventLayoutShown({ enabled: false })).toBe(false);
  });
});

describe('layoutsOfEvent and unassignedEventLayouts', () => {
  const defs = [def('evl-3', 'e1', 30), def('evl-1', 'e1', 10), def('evl-2', 'e2', 20), def('evl-4', 'gone', 5), def('evl-5', '', 6)];
  it('lists one event in creation order and ignores the others', () => {
    expect(layoutsOfEvent(defs, 'e1').map((d) => d.id)).toEqual(['evl-1', 'evl-3']);
    expect(layoutsOfEvent(defs, 'e2').map((d) => d.id)).toEqual(['evl-2']);
    expect(layoutsOfEvent(defs, 'nope')).toEqual([]);
    expect(layoutsOfEvent(defs, '')).toEqual([]);
  });
  it('does not change the list it is given', () => { const before = defs.map((d) => d.id); layoutsOfEvent(defs, 'e1'); unassignedEventLayouts(defs, ['e1']); expect(defs.map((d) => d.id)).toEqual(before); });
  it('unassigned = no event id, or an event that no longer exists, in creation order', () => {
    expect(unassignedEventLayouts(defs, ['e1', 'e2']).map((d) => d.id)).toEqual(['evl-4', 'evl-5']);
    expect(unassignedEventLayouts(defs, ['e1', 'e2', 'gone']).map((d) => d.id)).toEqual(['evl-5']);
    expect(unassignedEventLayouts(defs, []).map((d) => d.id)).toEqual(['evl-4', 'evl-5', 'evl-2', 'evl-1', 'evl-3'].sort((a, b) => defs.find((d) => d.id === a)!.createdAt - defs.find((d) => d.id === b)!.createdAt));
  });
  it('breaks a creation-time tie by id, so the order is stable', () => {
    const tie = [def('evl-b', 'e1', 1), def('evl-a', 'e1', 1)];
    expect(layoutsOfEvent(tie, 'e1').map((d) => d.id)).toEqual(['evl-a', 'evl-b']);
  });
});

describe('eventGroupName', () => {
  const events = [{ id: 'e1', name: '  MARIA & JOSE  ' }, { id: 'e2', name: '' }];
  it('is the event name, cleaned with finalText', () => expect(eventGroupName('e1', events)).toBe('MARIA & JOSE'));
  it('is empty for an event without a name', () => expect(eventGroupName('e2', events)).toBe(''));
  it('is empty when the event was deleted, so the card shows only EVENT SPECIAL', () => { expect(eventGroupName('gone', events)).toBe(''); expect(eventGroupName('', events)).toBe(''); });
  it('follows a rename (the id stays, the name changes)', () => expect(eventGroupName('e1', [{ id: 'e1', name: 'NEW NAME' }])).toBe('NEW NAME'));
});
