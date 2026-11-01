import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../config/settings';
import { INSTALLED } from '../../pwa/version';
import { SECTIONS } from './sections';
import { searchSettings } from './search';
import type { AdminCtx } from './types';

const noop = () => {};
const ctx: AdminCtx = { s: DEFAULT_SETTINGS, set: () => true, tune: noop, busy: false, testUrl: null, notify: noop, clearNotice: noop, actions: { pair: noop, testPrint: noop, testShare: noop, changePin: noop } };
const sec = SECTIONS.find((s) => s.id === 'updates')!;
const card = (id: string) => renderToStaticMarkup(<>{sec.cards.find((c) => c.id === id)!.render(ctx)}</>);

describe('ADMIN > Updates', () => {
  it('is a section with a status tab and a source tab, after the existing sections', () => {
    expect(sec.tabs.map((t) => t.id)).toEqual(['check', 'source']);
    expect(SECTIONS[SECTIONS.length - 1].id).toBe('updates');
    expect(SECTIONS.slice(0, 9).map((s) => s.id)).toEqual(['events', 'layouts', 'frames', 'printer', 'quality', 'sharing', 'autosave', 'appearance', 'security']);
  });
  it('shows the installed version, the latest slot and the three actions', () => {
    const h = card('updates-check');
    expect(h).toContain('INSTALLED VERSION');
    expect(h).toContain(`v${INSTALLED.version}`);
    expect(h).toContain('LATEST AVAILABLE');
    expect(h).toContain('NOT CHECKED');
    expect(h).toContain('CHECK FOR UPDATES');
    expect(h).toContain('DOWNLOAD UPDATE');
    expect(h).toContain('INSTALL AND RESTART');
  });
  it('starts with CHECK enabled and DOWNLOAD / INSTALL disabled (nothing to act on yet)', () => {
    const h = card('updates-check');
    const btn = (label: string) => new RegExp(`<button[^>]*?(disabled=""[^>]*)?>${label}</button>`).exec(h)?.[0] ?? '';
    expect(btn('CHECK FOR UPDATES')).not.toContain('disabled');
    expect(btn('DOWNLOAD UPDATE')).toContain('disabled');
    expect(btn('INSTALL AND RESTART')).toContain('disabled');
    expect(h).toContain('NOT CHECKED YET');
  });
  it('shows the default source and lets it be changed or reset', () => {
    const h = card('updates-source');
    expect(h).toContain('/version.json');
    expect(h).toContain('(DEFAULT)');
    expect(h).toContain('SAVE SOURCE');
    expect(h).toContain('USE DEFAULT');
  });
  it('is found by search', () => {
    const find = (q: string) => searchSettings(SECTIONS, q).map((h) => h.card.id);
    expect(find('check for updates')).toContain('updates-check');
    expect(find('update source')).toContain('updates-source');
    expect(find('version')).toContain('updates-check');
  });
  it('writes no em dashes and no emoji in its text', () => {
    const h = card('updates-check') + card('updates-source');
    expect(h).not.toMatch(/\u2014|\u2013/);
    expect(h).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
