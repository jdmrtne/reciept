import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Standby } from './Standby';
import { Doodles } from '../components/Doodles';

describe('Standby markup (no photo)', () => {
  const html = renderToStaticMarkup(<Standby />);
  it('looks as before: receipt, TAP TO START, big doodles, no photo, no pill', () => {
    expect(html).toContain('class="standby"');
    expect(html).toContain('class="receipt"');
    expect(html).toContain('TAP TO<br/>START');
    expect(html).toContain('class="doodles big"');
    expect(html).not.toContain('standby-photo');
    expect(html).not.toContain('tap-pill');
  });
  it('has the invisible owner zone, hidden from assistive tech and with no content', () => {
    expect(html).toMatch(/<div class="admin-zone" aria-hidden="true"><\/div>/);
  });
  it('the heart is plain decoration now (not tappable)', () => {
    expect(html).not.toContain('tappable');
    expect(renderToStaticMarkup(<Doodles big />)).not.toContain('tappable');
  });
});
