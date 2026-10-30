import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminPanel } from './AdminPanel';
import { SECTIONS } from './sections';
import { searchSettings } from './search';
import { swipeDirection, SWIPE } from './swipe';

const noop = () => {};
const labels = (id: string) => SECTIONS.find((s) => s.id === id)!.tabs.map((t) => t.label);

describe('sub-tabs: structure', () => {
  it('every category has the planned sub-tabs, in order', () => {
    expect(labels('events')).toEqual(['Event List', 'Event Details', 'Uploads & Media']);
    expect(labels('layouts')).toEqual(['Layout Options']);
    expect(labels('frames')).toEqual(['Built-in Frames', 'Custom Frames']);
    expect(labels('frameText')).toEqual(['Text Editor']); // editor and live preview stay together
    expect(labels('printer')).toEqual(['Printer Setup', 'Connection', 'Testing']);
    expect(labels('quality')).toEqual(['Photo Quality', 'Paper & Cutting', 'Test Print']);
    expect(labels('sharing')).toEqual(['QR Sharing', 'Photo Links']);
    expect(labels('autosave')).toEqual(['Save Options', 'Storage Location']);
    expect(labels('appearance')).toEqual(['Theme', 'Standby Screen']);
    expect(labels('security')).toEqual(['Owner PIN']);
  });
  it('keeps all ten sidebar categories, in the same order', () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(['Events', 'Layouts', 'Frames', 'Frame text', 'Printer', 'Print quality', 'Photo sharing', 'Auto-save', 'Appearance', 'Security']);
  });
  it('every card belongs to a tab that exists, tab ids are unique, and no tab is empty', () => {
    for (const s of SECTIONS) {
      const ids = s.tabs.map((t) => t.id);
      expect(new Set(ids).size, s.id).toBe(ids.length);
      for (const c of s.cards) expect(ids, `${s.id}/${c.id}`).toContain(c.tab);
      for (const t of s.tabs) expect(s.cards.some((c) => c.tab === t.id), `${s.id}/${t.id}`).toBe(true);
    }
  });
  it('the unsaved-text drafts are flagged on the tab that holds them', () => {
    expect(SECTIONS.find((s) => s.id === 'events')!.tabs.find((t) => t.id === 'details')!.draft).toBe('event');
    expect(SECTIONS.find((s) => s.id === 'frameText')!.tabs[0].draft).toBe('frameText');
  });
});

describe('sub-tabs: the panel', () => {
  const html = (id: string, tab?: string) => renderToStaticMarkup(<AdminPanel onChangePin={noop} initialSection={id as never} initialTab={tab} />);
  it('shows a tab bar (one selected tab) for a multi-tab category and none for a single-tab one', () => {
    const p = html('printer');
    expect(p).toContain('role="tablist"');
    expect((p.match(/role="tab"/g) ?? []).length).toBe(3);
    expect((p.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect(html('security')).not.toContain('role="tablist"');
    expect(html('layouts')).not.toContain('role="tablist"');
  });
  it('shows only the selected tab\'s cards', () => {
    expect(html('printer')).toContain('Printer type');
    expect(html('printer')).not.toContain('Connection details');
    expect(html('printer', 'connection')).toContain('Connection details');
    expect(html('printer', 'connection')).not.toContain('Printer type');
    expect(html('appearance', 'standby')).toContain('UPLOAD PHOTO');
    expect(html('appearance', 'standby')).not.toContain('Colour scheme');
  });
  it('an unknown remembered tab falls back to the first one', () => {
    expect(html('printer', 'nope')).toContain('Printer type');
  });
  it('the Frame text editor and its preview are on the same screen', () => {
    const h = html('frameText');
    expect(h).toContain('Frame preview');
    expect(h).toContain('card-aside');
  });
});

describe('sub-tabs: search knows the tab', () => {
  it('each hit carries the card\'s tab and tab names are searchable', () => {
    const hit = searchSettings(SECTIONS, 'standby').find((h) => h.card.id === 'appearance-standby')!;
    expect(hit.card.tab).toBe('standby');
    expect(searchSettings(SECTIONS, 'storage location').map((h) => h.card.id)).toContain('autosave-folder');
    expect(searchSettings(SECTIONS, 'custom frames').map((h) => h.card.id)).toContain('frames-custom');
  });
});

describe('swipe decision', () => {
  const p = (x: number, y: number, t = 0) => ({ x, y, t });
  it('swipe left = next (+1), swipe right = previous (-1)', () => {
    expect(swipeDirection(p(300, 100), p(180, 110, 200))).toBe(1);
    expect(swipeDirection(p(100, 100), p(240, 90, 200))).toBe(-1);
  });
  it('ignores vertical scrolling, short moves, slow drags', () => {
    expect(swipeDirection(p(200, 100), p(150, 400, 200))).toBe(0); // mostly vertical
    expect(swipeDirection(p(200, 100), p(120, 330, 200))).toBe(0); // diagonal scroll
    expect(swipeDirection(p(200, 100), p(200 - (SWIPE.minDx - 1), 100, 100))).toBe(0); // too short
    expect(swipeDirection(p(300, 100), p(100, 100, SWIPE.maxMs + 1))).toBe(0); // too slow
  });
});
