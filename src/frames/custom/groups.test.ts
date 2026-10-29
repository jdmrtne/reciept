// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { framesOfEvent, thumbLayout, unassignedSpecialFrames } from './groups';
import type { CustomFrameDef } from './types';

const f = (id: string, createdAt: number, extra: Partial<CustomFrameDef> = {}): CustomFrameDef => ({ id: `custom-${id}`, name: id, createdAt, updatedAt: createdAt, layouts: {}, ...extra });
const ids = (l: CustomFrameDef[]) => l.map((x) => x.name);

describe('framesOfEvent', () => {
  const defs = [
    f('b2', 20, { special: true, eventId: 'event-2' }),
    f('a1', 10, { special: true, eventId: 'event-1' }),
    f('a2', 30, { special: true, eventId: 'event-1' }),
    f('old', 5, { special: true }),
    f('own', 1),
    f('sneaky', 2, { eventId: 'event-1' }) // a normal frame can never join a group, even with a stray eventId
  ];
  it('returns only that event\u2019s frames, in creation order', () => {
    expect(ids(framesOfEvent(defs, 'event-1'))).toEqual(['a1', 'a2']);
    expect(ids(framesOfEvent(defs, 'event-2'))).toEqual(['b2']);
  });
  it('frames of event A never appear for event B, and unknown or empty ids give nothing', () => {
    expect(ids(framesOfEvent(defs, 'event-1'))).not.toContain('b2');
    expect(framesOfEvent(defs, 'event-9')).toEqual([]);
    expect(framesOfEvent(defs, '')).toEqual([]);
    expect(framesOfEvent([], 'event-1')).toEqual([]);
  });
  it('does not change its input', () => {
    const copy = defs.map((d) => d.name);
    framesOfEvent(defs, 'event-1'); unassignedSpecialFrames(defs, ['event-1']);
    expect(defs.map((d) => d.name)).toEqual(copy);
  });
});

describe('unassignedSpecialFrames', () => {
  const defs = [
    f('moved', 40, { special: true, eventId: 'event-1' }),
    f('legacy', 10, { special: true }),
    f('orphan', 20, { special: true, eventId: 'event-gone' }),
    f('empty', 30, { special: true, eventId: '' }),
    f('own', 1)
  ];
  it('lists special frames with no event or an event that no longer exists, in creation order', () => {
    expect(ids(unassignedSpecialFrames(defs, ['event-1', 'event-2']))).toEqual(['legacy', 'orphan', 'empty']);
  });
  it('never lists normal frames, and lists nothing when every special frame has a live event', () => {
    expect(ids(unassignedSpecialFrames(defs, ['event-1']))).not.toContain('own');
    expect(unassignedSpecialFrames([defs[0]], ['event-1'])).toEqual([]);
  });
  it('deleting an event (its id leaves the list) makes its leftover frames unassigned, so they are not lost', () => {
    expect(ids(unassignedSpecialFrames([defs[0]], ['event-2']))).toEqual(['moved']);
  });
  it('treats a non-string eventId from a damaged record as unassigned', () => {
    expect(ids(unassignedSpecialFrames([f('bad', 1, { special: true, eventId: 7 as unknown as string })], ['event-1']))).toEqual(['bad']);
  });
});

describe('thumbLayout', () => {
  const ORDER = ['single', 'strip-2', 'strip-3', 'strip-4', 'grid-2x2', 'classic'];
  it('prefers strip-3, then the first layout in order, else null', () => {
    expect(thumbLayout(['classic', 'strip-3', 'single'], ORDER)).toBe('strip-3');
    expect(thumbLayout(['classic', 'strip-2'], ORDER)).toBe('strip-2');
    expect(thumbLayout([], ORDER)).toBeNull();
  });
});
