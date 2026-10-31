// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from './fakeIdb';
import * as store from './store';
import * as ev from './eventRuntime';
import * as rt from './runtime';
import { EVENT_NO_GROUP_ID } from './eventLayouts';
import { DEFAULT_FRAME, FRAMES, STANDARD_FRAMES, framesForLayout, frameForLayout, getFrame, getFrameBands, isFrameAllowed, resolveFramed } from '../registry';
import { frameForLayoutVisible, guestFramesForLayout } from '../visibility';
import { getFrameAsset } from '../assets';
import { LAYOUTS, allLayouts, getLayout } from '../../layouts/registry';
import { resolveLayout } from '../../layouts/engine';
import { pickerEntries } from '../../layouts/groups';
import { guestLayouts, normalizeHidden, visibleEventLayouts } from '../../layouts/visibility';
import { qrAreaFor } from '../../qr/placement';
import type { CustomLayoutArt, CustomQrArea } from './types';

/** EL-3: event layouts wired into the registries. Frame lock, picker data, geometry, and "nothing changes without event layouts". */
let idb: FakeIndexedDB, n: number;
const art = (tag: string, windows: number, qr?: CustomQrArea): CustomLayoutArt => ({
  blob: new Blob([tag], { type: 'image/png' }), mime: 'image/png', width: 1152, height: 2000, heightRatio: 2000 / 1152,
  windows: Array.from({ length: windows }, (_, i) => ({ x: 10, y: 10 + i * 200, w: 100, h: 100 })),
  slots: Array.from({ length: windows }, (_, i) => ({ x: 0.05, y: 0.05 + i * 0.25, w: 0.9, h: 0.2 })),
  ...(qr ? { qr } : {})
});
beforeEach(() => {
  idb = new FakeIndexedDB(); (globalThis as any).indexedDB = idb; store.resetStore(); ev.resetEventRuntime(); rt.resetCustomRuntime(); n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${++n}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); store.resetStore(); ev.resetEventRuntime(); rt.resetCustomRuntime(); delete (globalThis as any).indexedDB; });
const mk = async (name: string, eventId: string, a: CustomLayoutArt) => { const r = await ev.createEventLayoutRecord({ name, eventId, art: a }); if (!r.ok) throw new Error(r.message); return r.value.id; };
const ids = (l: { id: string }[]) => l.map((x) => x.id);
const manual = (a: CustomLayoutArt) => resolveLayout({ id: 'x', name: 'x', arrangement: { kind: 'manual', heightRatio: a.heightRatio, slots: a.slots }, padding: 0, gap: 0, border: 0, headerHeight: 0, footerHeight: 0, background: '#fff' }, 384, { headerHeight: 0, footerHeight: 0, padding: 0 });

describe('EL-3 regression: with no event layouts nothing changes', () => {
  it('getLayout and allLayouts give the built-in layouts, and an unknown or deleted event id falls back to the first layout', () => {
    for (const l of LAYOUTS) expect(getLayout(l.id)).toBe(l);
    for (const id of ['nope', null, 'evl-gone', 'evl-']) expect(getLayout(id)).toBe(LAYOUTS[0]);
    expect(allLayouts()).toEqual(LAYOUTS);
    expect(allLayouts(() => 'NAME', ['a'])).toEqual(LAYOUTS);
  });
  it('framesForLayout, frameForLayout, guest tray and frameForLayoutVisible equal the old rules for every layout', () => {
    const standard = FRAMES.filter((f) => !f.onlyLayouts).map((f) => f.id);
    for (const l of LAYOUTS) {
      expect(ids(framesForLayout(l.id))).toEqual(standard);
      expect(frameForLayout(l.id, null)).toBe(DEFAULT_FRAME);
      expect(frameForLayout(l.id, 'kawaii')).toBe('kawaii');
      expect(frameForLayout(l.id, 'evl-x')).toBe(DEFAULT_FRAME);
      expect(isFrameAllowed('evl-x', l.id)).toBe(false);
      expect(ids(guestFramesForLayout(l.id, [], null))).toEqual(standard);
      expect(frameForLayoutVisible(l.id, 'kawaii', [])).toBe('kawaii');
      expect(frameForLayoutVisible(l.id, null, ['classic-receipt'])).toBe(standard[1]);
    }
  });
  it('resolveFramed equals the layout engine with the frame bands, for every standard frame x layout', () => {
    for (const l of LAYOUTS) for (const f of STANDARD_FRAMES) expect(resolveFramed(l.id, f.id), `${f.id} x ${l.id}`).toEqual(resolveLayout(l, 384, getFrameBands(f, l.id)));
  });
  it('normalizeHidden gives the old answers with the default list and with allLayouts()', () => {
    for (const list of [undefined, allLayouts()]) {
      expect(normalizeHidden('x', list)).toEqual([]);
      expect(normalizeHidden(['single', 'zzz', 'single', 3], list)).toEqual(['single']);
      expect(normalizeHidden(LAYOUTS.map((l) => l.id), list)).toEqual([]);
    }
    expect(ids(guestLayouts(allLayouts(), ['single']))).toEqual(LAYOUTS.filter((l) => l.id !== 'single').map((l) => l.id));
  });
});

describe('EL-3 event layouts in the registries', () => {
  let A: string, B: string, C: string;
  beforeEach(async () => {
    await ev.initEventLayouts();
    A = await mk('Gala 3', 'event-1', art('A', 3)); B = await mk('Gala 1', 'event-1', art('B', 1, { x: 0.5, y: 0.85, w: 0.4, h: 0.12 })); C = await mk('Prom', 'event-2', art('C', 2));
    await ev.setEventLayoutRecordEnabled(C, false); // Prom starts switched off; the tests switch it on
  });

  it('getLayout returns the art as a manual arrangement, grouped by event, and allLayouts lists built-ins first then event layouts', () => {
    const l = getLayout(A);
    expect(l.id).toBe(A); expect(l.arrangement.kind).toBe('manual'); expect(l.group?.id).toBe('event-1');
    expect(resolveLayout(l).slots).toHaveLength(3);
    expect(ids(allLayouts())).toEqual([...ids(LAYOUTS), A, B, C]);
    const named = allLayouts((id) => (id === 'event-1' ? 'GALA' : 'PROM'));
    expect(named.filter((x) => x.group).map((x) => `${x.group!.id}:${x.group!.name}`)).toEqual(['event-1:GALA', 'event-1:GALA', 'event-2:PROM']);
  });
  it('layouts of a deleted or missing event merge into one nameless group', () => {
    const l = allLayouts((id) => (id === 'event-1' ? 'GALA' : ''), ['event-1']).filter((x) => x.group);
    expect(l.map((x) => x.group!.id)).toEqual(['event-1', 'event-1', EVENT_NO_GROUP_ID]);
    expect(l[2].group!.name).toBe('');
  });
  it('the picker lists event groups first, follows each layout own switch, and a group with nothing shown disappears', async () => {
    const entries = () => pickerEntries(guestLayouts(allLayouts((id) => id, ['event-1', 'event-2']), []));
    expect(entries().map((e) => (e.kind === 'group' ? `group:${e.group.id}:${e.group.layouts.length}` : e.layout.id))).toEqual(['group:event-1:2', ...ids(LAYOUTS)]);
    await ev.setEventLayoutRecordEnabled(C, true);
    expect(entries().filter((e) => e.kind === 'group').map((e) => (e as any).group.id)).toEqual(['event-1', 'event-2']);
    await ev.setEventLayoutRecordEnabled(A, false);
    expect(entries().map((e) => (e.kind === 'group' ? `${e.group.id}:${e.group.layouts.length}` : e.layout.id)).slice(0, 2)).toEqual(['event-1:1', 'event-2:1']);
    await ev.setEventLayoutRecordEnabled(B, false); await ev.setEventLayoutRecordEnabled(C, false);
    expect(entries().every((e) => e.kind === 'layout')).toBe(true);
  });
  it('visibleEventLayouts uses the layout own switch and keeps the layout being edited', async () => {
    await ev.setEventLayoutRecordEnabled(A, false);
    expect(ids(visibleEventLayouts(allLayouts()))).toEqual([...ids(LAYOUTS), B]);
    expect(ids(visibleEventLayouts(allLayouts(), ev.eventLayoutEnabled, A))).toEqual([...ids(LAYOUTS), A, B]);
    expect(ids(visibleEventLayouts(allLayouts(), () => true))).toEqual([...ids(LAYOUTS), A, B, C]);
  });
  it('normalizeHidden neither keeps nor revives event ids: they follow their own switch', () => {
    expect(normalizeHidden([A, 'single', 'evl-zzz'], allLayouts())).toEqual(['single']);
    expect(normalizeHidden(LAYOUTS.map((l) => l.id), allLayouts())).toEqual([]);
    expect(normalizeHidden([...LAYOUTS.map((l) => l.id).slice(0, 5), A], allLayouts())).toEqual(LAYOUTS.map((l) => l.id).slice(0, 5));
  });

  it('an event layout has exactly one frame: its own art. Nothing else is offered on it', () => {
    for (const id of [A, B, C]) {
      expect(ids(framesForLayout(id))).toEqual([id]);
      expect(ids(guestFramesForLayout(id, ['classic-receipt'], 'classic-receipt'))).toEqual([id]);
      expect(frameForLayout(id, null)).toBe(id);
      expect(frameForLayout(id, 'kawaii')).toBe(id);
      expect(frameForLayoutVisible(id, 'kawaii', ['classic-receipt', 'kawaii'])).toBe(id);
      expect(getFrame(id).onlyLayouts).toEqual([id]);
      for (const f of FRAMES) expect(isFrameAllowed(f.id, id), `${f.id} on ${id}`).toBe(false);
    }
    expect(isFrameAllowed(A, B)).toBe(false); // the art of one event layout is not offered on another
    expect(frameForLayout(B, A)).toBe(B);
  });
  it('event art is never offered on a standard layout, even as the current frame', () => {
    for (const l of LAYOUTS) {
      for (const id of [A, B, C]) {
        expect(isFrameAllowed(id, l.id)).toBe(false);
        expect(framesForLayout(l.id).map((f) => f.id)).not.toContain(id);
        expect(guestFramesForLayout(l.id, [], id).map((f) => f.id)).not.toContain(id);
        expect(frameForLayout(l.id, id)).toBe(DEFAULT_FRAME);
        expect(frameForLayoutVisible(l.id, id, [])).toBe(DEFAULT_FRAME);
      }
      expect(ids(framesForLayout(l.id))).toEqual(FRAMES.filter((f) => !f.onlyLayouts).map((f) => f.id));
    }
  });
  it('artwork is found only for the event layout itself, and resolveFramed ignores any other frame on it', () => {
    expect(getFrameAsset(getFrame(A), A)?.src).toMatch(/^blob:fake\//);
    expect(getFrameAsset(getFrame(A), A)?.fit).toBe('stretch');
    expect(getFrameAsset(getFrame(A), 'strip-3')).toBeNull();
    expect(getFrameAsset(getFrame(A), B)).toBeNull();
    const want = manual(ev.eventLayoutRecords()[0].art);
    for (const f of [A, 'classic-receipt', 'kawaii', null]) expect({ ...resolveFramed(A, f), id: 'x' }).toEqual(want);
    expect(resolveFramed(A, A, 576).width).toBe(576);
  });
  it('the QR spot of an event layout reaches qrAreaFor; one without a spot has none', () => {
    expect(qrAreaFor(getFrame(B), B)?.safeArea).toEqual({ x: 0.5, y: 0.85, w: 0.4, h: 0.12 });
    expect(qrAreaFor(getFrame(A), A)).toBeNull();
  });
  it('after delete the layout and its art are gone and a session holding the id falls back safely', async () => {
    await ev.deleteEventLayoutRecord(A);
    expect(getLayout(A)).toBe(LAYOUTS[0]);
    expect(getFrame(A)).toBe(FRAMES[0]);
    expect(isFrameAllowed(A, A)).toBe(false);
    expect(isFrameAllowed(A, 'single')).toBe(false);
    expect(frameForLayout(A, A)).toBe(DEFAULT_FRAME);
    expect(ids(framesForLayout(A))).toEqual(FRAMES.filter((f) => !f.onlyLayouts).map((f) => f.id));
    expect(ids(allLayouts())).not.toContain(A);
  });
  it('the preload resolves for an event layout, for one that does not exist, and for everything', async () => {
    await expect(rt.customReady(A, A)).resolves.toBeUndefined();
    await expect(rt.customReady('evl-gone')).resolves.toBeUndefined();
    await expect(rt.customReady()).resolves.toBeUndefined();
    await expect(ev.eventLayoutReady(B)).resolves.toBeUndefined();
  });
});
