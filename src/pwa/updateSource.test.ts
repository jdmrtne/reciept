import { describe, expect, it } from 'vitest';
import { DEFAULT_SOURCE, SOURCE_KEY, isDefaultSource, isForeignSource, readSource, validateSource, writeSource, type KeyValue } from './updateSource';

const mem = (init: Record<string, string> = {}): KeyValue & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
};

describe('update source', () => {
  it('defaults to this site\'s /version.json and remembers a custom address', () => {
    const s = mem();
    expect(readSource(s, DEFAULT_SOURCE)).toBe('/version.json');
    expect(writeSource('https://other.example/version.json', s, DEFAULT_SOURCE)).toBe(true);
    expect(readSource(s, DEFAULT_SOURCE)).toBe('https://other.example/version.json');
    expect(writeSource(DEFAULT_SOURCE, s, DEFAULT_SOURCE)).toBe(true);
    expect(s.data[SOURCE_KEY]).toBeUndefined(); // the default is stored as "nothing"
    expect(isDefaultSource('/version.json', DEFAULT_SOURCE)).toBe(true);
  });
  it('reports a device that refuses the write', () => {
    const s = mem(); s.setItem = () => { throw new Error('quota'); };
    expect(writeSource('/x.json', s, DEFAULT_SOURCE)).toBe(false);
    expect(writeSource('/x.json', null, DEFAULT_SOURCE)).toBe(false);
  });
  it('validates addresses with plain messages', () => {
    expect(validateSource('/version.json', 'https:')).toEqual({ ok: true, value: '/version.json' });
    expect(validateSource('  https://a.example/v.json ', 'https:')).toEqual({ ok: true, value: 'https://a.example/v.json' });
    expect(validateSource('', 'https:').ok).toBe(false);
    expect(validateSource('two words', 'https:').ok).toBe(false);
    expect(validateSource('version.json', 'https:').ok).toBe(false);
    expect(validateSource('//evil.example/v.json', 'https:').ok).toBe(false);
    expect(validateSource('ftp://a.example/v.json', 'https:').ok).toBe(false);
    const blocked = validateSource('http://a.example/v.json', 'https:');
    expect(blocked.ok).toBe(false);
    expect(validateSource('http://192.168.1.5/v.json', 'http:').ok).toBe(true);
  });
  it('knows when the source is another site', () => {
    expect(isForeignSource('/version.json', 'https://booth.test')).toBe(false);
    expect(isForeignSource('https://booth.test/version.json', 'https://booth.test')).toBe(false);
    expect(isForeignSource('https://raw.githubusercontent.com/x/y/main/version.json', 'https://booth.test')).toBe(true);
  });
});
