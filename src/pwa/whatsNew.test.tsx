import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildKey, pendingAnnouncement, readSeen, recordSeen, SEEN_KEY } from './whatsNew';
import { createUpdater, PENDING_KEY } from './updater';
import { WhatsNewPrompt } from '../screens/WhatsNewPrompt';
import type { KeyValue } from './updateSource';

const mem = (): KeyValue & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
};
const HISTORY = [
  { version: '1.2.0', notes: 'Third change.' },
  { version: '1.1.0', notes: 'Artwork fix.\nPrint copies.' },
  { version: '1.0.5', notes: 'Second change.' },
  { version: '1.0.0', notes: 'Old stuff' }
];
const A = { version: '1.0.0', build: 'aaa1111', builtAt: '2026-10-01T00:00:00Z', notes: 'Old stuff', history: HISTORY.slice(3) };
const B = { version: '1.1.0', build: 'bbb2222', builtAt: '2026-11-01T00:00:00Z', notes: 'Artwork fix.\nPrint copies.', history: HISTORY.slice(1) };
const C = { version: '1.2.0', build: 'ccc3333', builtAt: '2026-11-02T00:00:00Z', notes: 'Third change.', history: HISTORY };

describe('pendingAnnouncement', () => {
  it('first run on a device is not an update: it only remembers the build', () => {
    const s = mem();
    expect(pendingAnnouncement(B, s)).toBeNull();
    expect(readSeen(s)?.key).toBe(buildKey(B));
  });
  it('announces a different build with its notes, and keeps announcing until dismissed', () => {
    const s = mem(); recordSeen(A, s);
    expect(pendingAnnouncement(B, s)).toEqual({ from: '1.0.0', to: '1.1.0', build: 'bbb2222', entries: [{ version: '1.1.0', notes: 'Artwork fix.\nPrint copies.' }, { version: '1.0.5', notes: 'Second change.' }] });
    expect(pendingAnnouncement(B, s)).not.toBeNull(); // another restart before dismissing: still there
    recordSeen(B, s);
    expect(pendingAnnouncement(B, s)).toBeNull();
  });
  it('a device several versions behind is told about EVERY version in between', () => {
    const s = mem(); recordSeen(A, s);
    expect(pendingAnnouncement(C, s)?.entries.map((e) => e.version)).toEqual(['1.2.0', '1.1.0', '1.0.5']);
  });
  it('a new build of the same version number is announced with that build\'s own notes', () => {
    const s = mem(); recordSeen(A, s);
    expect(pendingAnnouncement({ ...A, build: 'ccc3333' }, s)).toMatchObject({ to: '1.0.0', entries: [{ version: '1.0.0', notes: 'Old stuff' }] });
  });
  it('no storage, or unreadable storage, never shows a popup or throws', () => {
    expect(pendingAnnouncement(B, null)).toBeNull();
    const s = mem(); s.data[SEEN_KEY] = '{nope'; expect(() => pendingAnnouncement(B, s)).not.toThrow();
  });
});

describe('update installed from ADMIN on a device with no record yet', () => {
  it('the pending-install flag seeds the record, so standby announces the update', () => {
    const s = mem();
    s.data[PENDING_KEY] = JSON.stringify({ from: A, to: '1.1.0', at: 1 });
    createUpdater({ installed: B, getSource: () => '/version.json', origin: 'https://booth.test', online: () => true, fetch: async () => new Response('{}'), now: () => 1, storage: s, timeouts: { check: 1, download: 1, install: 1 } });
    expect(pendingAnnouncement(B, s)?.from).toBe('1.0.0');
  });
});

describe('WhatsNewPrompt', () => {
  it('shows the versions and the notes after an update', () => {
    const s = mem(); recordSeen(A, s);
    const h = renderToStaticMarkup(<WhatsNewPrompt installed={B} store={s} />);
    expect(h).toContain('BOOTH UPDATED');
    expect(h).toContain('v1.0.0 \u2192 v1.1.0');
    expect(h).toContain('Artwork fix.');
    expect(h).toContain('Second change.');
    expect(h).toContain('>OK<');
  });
  it('lists each skipped version with its own changes when several were missed', () => {
    const s = mem(); recordSeen(A, s);
    const h = renderToStaticMarkup(<WhatsNewPrompt installed={C} store={s} />);
    expect(h).toContain('v1.0.0 \u2192 v1.2.0');
    for (const t of ['v1.2.0', 'Third change.', 'v1.1.0', 'Artwork fix.', 'v1.0.5', 'Second change.']) expect(h).toContain(t);
    expect(h).not.toContain('Old stuff'); // the version it already had is not repeated
  });
  it('says so plainly when the build has no notes', () => {
    const s = mem(); recordSeen(A, s);
    expect(renderToStaticMarkup(<WhatsNewPrompt installed={{ ...B, notes: '', history: [] }} store={s} />)).toContain('now running the new version');
  });
  it('renders nothing when there is nothing new', () => {
    const s = mem(); recordSeen(B, s);
    expect(renderToStaticMarkup(<WhatsNewPrompt installed={B} store={s} />)).toBe('');
  });
});
