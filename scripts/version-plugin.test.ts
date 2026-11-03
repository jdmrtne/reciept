import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHistory, readHistory, readNotes } from './version-plugin.mjs';

const project = (version: string, history: string, legacy?: string) => {
  const root = mkdtempSync(join(tmpdir(), 'booth-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(root, 'release-history.txt'), history);
  if (legacy) writeFileSync(join(root, 'release-notes.txt'), legacy);
  return root;
};
const FILE = '# comment\n\n## 0.1.1\nFirst.\n\n## 0.1.3\nThird\nline two.\n\n## 0.1.2\nSecond.\n\n## banana\nignored\n\n## 0.1.4\n\n';

describe('release-history.txt', () => {
  it('parses one entry per version heading, drops empty and invalid ones', () => {
    expect(parseHistory(FILE).map((e) => e.version)).toEqual(['0.1.1', '0.1.3', '0.1.2']);
    expect(parseHistory(FILE)[1].notes).toBe('Third\nline two.');
  });
  it('lists every release newest first and takes the current notes from the current entry', () => {
    const root = project('0.1.3', FILE);
    expect(readHistory(root, {}).map((e) => e.version)).toEqual(['0.1.3', '0.1.2', '0.1.1']);
    expect(readNotes(root, {})).toBe('Third\nline two.');
  });
  it('RELEASE_NOTES overrides the current release only', () => {
    const root = project('0.1.3', FILE);
    const h = readHistory(root, { RELEASE_NOTES: 'From the host' });
    expect(h[0]).toEqual({ version: '0.1.3', notes: 'From the host' });
    expect(h[1].notes).toBe('Second.');
  });
  it('a version bumped without writing its entry still shows, from the legacy release-notes.txt when there is one', () => {
    expect(readHistory(project('0.1.9', FILE, 'Legacy notes'), {})[0]).toEqual({ version: '0.1.9', notes: 'Legacy notes' });
    expect(readHistory(project('0.1.9', FILE), {})[0].version).toBe('0.1.3'); // nothing to say for 0.1.9: the list just has no entry for it
  });
});
