import { describe, expect, it } from 'vitest';
import { armUpdate } from './updateGate';
import { sessionStore } from '../state/session';

describe('armUpdate', () => {
  it('applies immediately when already idle at standby', () => {
    sessionStore.reset(); // → standby
    let applied = 0;
    armUpdate(() => { applied++; });
    expect(applied).toBe(1);
  });

  it('waits while a customer is mid-flow, then applies the moment standby is reached', () => {
    sessionStore.reset();
    sessionStore.go('camera');
    let applied = 0;
    armUpdate(() => { applied++; });
    expect(applied).toBe(0); // not yet — someone is using the booth

    sessionStore.go('edit');
    expect(applied).toBe(0); // still not standby

    sessionStore.go('standby');
    expect(applied).toBe(1); // safe now
  });

  it('applies exactly once even if standby is reached more than once', () => {
    sessionStore.reset();
    sessionStore.go('camera');
    let applied = 0;
    armUpdate(() => { applied++; });

    sessionStore.go('standby');
    sessionStore.go('camera');
    sessionStore.go('standby');
    expect(applied).toBe(1);
  });

  it('a later armUpdate after one already applied arms independently', () => {
    sessionStore.reset(); // standby
    let first = 0, second = 0;
    armUpdate(() => { first++; });
    expect(first).toBe(1);

    sessionStore.go('camera');
    armUpdate(() => { second++; });
    expect(second).toBe(0);
    sessionStore.go('standby');
    expect(second).toBe(1);
  });
});
