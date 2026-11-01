import { describe, expect, it } from 'vitest';
import { compareVersions, formatBytes, ManifestError, parseManifest, parseVersion, showVersion } from './version';

const O = 'https://booth.test';

describe('compareVersions', () => {
  it('orders numbers numerically, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
  });
  it('ranks a pre-release below its release and compares pre-release parts', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0+abc', '1.0.0+def')).toBe(0);
  });
  it('returns null for anything that is not a version', () => {
    expect(compareVersions('latest', '1.0.0')).toBeNull();
    expect(compareVersions('1.0', '1.0.0')).toBeNull();
    expect(parseVersion(12)).toBeNull();
  });
  it('shows a v prefix once', () => { expect(showVersion('1.2.3')).toBe('v1.2.3'); expect(showVersion('v1.2.3')).toBe('v1.2.3'); expect(showVersion('nope')).toBe('nope'); });
});

describe('parseManifest', () => {
  it('reads a full manifest and keeps only same-site files', () => {
    const m = parseManifest({ version: '1.2.0', build: 'abc1234', builtAt: '2026-11-01T00:00:00Z', notes: ' Fixed things ', files: [{ url: '/assets/a.js', size: 1000 }, { url: 'https://evil.test/x.js', size: 5 }, { url: '/b.css', size: 24 }, { url: '/bad', size: -1 }, { url: 3, size: 1 }, null] }, O);
    expect(m).toMatchObject({ version: '1.2.0', build: 'abc1234', notes: 'Fixed things', totalBytes: 1024 });
    expect(m.files.map((f) => f.url)).toEqual([`${O}/assets/a.js`, `${O}/b.css`]);
  });
  it('accepts a minimal manifest from any host', () => {
    expect(parseManifest({ version: '3.0.0' }, O)).toEqual({ version: '3.0.0', build: null, builtAt: null, notes: null, files: [], totalBytes: null });
  });
  it('rejects things that are not a version file, with a plain message', () => {
    for (const bad of [null, [], 'x', {}, { version: 'soon' }, { version: 2 }]) expect(() => parseManifest(bad, O)).toThrow(ManifestError);
  });
});

describe('formatBytes', () => { it('uses KB then MB', () => { expect(formatBytes(10)).toBe('1 KB'); expect(formatBytes(2048)).toBe('2 KB'); expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB'); }); });
