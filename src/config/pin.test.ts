import { describe, expect, it } from 'vitest';
import {
  LOCK_MS, MAX_FAILS, NO_LOCK, createPinRecord, hashPin, isLocked, isValidPin, lockRemainingMs, normalizeAdmin, registerAttempt, verifyPin
} from './pin';

describe('owner PIN', () => {
  it('accepts only 4–8 digits', () => {
    for (const ok of ['1234', '000000', '12345678']) expect(isValidPin(ok)).toBe(true);
    for (const bad of ['', '123', '123456789', '12a4', ' 1234', '12.4', '١٢٣٤']) expect(isValidPin(bad)).toBe(false);
  });

  it('hashes with the salt: same pin+salt is stable, different salt or pin differs, and the pin is not stored', async () => {
    const a = await hashPin('4821', 's1');
    expect(await hashPin('4821', 's1')).toBe(a);
    expect(await hashPin('4821', 's2')).not.toBe(a);
    expect(await hashPin('4822', 's1')).not.toBe(a);
    expect(a).toHaveLength(64); // SHA-256 hex
    const rec = await createPinRecord('4821', 'salty');
    expect(JSON.stringify(rec)).not.toContain('4821');
  });

  it('verifies the right pin and rejects wrong, malformed or missing ones', async () => {
    const rec = await createPinRecord('2580');
    expect(await verifyPin(rec, '2580')).toBe(true);
    expect(await verifyPin(rec, '2581')).toBe(false);
    expect(await verifyPin(rec, '258')).toBe(false);
    expect(await verifyPin(rec, '')).toBe(false);
    expect(await verifyPin(null, '2580')).toBe(false);
  });

  it('refuses to create a record for an invalid pin', async () => {
    await expect(createPinRecord('12')).rejects.toThrow();
  });

  it('two records for the same pin get different salts', async () => {
    const a = await createPinRecord('2580'), b = await createPinRecord('2580');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('lockout', () => {
  it('counts wrong attempts, locks at the limit for LOCK_MS, and success clears it', () => {
    let l = NO_LOCK; const t0 = 1_000_000;
    for (let i = 1; i < MAX_FAILS; i++) { l = registerAttempt(l, false, t0); expect(isLocked(l, t0)).toBe(false); expect(l.fails).toBe(i); }
    l = registerAttempt(l, false, t0);
    expect(isLocked(l, t0)).toBe(true);
    expect(lockRemainingMs(l, t0)).toBe(LOCK_MS);
    expect(lockRemainingMs(l, t0 + 20_000)).toBe(LOCK_MS - 20_000);
    expect(isLocked(l, t0 + LOCK_MS)).toBe(false);
    expect(lockRemainingMs(l, t0 + LOCK_MS + 5)).toBe(0);
    expect(registerAttempt(l, true, t0 + LOCK_MS)).toEqual(NO_LOCK);
  });
  it('after a lock expires the counter starts over (MAX_FAILS more tries)', () => {
    let l = NO_LOCK;
    for (let i = 0; i < MAX_FAILS; i++) l = registerAttempt(l, false, 0);
    expect(l.fails).toBe(0);
    l = registerAttempt(l, false, LOCK_MS + 1);
    expect(l.fails).toBe(1);
  });
});

describe('stored admin state repair', () => {
  it('turns anything malformed into "no pin, no lock"', () => {
    for (const junk of [null, undefined, 5, 'x', [], {}, { pin: 3 }, { pin: { salt: 1, hash: 2 } }, { pin: { salt: '', hash: '' } }]) {
      const a = normalizeAdmin(junk);
      expect(a.pin).toBe(null);
      expect(a.lock).toEqual(NO_LOCK);
    }
  });
  it('keeps a valid record and clamps a tampered lock state', () => {
    const a = normalizeAdmin({ pin: { salt: 's', hash: 'h' }, lock: { fails: 99, lockedUntil: -5 } });
    expect(a.pin).toEqual({ salt: 's', hash: 'h' });
    expect(a.lock.fails).toBe(MAX_FAILS - 1);
    expect(a.lock.lockedUntil).toBe(0);
  });
});
