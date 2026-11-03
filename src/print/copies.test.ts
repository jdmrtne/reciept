// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { clampCopies, copiesLeft, MAX_COPIES_DEFAULT, MAX_COPIES_LIMIT, normalizeMaxCopies, runCopies } from './copies';
import { DEFAULT_SETTINGS, mergeSettings } from '../config/settings';
import { isPrintBusy, setPrintBusy } from './busy';

const noWait = async () => undefined;

describe('max copies setting', () => {
  it('defaults to 10 and is repaired to 1..30', () => {
    expect(MAX_COPIES_DEFAULT).toBe(10);
    expect(DEFAULT_SETTINGS.maxCopies).toBe(10);
    expect(mergeSettings({}).maxCopies).toBe(10);
    expect(mergeSettings({ maxCopies: 5 }).maxCopies).toBe(5);
    expect(mergeSettings({ maxCopies: 0 }).maxCopies).toBe(1);
    expect(mergeSettings({ maxCopies: 999 }).maxCopies).toBe(MAX_COPIES_LIMIT);
    expect(mergeSettings({ maxCopies: 3.6 }).maxCopies).toBe(4);
    for (const bad of ['7', null, NaN, {}, []]) expect(normalizeMaxCopies(bad)).toBe(10);
  });
});

describe('copies left and clamping', () => {
  it('counts what already came out against the maximum', () => {
    expect(copiesLeft(10, 0)).toBe(10);
    expect(copiesLeft(10, 4)).toBe(6);
    expect(copiesLeft(10, 10)).toBe(0);
    expect(copiesLeft(10, 25)).toBe(0);
    expect(copiesLeft(1, 0)).toBe(1);
  });
  it('keeps the asked number between 1 and what is left, and 0 when nothing is left', () => {
    expect(clampCopies(3, 10, 0)).toBe(3);
    expect(clampCopies(0, 10, 0)).toBe(1);
    expect(clampCopies(-4, 10, 0)).toBe(1);
    expect(clampCopies(50, 10, 0)).toBe(10);
    expect(clampCopies(8, 10, 6)).toBe(4);
    expect(clampCopies(2, 10, 10)).toBe(0);
    expect(clampCopies(NaN, 10, 0)).toBe(1);
  });
});

describe('runCopies', () => {
  it('prints every copy once, in order, and reports progress', async () => {
    const seen: string[] = [];
    const r = await runCopies({ total: 3, alreadyPrinted: 0, wait: noWait, printOne: async (i) => { seen.push(`print ${i}`); }, onCopyStart: (i) => seen.push(`start ${i}`), onCopyDone: (n) => seen.push(`done ${n}`) });
    expect(r).toEqual({ ok: true, printed: 3 });
    expect(seen).toEqual(['start 1', 'print 1', 'done 1', 'start 2', 'print 2', 'done 2', 'start 3', 'print 3', 'done 3']);
  });

  it('one copy prints once and does not wait afterwards', async () => {
    let waits = 0, prints = 0;
    const r = await runCopies({ total: 1, alreadyPrinted: 0, wait: async () => { waits++; }, printOne: async () => { prints++; } });
    expect(r).toEqual({ ok: true, printed: 1 });
    expect([prints, waits]).toEqual([1, 0]);
  });

  it('pauses between copies only (n - 1 times)', async () => {
    const gaps: number[] = [];
    await runCopies({ total: 4, alreadyPrinted: 0, gapMs: 123, wait: async (ms) => { gaps.push(ms); }, printOne: async () => undefined });
    expect(gaps).toEqual([123, 123, 123]);
  });

  it('stops at the first failure and says how many came out', async () => {
    const boom = new Error('usb');
    const done: number[] = [];
    const r = await runCopies({ total: 5, alreadyPrinted: 0, wait: noWait, printOne: async (i) => { if (i === 3) throw boom; }, onCopyDone: (n) => done.push(n) });
    expect(r).toEqual({ ok: false, printed: 2, error: boom });
    expect(done).toEqual([1, 2]);
  });

  it('a retry continues with the REMAINING copies and never prints one twice', async () => {
    const out: number[] = [];
    let failOnce = true;
    const printOne = async (i: number) => { if (i === 3 && failOnce) { failOnce = false; throw new Error('knocked loose'); } out.push(i); };
    const first = await runCopies({ total: 5, alreadyPrinted: 0, wait: noWait, printOne });
    expect(first.ok).toBe(false);
    const retry = await runCopies({ total: 5, alreadyPrinted: first.printed, wait: noWait, printOne });
    expect(retry).toEqual({ ok: true, printed: 5 });
    expect(out).toEqual([1, 2, 3, 4, 5]);
  });

  it('stops quietly when the screen was left (no copy starts after that)', async () => {
    let gone = false, prints = 0;
    const r = await runCopies({ total: 5, alreadyPrinted: 0, wait: noWait, cancelled: () => gone, printOne: async () => { prints++; if (prints === 2) gone = true; } });
    expect(r).toEqual({ ok: false, printed: 2, cancelled: true });
    expect(prints).toBe(2);
  });

  it('nothing to do when every copy is already printed', async () => {
    let prints = 0;
    expect(await runCopies({ total: 2, alreadyPrinted: 2, wait: noWait, printOne: async () => { prints++; } })).toEqual({ ok: true, printed: 2 });
    expect(prints).toBe(0);
  });
});

describe('print busy flag', () => {
  it('toggles and is idempotent', () => {
    setPrintBusy(true); expect(isPrintBusy()).toBe(true);
    setPrintBusy(true); setPrintBusy(false); expect(isPrintBusy()).toBe(false);
  });
});
