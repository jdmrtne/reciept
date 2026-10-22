import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_PREF, THEME_COLOR, THEME_KEY, loadThemePref, parseThemePref, resolveTheme, saveThemePref } from './theme';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

describe('theme preference', () => {
  it('accepts only light / dark / system and repairs anything else to the default', () => {
    for (const v of ['light', 'dark', 'system'] as const) expect(parseThemePref(v)).toBe(v);
    for (const v of [null, undefined, '', 'DARK', 'blue', 42, {}]) expect(parseThemePref(v)).toBe(DEFAULT_THEME_PREF);
  });
  it('defaults to light so an existing booth looks the same until the owner opts in', () => {
    expect(DEFAULT_THEME_PREF).toBe('light');
    expect(loadThemePref(mem())).toBe('light');
  });
  it('SYSTEM follows the OS; explicit choices ignore it', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('round-trips through storage and reports a write failure', () => {
    const s = mem();
    expect(saveThemePref('dark', s)).toBe(true);
    expect(s.m.get(THEME_KEY)).toBe('dark');
    expect(loadThemePref(s)).toBe('dark');
    expect(saveThemePref('dark', { getItem: () => null, setItem: () => { throw new Error('quota'); } })).toBe(false);
    expect(loadThemePref({ getItem: () => { throw new Error('denied'); }, setItem: () => {} })).toBe('light');
  });
});

describe('index.html pre-paint script (prevents a flash of the wrong theme)', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  it('reads the same storage key as the app', () => expect(html).toContain(`'${THEME_KEY}'`));
  it('sets the same browser-UI colours as the app', () => {
    expect(html).toContain(`'${THEME_COLOR.dark}'`);
    expect(html).toContain(`'${THEME_COLOR.light}'`);
    expect(html).toContain(`<meta name="theme-color" content="${THEME_COLOR.light}"`);
  });
  it('runs before the app bundle', () => expect(html.indexOf("setAttribute('data-theme'")).toBeLessThan(html.indexOf('/src/main.tsx')));
});
