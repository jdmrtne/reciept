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

describe('thermal upgrade (Photobooth Face)', () => {
  const OLD = { brightness: 0, contrast: 0, dither: 'atkinson', threshold: 128, density: 3, marginX: 8, marginTop: 0, marginBottom: 8, feedLines: 6, cut: true };
  it('moves untouched pre-preset settings to the new look and keeps paper handling', () => {
    const t = mergeSettings({ thermal: OLD }).thermal;
    expect(t).toMatchObject({ brightness: 15, contrast: 35, density: 2, dither: 'floyd-steinberg', sharpen: 65, marginX: 8, feedLines: 6, cut: true });
  });
  it('leaves owner-tuned settings alone', () => {
    expect(mergeSettings({ thermal: { ...OLD, contrast: 20 } }).thermal).toMatchObject({ contrast: 20, dither: 'atkinson', brightness: 0 });
  });
  it('does not re-migrate settings that already know about sharpen (e.g. owner chose LEGACY)', () => {
    expect(mergeSettings({ thermal: { ...OLD, sharpen: 0, autoLevel: 0 } }).thermal).toMatchObject({ dither: 'atkinson', sharpen: 0, autoLevel: 0 });
  });
});

describe('layout visibility setting', () => {
  it('defaults to nothing hidden, including for old stored settings that never had it', () => {
    expect(mergeSettings({}).layoutVisibility).toEqual({ hidden: [] });
    expect(mergeSettings({ printer: 'mock' }).layoutVisibility).toEqual({ hidden: [] });
  });
  it('keeps valid hidden ids and repairs bad values', () => {
    expect(mergeSettings({ layoutVisibility: { hidden: ['single', 'pass-2'] } }).layoutVisibility.hidden).toEqual(['single', 'pass-2']);
    expect(mergeSettings({ layoutVisibility: { hidden: 'single' } }).layoutVisibility.hidden).toEqual([]);
    expect(mergeSettings({ layoutVisibility: null }).layoutVisibility.hidden).toEqual([]);
    expect(mergeSettings({ layoutVisibility: { hidden: ['single', 3, 'ghost', 'single'] } }).layoutVisibility.hidden).toEqual(['single']);
  });
  it('resets to nothing hidden when every layout would be hidden, and is idempotent', () => {
    const all = ['single', 'strip-2', 'strip-3', 'strip-4', 'grid-2x2', 'classic', 'pass-1', 'pass-2', 'pass-3', 'pass-4'];
    expect(mergeSettings({ layoutVisibility: { hidden: all } }).layoutVisibility.hidden).toEqual([]);
    const once = mergeSettings({ layoutVisibility: { hidden: ['classic'] } });
    expect(mergeSettings(once).layoutVisibility).toEqual(once.layoutVisibility);
  });
});
