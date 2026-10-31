// @vitest-environment node
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Help, Hint, Row, SettingsCard, TextField } from './ui';

const html = (n: ReactElement) => renderToStaticMarkup(n);

describe('"?" help circles keep ADMIN clean', () => {
  it('a Hint is a closed "?" circle: the button is there, the text is in the page but hidden', () => {
    const h = html(<Hint>Some long explanation.</Hint>);
    expect(h).toContain('class="help-btn"'); expect(h).toContain('aria-expanded="false"');
    expect(h).toMatch(/<small[^>]*class="help-t"[^>]*hidden/); expect(h).toContain('Some long explanation.');
  });
  it('an important Hint (a warning, an empty list, a limit) stays on screen with no circle', () => {
    const h = html(<Hint important>LIMIT REACHED.</Hint>);
    expect(h).toContain('<p class="hint">LIMIT REACHED.</p>'); expect(h).not.toContain('help-btn');
  });
  it('card descriptions, row hints and field hints sit behind a circle, and cards without them have none', () => {
    expect(html(<SettingsCard title="T" description="About this card">x</SettingsCard>)).toMatch(/help-btn[\s\S]*card-d[^>]*hidden/);
    expect(html(<Row label="L" hint="About L">x</Row>)).toMatch(/help-btn[\s\S]*About L/);
    expect(html(<TextField label="N" hint="About N" value="" onChange={() => {}} />)).toMatch(/help-btn[\s\S]*field-h[^>]*hidden/);
    expect(html(<SettingsCard title="T">x</SettingsCard>)).not.toContain('help-btn');
    expect(html(<Row label="L">x</Row>)).not.toContain('help-btn');
  });
  it('the circle names itself and points at its text', () => {
    const h = html(<Help>Text</Help>);
    const id = /aria-controls="([^"]+)"/.exec(h)?.[1];
    expect(id).toBeTruthy(); expect(h).toContain(`id="${id}"`); expect(h).toContain('aria-label="Show help"');
  });
});
