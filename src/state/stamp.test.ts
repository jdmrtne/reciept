// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureSessionStamp, newSessionStamp } from './stamp';
import { sessionStore } from './session';
import { addEventProfile, deleteEventProfile, getActiveEvent, loadSettings, mergeSettings, saveSettings, setActiveEvent, updateEventProfile, resetEventProfile } from '../config/settings';
import { buildPlan } from '../render/plan';
import { buildSnapshot } from '../editor/model';

function fakeStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => (data.has(k) ? data.get(k)! : null), setItem: (k: string, v: string) => void data.set(k, String(v)), removeItem: (k: string) => void data.delete(k), clear: () => data.clear() };
}
beforeEach(() => { vi.stubGlobal('localStorage', fakeStorage()); sessionStore.reset(); });
afterEach(() => { vi.unstubAllGlobals(); sessionStore.reset(); });

/** Two events saved; WEDDING is active. */
function seed() {
  let s = mergeSettings({});
  s = updateEventProfile(s, 'event-1', { name: 'WEDDING', header: 'RECEPTION', details: ['BALLROOM'], thankYou: 'MERCI' });
  s = addEventProfile(s, { name: 'BIRTHDAY', header: 'PARTY', thankYou: 'SEE YOU' }, false);
  saveSettings(s);
  return s;
}
const snap = buildSnapshot('single', [{ src: 'a', iw: 1600, ih: 900 }], 'kawaii');
const receiptLines = (stamp: ReturnType<typeof newSessionStamp>) => buildPlan(snap, stamp, 384).cmds.flatMap((c) => (c.op === 'info' ? c.lines.map((l) => l.text) : []));

describe('a new customer gets the active event', () => {
  it('the stamp carries the active profile and its name', () => {
    seed();
    const stamp = newSessionStamp();
    expect(stamp.event).toBe('WEDDING');
    expect(stamp.info).toMatchObject({ id: 'event-1', name: 'WEDDING', header: 'RECEPTION', thankYou: 'MERCI' });
  });
  it('the receipt text comes from that same profile snapshot (no mixing of two events)', () => {
    seed();
    const lines = receiptLines(newSessionStamp());
    expect(lines).toContain('WEDDING');
    expect(lines).toContain('RECEPTION');
    expect(lines).toContain('MERCI');
    expect(lines).not.toContain('BIRTHDAY');
    expect(lines).not.toContain('PARTY');
    expect(lines).not.toContain('SEE YOU');
  });
  it('after the owner switches the active event, the NEXT customer uses it', () => {
    const s = seed();
    saveSettings(setActiveEvent(s, 'event-2'));
    const stamp = newSessionStamp();
    expect(stamp.info).toMatchObject({ id: 'event-2', name: 'BIRTHDAY' });
    expect(receiptLines(stamp)).toEqual(expect.arrayContaining(['BIRTHDAY', 'PARTY', 'SEE YOU']));
    expect(receiptLines(stamp)).not.toContain('WEDDING');
  });
});

describe('a customer already in progress keeps their snapshot', () => {
  it('switching the active event does not change the stamp, nor the receipt built from it', () => {
    const s = seed();
    const stamp = newSessionStamp();
    sessionStore.update({ stamp, screen: 'edit' });
    const before = receiptLines(sessionStore.get().stamp!);
    saveSettings(setActiveEvent(s, 'event-2'));
    expect(sessionStore.get().stamp).toBe(stamp); // same object, untouched
    expect(ensureSessionStamp()).toBe(stamp);      // every screen asks for it and gets the snapshot, not a fresh read
    expect(receiptLines(ensureSessionStamp())).toEqual(before);
    expect(stamp.info!.name).toBe('WEDDING');
  });
  it('editing, resetting or deleting profiles in storage does not change the stamp either', () => {
    let s = seed();
    const stamp = newSessionStamp();
    sessionStore.update({ stamp });
    const frozen = JSON.stringify(stamp);
    s = updateEventProfile(s, 'event-1', { name: 'CHANGED', header: 'CHANGED TOO' });
    saveSettings(s);
    s = setActiveEvent(s, 'event-2');
    s = resetEventProfile(s, 'event-1');
    s = deleteEventProfile(s, 'event-1');
    saveSettings(s);
    expect(JSON.stringify(sessionStore.get().stamp)).toBe(frozen);
    expect(receiptLines(sessionStore.get().stamp!)).toContain('WEDDING');
  });
  it('the date and time are part of the same snapshot', () => {
    seed();
    const stamp = newSessionStamp();
    sessionStore.update({ stamp });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2040, 0, 1, 1, 1));
    try { expect(ensureSessionStamp().date).toBe(stamp.date); expect(ensureSessionStamp().time).toBe(stamp.time); } finally { vi.useRealTimers(); }
  });
});

describe('a missing stamp is created once and kept', () => {
  it('ensureSessionStamp stores it, so later screens reuse it instead of minting their own', () => {
    seed();
    expect(sessionStore.get().stamp).toBeNull();
    const first = ensureSessionStamp();
    expect(sessionStore.get().stamp).toBe(first);
    expect(ensureSessionStamp()).toBe(first);
    expect(first.info!.name).toBe('WEDDING');
  });
});

describe('resetting a session never touches saved event profiles', () => {
  it('reset wipes the customer (including the stamp) and leaves every profile and the active choice in storage', () => {
    const s = setActiveEvent(seed(), 'event-2');
    saveSettings(s);
    sessionStore.update({ stamp: newSessionStamp(), screen: 'print' });
    const stored = localStorage.getItem('booth.settings.v1');
    sessionStore.reset();
    expect(sessionStore.get().stamp).toBeNull();
    expect(sessionStore.get().screen).toBe('standby');
    expect(localStorage.getItem('booth.settings.v1')).toBe(stored);
    const back = loadSettings();
    expect(back.events.map((e) => e.id)).toEqual(['event-1', 'event-2']);
    expect(getActiveEvent(back).name).toBe('BIRTHDAY');
  });
  it('the customer after a reset starts from the saved active event', () => {
    saveSettings(setActiveEvent(seed(), 'event-2'));
    sessionStore.update({ stamp: newSessionStamp() });
    sessionStore.reset();
    expect(newSessionStamp().info!.name).toBe('BIRTHDAY');
  });
});
