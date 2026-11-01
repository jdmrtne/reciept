import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('footage is clean camera video', () => {
  const src = readFileSync(new URL('./footage.ts', import.meta.url), 'utf8');
  it('never draws text/numbers on a frame, only the raw video (mirrored)', () => {
    expect(src).not.toMatch(/fillText|strokeText|\.font\s*=/);
    expect(src).toMatch(/drawImage\(video/);
  });
  it('the GIF renderer draws no text of its own (only the layout\'s own frame text via the shared overlay)', () => {
    const assets = readFileSync(new URL('./assets.ts', import.meta.url), 'utf8');
    expect(assets).not.toMatch(/fillText|strokeText/);
  });
});
