import { describe, expect, it } from 'vitest';
import { RELOAD_WINDOW_MS, recoveryAction } from './recovery';

describe('recoveryAction', () => {
  it('wipes the session on a first crash', () => {
    expect(recoveryAction(1_000_000, null)).toBe('reset');
  });
  it('reloads the page when it crashes again straight after a recovery', () => {
    expect(recoveryAction(1_000_000 + RELOAD_WINDOW_MS - 1, 1_000_000)).toBe('reload');
  });
  it('goes back to a plain wipe once the last crash is long enough ago', () => {
    expect(recoveryAction(1_000_000 + RELOAD_WINDOW_MS, 1_000_000)).toBe('reset');
  });
});
