import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_COLOR } from './theme';

/** Reads the real tokens.css, so a future palette edit that hurts readability fails here. */
const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
const block = (open: RegExp) => { const i = css.search(open); const j = css.indexOf('}', i); return css.slice(css.indexOf('{', i) + 1, j); };
const vars = (b: string) => Object.fromEntries([...b.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})/g)].map((m) => [m[1], m[2]]));
const root = vars(block(/^:root \{/m));
const light = root;
const dark = { ...root, ...vars(block(/:root\[data-theme='dark'\]/)) };

const lum = (hex: string) => {
  const h = hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe.each([['light', light], ['dark', dark]] as const)('%s palette contrast (WCAG)', (_name, t) => {
  it('body, ink and muted text reach 4.5:1 on every surface they sit on', () => {
    for (const bg of ['bg', 'surface', 'surface-2']) for (const fg of ['ink', 'text', 'muted']) {
      expect(ratio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('text on an ink fill (selected tabs, switches, SAVED chip) reaches 4.5:1', () => expect(ratio(t['on-ink'], t.ink)).toBeGreaterThanOrEqual(4.5));
  it('outlines are visible against surfaces (3:1 for UI components)', () => {
    for (const bg of ['bg', 'surface', 'surface-2']) expect(ratio(t.edge, t[bg]), `edge on ${bg}`).toBeGreaterThanOrEqual(3);
  });
});

describe('paper stays paper', () => {
  it('muted text on paper reaches 4.5:1', () => { expect(ratio(root['paper-muted'], root.paper)).toBeGreaterThanOrEqual(4.5); expect(ratio(root['paper-muted'], root['paper-fill'])).toBeGreaterThanOrEqual(4.5); });
  it('the dark theme is slate, not pure black', () => { expect(dark.bg.toLowerCase()).not.toBe('#000000'); expect(dark.bg.toLowerCase()).not.toBe('#000'); });
  it('the browser-UI colour matches --bg in both themes', () => { expect(THEME_COLOR.light.toLowerCase()).toBe(light.bg === '#fff' ? '#ffffff' : light.bg.toLowerCase()); expect(THEME_COLOR.dark.toLowerCase()).toBe(dark.bg.toLowerCase()); });
});
