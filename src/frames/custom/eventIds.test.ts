import { describe, expect, it } from 'vitest';
import { eventIdsInUse } from './eventIds';
import { addEventProfile, duplicateEventProfile, DEFAULT_SETTINGS } from '../../config/settings';

describe('eventIdsInUse', () => {
  it('collects every event id that frames or layouts still point at, once each, ignoring empty ones', () => {
    expect(eventIdsInUse([{ eventId: 'event-2' }, { eventId: undefined }, { eventId: '' }], [{ eventId: 'event-2' }, { eventId: 'event-3' }, {}]).sort()).toEqual(['event-2', 'event-3']);
    expect(eventIdsInUse([], [])).toEqual([]);
  });
});

describe('a new event after deleting the newest one (the layout-comes-back bug)', () => {
  // event-1 (default) + event-2 exist; event-2 is deleted but its layout record is still stored; event-3 is the one just created.
  const two = addEventProfile(DEFAULT_SETTINGS, { name: 'Two' }, false);
  const withoutTwo = { ...two, events: two.events.filter((e) => e.id !== 'event-2') };
  it('WITHOUT the leftover ids the new event reuses event-2 (this is what made the old layout reappear)', () => {
    expect(addEventProfile(withoutTwo, { name: 'Three' }, false).events.map((e) => e.id)).toContain('event-2');
  });
  it('with the leftover ids the new event gets a fresh id, so the old layout stays out of it', () => {
    const next = addEventProfile(withoutTwo, { name: 'Three' }, false, ['event-2']);
    expect(next.events.map((e) => e.id)).toEqual(['event-1', 'event-3']);
  });
  it('a copy of an event also skips leftover ids', () => {
    const next = duplicateEventProfile(withoutTwo, 'event-1', ['event-2']);
    expect(next.events.map((e) => e.id)).toEqual(['event-1', 'event-3']);
  });
});
