import { describe, expect, it } from 'vitest';
import type { EventLayoutDef } from '../../frames/custom/eventLayouts';
import { NAME_REQUIRED, QR_CLEARED, addedNotice, deleteLayoutBody, looseTiles, moveTargets, nameProblem, photoCountText, replaceNotes, shownCount, stateText, tileOf, tilesOfEvent, toggleNotice } from './eventLayoutsAdmin';

const def = (id: string, eventId: string, over: Partial<EventLayoutDef> = {}, windows = 2): EventLayoutDef => ({
  id, name: `Layout ${id}`, eventId, createdAt: Number(id.replace(/\D/g, '')) || 1, updatedAt: 1,
  art: { blob: new Blob(['x']), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152, windows: [], slots: Array.from({ length: windows }, () => ({ x: 0.1, y: 0.1, w: 0.8, h: 0.2 })) },
  ...over
});
const events = [{ id: 'event-1', name: 'WEDDING' }, { id: 'event-2', name: 'BIRTHDAY' }, { id: 'event-3', name: '' }];

describe('event layouts admin helpers', () => {
  it('counts photos in plain words', () => {
    expect(photoCountText(1)).toBe('1 PHOTO');
    expect(photoCountText(4)).toBe('4 PHOTOS');
    expect(tileOf(def('evl-a1', 'event-1', {}, 3))).toMatchObject({ label: 'LAYOUT EVL-A1', photos: 3, photoText: '3 PHOTOS', shown: true, stateText: 'SHOWN TO GUESTS' });
  });

  it('a layout is shown unless its own switch is off, whichever event is active', () => {
    expect(tileOf(def('evl-a1', 'event-1', { enabled: false })).shown).toBe(false);
    expect(tileOf(def('evl-a1', 'event-1', { enabled: true })).shown).toBe(true);
    expect(stateText(false)).toBe('HIDDEN FROM GUESTS');
    expect(shownCount([tileOf(def('evl-a1', 'e')), tileOf(def('evl-a2', 'e', { enabled: false }))])).toBe(1);
  });

  it('the grid holds one event only, in creation order', () => {
    const defs = [def('evl-a3', 'event-1'), def('evl-a1', 'event-1'), def('evl-a2', 'event-2')];
    expect(tilesOfEvent(defs, 'event-1').map((t) => t.id)).toEqual(['evl-a1', 'evl-a3']);
    expect(tilesOfEvent(defs, 'event-2').map((t) => t.id)).toEqual(['evl-a2']);
    expect(tilesOfEvent(defs, 'event-9')).toEqual([]);
    expect(tilesOfEvent(defs, '')).toEqual([]);
  });

  it('unassigned = no event or an event that is gone', () => {
    const defs = [def('evl-a1', 'event-1'), def('evl-a2', 'event-gone'), def('evl-a3', ''), def('evl-a4', 'event-2')];
    expect(looseTiles(defs, ['event-1', 'event-2']).map((t) => t.id)).toEqual(['evl-a2', 'evl-a3']);
    expect(looseTiles(defs, ['event-1', 'event-2', 'event-gone', '']).map((t) => t.id)).toEqual(['evl-a3']);
    expect(looseTiles([], ['event-1'])).toEqual([]);
  });

  it('move targets are every other event, with a name even when the event has none typed', () => {
    const nameOf = (e: { name: string }) => e.name || 'EVENT';
    expect(moveTargets(events, 'event-1', nameOf)).toEqual([{ id: 'event-2', label: 'BIRTHDAY' }, { id: 'event-3', label: 'EVENT' }]);
    expect(moveTargets(events, '', nameOf).map((t) => t.id)).toEqual(['event-1', 'event-2', 'event-3']);
    expect(moveTargets([{ id: 'event-1', name: 'A' }], 'event-1', nameOf)).toEqual([]);
  });

  it('a name needs at least one visible character', () => {
    expect(nameProblem('')).toBe(NAME_REQUIRED);
    expect(nameProblem('   ')).toBe(NAME_REQUIRED);
    expect(nameProblem('Dance floor')).toBeNull();
  });

  it('says so when a replaced picture dropped the saved QR spot', () => {
    expect(replaceNotes(false, ['a'])).toEqual(['a']);
    expect(replaceNotes(true, ['a'])).toEqual(['a', QR_CLEARED]);
    expect(replaceNotes(true, [])).toEqual([QR_CLEARED]);
  });

  it('owner text has no emojis and no dashes', () => {
    const texts = [NAME_REQUIRED, QR_CLEARED, deleteLayoutBody('DANCE FLOOR'), addedNotice('DANCE FLOOR', 1), addedNotice('X', 3), toggleNotice('X', true), toggleNotice('X', false), stateText(true), stateText(false), photoCountText(1), photoCountText(2)];
    for (const t of texts) {
      expect(t, t).not.toMatch(/[-\u2010-\u2015\u2212]/);
      expect(t, t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('the delete question names the layout and says it cannot be undone', () => {
    expect(deleteLayoutBody('DANCE FLOOR')).toContain('DANCE FLOOR');
    expect(deleteLayoutBody('DANCE FLOOR')).toContain('cannot be undone');
    expect(addedNotice('DANCE FLOOR', 1)).toBe('LAYOUT DANCE FLOOR ADDED: 1 PHOTO FOUND');
  });
});
