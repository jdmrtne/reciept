import { describe, expect, it, vi } from 'vitest';
import { loadSettings, mergeSettings, saveSettings } from './settings';
import { FRAMES } from '../frames/registry';

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

describe('frame visibility setting', () => {
  it('defaults to nothing hidden, including for old stored settings', () => {
    expect(mergeSettings({}).frameVisibility).toEqual({ hidden: [] });
    expect(mergeSettings({ printer: 'mock' }).frameVisibility).toEqual({ hidden: [] });
  });
  it('keeps valid ids; repairs bad values; unknown ids and the NCL frame are ignored', () => {
    expect(mergeSettings({ frameVisibility: { hidden: ['event', 'birthday'] } }).frameVisibility.hidden).toEqual(['event', 'birthday']);
    expect(mergeSettings({ frameVisibility: { hidden: 'event' } }).frameVisibility.hidden).toEqual([]);
    expect(mergeSettings({ frameVisibility: null }).frameVisibility.hidden).toEqual([]);
    expect(mergeSettings({ frameVisibility: { hidden: ['event', 4, 'ghost', 'ncl-boarding-pass', 'event'] } }).frameVisibility.hidden).toEqual(['event']);
  });
  it('resets when every standard frame would be hidden, and is idempotent; layouts setting is independent', () => {
    const ids = FRAMES.filter((f) => !f.onlyLayouts).map((f) => f.id);
    expect(mergeSettings({ frameVisibility: { hidden: ids } }).frameVisibility.hidden).toEqual([]);
    const once = mergeSettings({ frameVisibility: { hidden: ['event'] }, layoutVisibility: { hidden: ['single'] } });
    expect(mergeSettings(once)).toMatchObject({ frameVisibility: { hidden: ['event'] }, layoutVisibility: { hidden: ['single'] } });
  });
});

describe('standby photo setting (metadata only)', () => {
  it('defaults to no photo, cover fit, receipt shown', () => {
    expect(mergeSettings({}).standbyPhoto).toEqual({ enabled: false, fit: 'cover', showReceipt: true, version: 0 });
  });
  it('keeps valid values', () => {
    expect(mergeSettings({ standbyPhoto: { enabled: true, fit: 'contain', showReceipt: false, version: 7 } }).standbyPhoto).toEqual({ enabled: true, fit: 'contain', showReceipt: false, version: 7 });
  });
  it('repairs invalid values back to the defaults', () => {
    for (const bad of [null, 5, 'x', [], { enabled: 'yes', fit: 'stretch', showReceipt: 0, version: -3 }, { version: 1.5 }, { version: NaN }]) {
      expect(mergeSettings({ standbyPhoto: bad }).standbyPhoto, JSON.stringify(bad)).toEqual({ enabled: false, fit: 'cover', showReceipt: true, version: 0 });
    }
  });
  it('round-trips through save/load and never stores image data in the settings JSON', () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    vi.stubGlobal('localStorage', ls);
    try {
      const s = mergeSettings({ standbyPhoto: { enabled: true, fit: 'contain', showReceipt: false, version: 3, data: 'data:image/jpeg;base64,AAAA', blob: 'XXXX' } });
      expect(saveSettings(s)).toBe(true);
      const raw = store.get('booth.settings.v1')!;
      expect(raw).not.toMatch(/data:image|base64|AAAA|XXXX/);
      expect(Object.keys(JSON.parse(raw).standbyPhoto).sort()).toEqual(['enabled', 'fit', 'showReceipt', 'version']);
      expect(loadSettings().standbyPhoto).toEqual({ enabled: true, fit: 'contain', showReceipt: false, version: 3 });
    } finally { vi.unstubAllGlobals(); }
  });
});
