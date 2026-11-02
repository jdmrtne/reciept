// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deleteEventContents, type DeleteEventContentsDeps } from './deleteEventContents';

const frame = (id: string, eventId: string | undefined, special = true) => ({ id, name: id, createdAt: 1, special, eventId }) as any;
const layout = (id: string, eventId: string) => ({ id, name: id, eventId, createdAt: 1 }) as any;

const world = (over: Partial<DeleteEventContentsDeps> = {}) => {
  const frames = [frame('f1', 'event-2'), frame('f2', 'event-2'), frame('f3', 'event-3'), frame('own', 'event-2', false), frame('old', undefined)];
  const layouts = [layout('l1', 'event-2'), layout('l2', 'event-2'), layout('l3', 'event-3'), layout('l4', '')];
  const log: string[] = [];
  const deps: DeleteEventContentsDeps = {
    init: async () => { log.push('init'); },
    frames: () => frames, layouts: () => layouts,
    deleteFrame: async (id) => { log.push(`frame:${id}`); return { ok: true }; },
    deleteLayout: async (id) => { log.push(`layout:${id}`); return { ok: true }; },
    ...over
  };
  return { deps, log };
};

describe('deleteEventContents (deleting an event takes its frames and layouts with it)', () => {
  it('loads the lists first, deletes the event frames then the layouts of THAT event, and nothing else', async () => {
    const { deps, log } = world();
    expect(await deleteEventContents('event-2', deps)).toEqual({ ok: true, frames: 2, layouts: 2 });
    expect(log).toEqual(['init', 'frame:f1', 'frame:f2', 'layout:l1', 'layout:l2']); // not event-3's, not a normal own frame, not an unassigned one
  });
  it('an event with nothing in it deletes nothing', async () => {
    const { deps, log } = world();
    expect(await deleteEventContents('event-9', deps)).toEqual({ ok: true, frames: 0, layouts: 0 });
    expect(log).toEqual(['init']);
  });
  it('a layout that refuses to go stops the run and says "layout" (the caller keeps the event)', async () => {
    const { deps, log } = world({ deleteLayout: async (id) => { log2.push(id); return { ok: id !== 'l2' }; } });
    const log2: string[] = [];
    expect(await deleteEventContents('event-2', deps)).toEqual({ ok: false, failed: 'layout' });
    expect(log2).toEqual(['l1', 'l2']); expect(log).toEqual(['init', 'frame:f1', 'frame:f2']);
  });
  it('a frame that refuses to go stops before any layout is touched', async () => {
    const touched: string[] = [];
    const { deps } = world({ deleteFrame: async (id) => ({ ok: id !== 'f1' }), deleteLayout: async (id) => { touched.push(id); return { ok: true }; } });
    expect(await deleteEventContents('event-2', deps)).toEqual({ ok: false, failed: 'frame' });
    expect(touched).toEqual([]);
  });
});
