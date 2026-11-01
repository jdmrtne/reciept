import { describe, expect, it } from 'vitest';
import { corsOrigin } from '../../bridge/server.mjs';

describe('bridge corsOrigin', () => {
  it('allows any page when no origin list is configured (original behaviour)', () => {
    expect(corsOrigin([], 'https://anything.example')).toBe('*');
    expect(corsOrigin(undefined, undefined)).toBe('*');
  });
  it('echoes only listed origins once a list is configured', () => {
    expect(corsOrigin(['https://booth.example'], 'https://booth.example')).toBe('https://booth.example');
    expect(corsOrigin(['https://booth.example'], 'https://evil.example')).toBeNull();
    expect(corsOrigin(['https://booth.example'], undefined)).toBeNull();
  });
});
