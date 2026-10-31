// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import * as ev from './eventRuntime';
import * as rt from './runtime';
import { allLayouts } from '../../layouts/registry';
import { guestLayouts, visibleEventLayouts } from '../../layouts/visibility';
import { pickerEntries } from '../../layouts/groups';
import { guestFramesForLayout } from '../visibility';
import type { CustomLayoutArt } from './types';

const art = (): CustomLayoutArt => ({
  blob: new Blob(['a'], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152,
  windows: [{ x: 10, y: 10, w: 100, h: 100 }], slots: [{ x: 0.01, y: 0.01, w: 0.1, h: 0.1 }]
});
const mk = async (name: string, eventId: string) => { const r = await ev.createEventLayoutRecord({ name, eventId, art: art() }); if (!r.ok) throw new Error(r.message); return r.value.id; };
const ids = (active: string, hidden: string[] = []) => guestLayouts(allLayouts(), hidden, ev.eventLayoutOfferedFor(active)).map((l) => l.id);

beforeEach(() => {
  (globalThis as any).indexedDB = new FakeIndexedDB(); store.resetStore(); ev.resetEventRuntime(); rt.resetCustomRuntime();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); ev.resetEventRuntime(); rt.resetCustomRuntime(); delete (globalThis as any).indexedDB; });

describe('only the ACTIVE event shows its event layouts', () => {
  it('event 1 active: only event 1 layouts. Switch to event 2: only event 2 layouts (never both at once)', async () => {
    const a1 = await mk('Wedding A', 'event-1'), a2 = await mk('Wedding B', 'event-1'), b1 = await mk('Party A', 'event-2');
    await ev.initEventLayouts();
    expect(ids('event-1')).toEqual(expect.arrayContaining([a1, a2])); expect(ids('event-1')).not.toContain(b1);
    expect(ids('event-2')).toContain(b1); expect(ids('event-2')).not.toEqual(expect.arrayContaining([a1]));
    expect(ids('event-2')).not.toContain(a2);
  });

  it('the picker shows exactly one EVENT SPECIAL group, the active event\'s', async () => {
    await mk('Wedding A', 'event-1'); await mk('Party A', 'event-2');
    await ev.initEventLayouts();
    const groups = (active: string) => pickerEntries(guestLayouts(allLayouts(), [], ev.eventLayoutOfferedFor(active))).flatMap((e) => (e.kind === 'group' ? [e.group.id] : []));
    expect(groups('event-1')).toEqual(['event-1']);
    expect(groups('event-2')).toEqual(['event-2']);
  });

  it('a layout switched off stays off even in the active event; built-in layouts are always there', async () => {
    const off = await mk('Off one', 'event-1'); await mk('On one', 'event-1');
    await ev.setEventLayoutRecordEnabled(off, false);
    await ev.initEventLayouts();
    const got = ids('event-1');
    expect(got).not.toContain(off);
    expect(got).toEqual(expect.arrayContaining(['single', 'strip-3']));
  });

  it('layouts of a deleted or empty event are never offered; an event with no layouts shows only the built-in ones', async () => {
    const lost = await mk('Lost', 'event-gone'); await mk('Mine', 'event-1');
    await ev.initEventLayouts();
    expect(ids('event-1')).not.toContain(lost);
    expect(ids('event-3').some((i) => i.startsWith('evl-'))).toBe(false);
    expect(ids('').some((i) => i.startsWith('evl-'))).toBe(false);
  });

  it('the layout a guest is editing stays in the editor tray even when its event is no longer active', async () => {
    const a = await mk('Wedding A', 'event-1');
    await ev.initEventLayouts();
    const tray = visibleEventLayouts(allLayouts(), ev.eventLayoutOfferedFor('event-2'), a).map((l) => l.id);
    expect(tray).toContain(a);
  });
});

describe('old event special frames follow the active event too', () => {
  it('a special frame is offered only while its event is active; own frames and an unspecified active event are unaffected', async () => {
    await rt.initCustomFrames();
    const f1 = await rt.createCustomFrame('Gala One', true, 'event-1'), f2 = await rt.createCustomFrame('Gala Two', true, 'event-2'), own = await rt.createCustomFrame('Own');
    if (!f1.ok || !f2.ok || !own.ok) throw new Error('create');
    for (const f of [f1, f2, own]) await rt.setCustomLayoutArt(f.value.id, 'single', { ...art(), slots: [{ x: 0.08, y: 0.05, w: 0.84, h: 0.4 }] });
    const offered = (active?: string) => guestFramesForLayout('single', [], null, active).map((f) => f.id);
    expect(offered('event-1')).toContain(f1.value.id); expect(offered('event-1')).not.toContain(f2.value.id);
    expect(offered('event-2')).toContain(f2.value.id); expect(offered('event-2')).not.toContain(f1.value.id);
    expect(offered('event-1')).toContain(own.value.id);
    expect(offered(undefined)).toEqual(expect.arrayContaining([f1.value.id, f2.value.id]));
  });
});
