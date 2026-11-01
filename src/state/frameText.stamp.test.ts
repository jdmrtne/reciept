// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newSessionStamp } from './stamp';
import { sessionStore } from './session';
import { mergeSettings, saveSettings } from '../config/settings';
import { buildPlan } from '../render/plan';
import { buildSnapshot } from '../editor/model';
import { makeCtx } from '../frames/prims';

function fakeStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => (data.has(k) ? data.get(k)! : null), setItem: (k: string, v: string) => void data.set(k, String(v)), removeItem: (k: string) => void data.delete(k), clear: () => data.clear() };
}
beforeEach(() => { vi.stubGlobal('localStorage', fakeStorage()); sessionStore.reset(); });
afterEach(() => { vi.unstubAllGlobals(); sessionStore.reset(); });

const snap = buildSnapshot('single', [{ src: 'a', iw: 1600, ih: 900 }], 'birthday');
const frameTexts = (stamp: ReturnType<typeof newSessionStamp>, w = 384) => {
  const c = buildPlan(snap, stamp, w).cmds.find((x) => x.op === 'frame');
  return c && c.op === 'frame' ? c.prims.flatMap((p) => (p.k === 'text' ? [p.text] : [])) : [];
};
const save = (frameText: unknown) => saveSettings(mergeSettings({ frameText }));

describe('the session stamp carries the frame text', () => {
  it('has no frameText key when nothing is overridden (stamp unchanged from before)', () => {
    expect('frameText' in newSessionStamp()).toBe(false);
  });
  it('captures the FINAL (trimmed) overrides at the moment the customer starts', () => {
    save({ birthday: { 'footer.0': '  GOOD LUCK  ', 'header.0': '' } });
    expect(newSessionStamp().frameText).toEqual({ birthday: { 'footer.0': 'GOOD LUCK', 'header.0': '' } });
  });
  it('the plan uses that text at every width, and later settings changes do not touch it', () => {
    save({ birthday: { 'footer.0': 'GOOD LUCK' } });
    const stamp = newSessionStamp();
    expect(frameTexts(stamp)).toContain('GOOD LUCK');
    expect(frameTexts(stamp)).not.toContain('MAKE A WISH');
    const before = frameTexts(stamp);
    expect(frameTexts(stamp, 576)).toEqual(before);
    save({ birthday: { 'footer.0': 'SOMETHING ELSE', 'header.1': '' } });
    expect(frameTexts(stamp)).toEqual(before); // this customer keeps what they started with
    expect(frameTexts(newSessionStamp())).toContain('SOMETHING ELSE'); // the NEXT customer gets the edit
  });
  it('without overrides a plan equals the one made from a plain stamp', () => {
    const plain = makeCtx('PHOTOBOOTH', new Date(2026, 9, 2, 13, 35));
    expect(frameTexts(plain)).toEqual(['HAPPY', 'BIRTHDAY', 'MAKE A WISH', '2026.10.02']);
  });
});
