import { describe, expect, it } from 'vitest';
import { mergeSettings } from './settings';

describe('printer selection setting', () => {
  it('keeps every selectable printer kind', () => {
    for (const k of ['mock', 'system', 'usb', 'bluetooth'] as const) expect(mergeSettings({ printer: k }).printer).toBe(k);
  });
  it('repairs an unknown printer back to the default', () => {
    expect(mergeSettings({ printer: 'laser' }).printer).toBe('mock');
  });
});
