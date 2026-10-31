// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import * as rt from './runtime';
import * as ev from './eventRuntime';
import { convertEventFrame, convertKey, planConversion } from './convertEventFrame';
import { getLayout } from '../../layouts/registry';
import type { CustomLayoutArt } from './types';

const art = (n = 1, qr = false): CustomLayoutArt => ({
  blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152,
  windows: Array.from({ length: n }, (_, i) => ({ x: 100, y: 100 + i * 400, w: 900, h: 300 })),
  slots: Array.from({ length: n }, (_, i) => ({ x: 0.08, y: 0.08 + i * 0.2, w: 0.8, h: 0.15 })), ...(qr ? { qr: { x: 0.5, y: 0.85, w: 0.4, h: 0.1 } } : {})
});
const nameOf = (l: string) => getLayout(l).name;
let n = 0;
async function oldFrame(name = 'Gala', eventId = 'event-1') {
  const r = await rt.createCustomFrame(name, true, eventId); if (!r.ok) throw new Error(r.message);
  for (const [l, a] of [['strip-3', art(3, true)], ['single', art(1)]] as const) { const s = await rt.setCustomLayoutArt(r.value.id, l, a); if (!s.ok) throw new Error(s.message); }
  return rt.customRecord(r.value.id)!;
}
beforeEach(async () => {
  (globalThis as any).indexedDB = new FakeIndexedDB(); store.resetStore(); rt.resetCustomRuntime(); ev.resetEventRuntime(); n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${++n}`); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  await rt.initCustomFrames(); await ev.initEventLayouts();
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); rt.resetCustomRuntime(); ev.resetEventRuntime(); delete (globalThis as any).indexedDB; });

describe('copy an old event frame into layouts (EL-6)', () => {
  it('plans one layout per picture, in the usual layout order, named after the frame', async () => {
    const f = await oldFrame(), plan = planConversion(f, [], nameOf);
    expect(plan.total).toBe(2); expect(plan.done).toBe(0);
    expect(plan.items.map((i) => i.layoutId)).toEqual(['single', 'strip-3']);
    expect(plan.items[0].name).toBe('Gala Single');
    expect(plan.items.map((i) => i.key)).toEqual([convertKey(f.id, 'single'), convertKey(f.id, 'strip-3')]);
  });

  it('creates hidden layouts in the event, keeps picture, windows and QR spot, and leaves the old frame untouched', async () => {
    const f = await oldFrame(), before = JSON.stringify({ id: f.id, name: f.name, special: f.special, eventId: f.eventId, enabled: f.enabled, layouts: Object.keys(f.layouts), rev: f.layouts['strip-3']!.rev });
    const r = await convertEventFrame(f, 'event-1', ev.eventLayoutRecords(), nameOf);
    expect(r).toEqual({ created: ['Gala Single', 'Gala Three Strip'], skipped: 0, failed: [] });
    const defs = ev.eventLayoutRecords();
    expect(defs).toHaveLength(2);
    for (const d of defs) { expect(d.enabled).toBe(false); expect(d.eventId).toBe('event-1'); expect(d.id.startsWith('evl-')).toBe(true); }
    const strip = defs.find((d) => d.convertedFrom === convertKey(f.id, 'strip-3'))!;
    expect(strip.art.slots).toHaveLength(3); expect(strip.art.qr).toEqual({ x: 0.5, y: 0.85, w: 0.4, h: 0.1 });
    const after = rt.customRecord(f.id)!;
    expect(JSON.stringify({ id: after.id, name: after.name, special: after.special, eventId: after.eventId, enabled: after.enabled, layouts: Object.keys(after.layouts), rev: after.layouts['strip-3']!.rev })).toBe(before);
    expect(rt.customRecords()).toHaveLength(1);
  });

  it('is repeatable: a second press copies nothing, a new picture is copied alone', async () => {
    const f = await oldFrame();
    await convertEventFrame(f, 'event-1', ev.eventLayoutRecords(), nameOf);
    const again = await convertEventFrame(f, 'event-1', ev.eventLayoutRecords(), nameOf);
    expect(again).toEqual({ created: [], skipped: 2, failed: [] });
    expect(ev.eventLayoutRecords()).toHaveLength(2);
    await rt.setCustomLayoutArt(f.id, 'grid-2x2', art(4));
    const third = await convertEventFrame(rt.customRecord(f.id)!, 'event-1', ev.eventLayoutRecords(), nameOf);
    expect(third.created).toHaveLength(1); expect(third.skipped).toBe(2);
    expect(ev.eventLayoutRecords()).toHaveLength(3);
  });

  it('copies into the event the caller picked (an unassigned old frame) and refuses an empty event', async () => {
    const f = await oldFrame('Old party', '');
    expect((await convertEventFrame(f, '', [], nameOf)).failed).toHaveLength(2);
    expect(ev.eventLayoutRecords()).toHaveLength(0);
    const r = await convertEventFrame(f, 'event-2', [], nameOf);
    expect(r.created).toHaveLength(2);
    expect(ev.eventLayoutRecords().every((d) => d.eventId === 'event-2')).toBe(true);
  });

  it('a failed copy is reported, never thrown, and what worked stays', async () => {
    const f = await oldFrame(); let k = 0;
    const r = await convertEventFrame(f, 'event-1', [], nameOf, { create: async (i) => { if (++k === 1) throw new Error('boom'); return ev.createEventLayoutRecord(i); } });
    expect(r.created).toHaveLength(1); expect(r.failed).toEqual(['Gala Single']);
    expect(ev.eventLayoutRecords()).toHaveLength(1);
  });

  it('a layout without a source (made by ADD LAYOUT) has no convertedFrom and starts shown', async () => {
    const r = await ev.createEventLayoutRecord({ name: 'Plain', eventId: 'event-1', art: art(2) });
    expect(r.ok && r.value.convertedFrom).toBeUndefined(); expect(r.ok && r.value.enabled).toBeUndefined();
  });
});
