// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addEventProfile, mergeSettings, setActiveEvent, updateEventProfile, EVENT_LIMITS, type BoothSettings } from '../../config/settings';
import { AdminPanel } from './AdminPanel';
import { AdminScreen } from '../AdminScreen';
import { SECTIONS } from './sections';
import { searchSettings } from './search';
import { eventEditorStore } from './eventEditor';
import { ConfirmDialog } from './ui';
import type { AdminCtx } from './types';

function fakeStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => (data.has(k) ? data.get(k)! : null), setItem: (k: string, v: string) => void data.set(k, String(v)), removeItem: (k: string) => void data.delete(k), clear: () => data.clear() };
}
beforeEach(() => { vi.stubGlobal('localStorage', fakeStorage()); eventEditorStore.reset(); });
afterEach(() => { vi.unstubAllGlobals(); eventEditorStore.reset(); });

const noop = () => {};
const ctxFor = (s: BoothSettings): AdminCtx => ({ s, set: () => true, tune: noop, busy: false, testUrl: null, notify: noop, clearNotice: noop, actions: { pair: noop, testPrint: noop, testShare: noop, changePin: noop } });
const section = SECTIONS.find((x) => x.id === 'events')!;
const card = (id: string, s: BoothSettings) => renderToStaticMarkup(<>{section.cards.find((c) => c.id === id)!.render(ctxFor(s))}</>);
const decode = (h: string) => h.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
/** The opening tag + text of the first <button> whose text contains `label`. */
const button = (html: string, label: string) => { const m = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((x) => x[0]).find((b) => b.replace(/<[^>]+>/g, '').includes(label)); return m ?? ''; };
const disabled = (html: string, label: string) => { const b = button(html, label); expect(b, `button "${label}" exists`).not.toBe(''); return /\sdisabled(=|\s|>)/.test(b); };

const two = (): BoothSettings => {
  let s = mergeSettings({});
  s = updateEventProfile(s, 'event-1', { name: 'WEDDING', header: 'RECEPTION', details: ['BALLROOM'], thankYou: 'MERCI' });
  return addEventProfile(s, { name: 'BIRTHDAY' }, false); // event-1 active
};

describe('the Events section is part of the existing settings map', () => {
  it('is registered with four cards (the Event frames group card sits right under the event list), and ids stay unique across the whole map', () => {
    expect(section.cards.map((c) => c.id)).toEqual(['events-list', 'events-frames', 'events-edit', 'events-preview']);
    const all = SECTIONS.flatMap((s) => s.cards.map((c) => c.id));
    expect(new Set(all).size).toBe(all.length);
    expect(SECTIONS.map((s) => s.id)).toEqual(expect.arrayContaining(['events', 'printer', 'quality', 'sharing', 'appearance', 'security']));
  });
  it('the preview card is the wide-screen aside; the others are not', () => {
    expect(section.cards.map((c) => !!c.aside)).toEqual([false, false, false, true]);
  });
  it('is reachable from search with the words an owner would use', () => {
    const find = (q: string) => searchSettings(SECTIONS, q).map((h) => h.card.id);
    expect(find('event')).toEqual(expect.arrayContaining(['events-list', 'events-edit']));
    for (const q of ['thank you', 'branding', 'venue', 'host', 'header', 'subtitle', 'printed by memorys']) expect(find(q), q).toContain('events-edit');
    for (const q of ['duplicate', 'delete', 'new event', 'active event']) expect(find(q), q).toContain('events-list');
    expect(find('preview')).toContain('events-preview');
  });
  it('the existing sections still render with default settings (nothing was broken by the new one)', () => {
    const s = mergeSettings({});
    for (const sec of SECTIONS) for (const c of sec.cards) expect(renderToStaticMarkup(<>{c.render(ctxFor(s))}</>).length, `${sec.id}/${c.id}`).toBeGreaterThan(20);
  });
  it('the panel lists Events in the navigation and can open on it; the default section is unchanged', () => {
    const def = renderToStaticMarkup(<AdminPanel onChangePin={noop} />);
    expect(def).toContain('Events');
    expect(def).toContain('AUTO-SAVE ON'); // the shared status line is untouched
    expect(def).toContain('Search settings');
    expect(def).toContain('EXIT');
    const open = renderToStaticMarkup(<AdminPanel onChangePin={noop} initialSection="events" />);
    expect(open).toContain('ACTIVE EVENT'); // the Event List tab is the default
    for (const tab of ['Event List', 'Event Details', 'Uploads &amp; Media']) expect(open).toContain(tab);
    // each tab shows only its own cards: the text form and its live preview sit together under Event Details
    expect(open).not.toContain('Event text');
    const details = renderToStaticMarkup(<AdminPanel onChangePin={noop} initialSection="events" initialTab="details" />);
    expect(details).toContain('Event text');
    expect(details).toContain('Receipt preview');
    expect(details).not.toContain('ACTIVE EVENT');
  });
});

describe('event list', () => {
  it('shows every saved profile by name and stable id, marks the active one once, and offers every action', () => {
    const h = decode(card('events-list', two()));
    expect(h).toContain('WEDDING');
    expect(h).toContain('BIRTHDAY');
    expect(h).toContain('#event-1');
    expect(h).toContain('#event-2');
    expect((h.match(/>ACTIVE</g) ?? []).length).toBe(1);
    for (const l of ['CREATE', 'MAKE ACTIVE', 'DUPLICATE', 'RESET TEXT', 'DELETE']) expect(button(h, l), l).not.toBe('');
    expect(h).toContain('NEW EVENT NAME');
    expect(button(h, 'NEW EVENT')).toBe(''); // the old one-press NEW EVENT button is gone: an event is created by typing its name
  });
  it('two events with the same name are listed separately, told apart by id', () => {
    let s = addEventProfile(two(), { name: 'WEDDING' }, false);
    s = setActiveEvent(s, 'event-3');
    const h = decode(card('events-list', s));
    expect((h.match(/WEDDING/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(h).toContain('#event-3');
  });
  it('the active event cannot be made active again or deleted, and the reason is shown', () => {
    const h = decode(card('events-list', two()));
    expect(disabled(h, 'MAKE ACTIVE')).toBe(true);
    expect(disabled(h, 'DELETE')).toBe(true);
    expect(h).toContain('THE ACTIVE EVENT CANNOT BE DELETED');
  });
  it('the last remaining event cannot be deleted', () => {
    const h = decode(card('events-list', mergeSettings({})));
    expect(disabled(h, 'DELETE')).toBe(true);
    expect(h).toContain('THE BOOTH NEEDS AT LEAST ONE EVENT');
  });
  it('an inactive event can be made active and deleted', () => {
    const s = two();
    eventEditorStore.select('event-2');
    const h = decode(card('events-list', s));
    expect(disabled(h, 'MAKE ACTIVE')).toBe(false);
    expect(disabled(h, 'DELETE')).toBe(false);
    expect(disabled(h, 'DUPLICATE')).toBe(false);
    expect(disabled(h, 'CREATE')).toBe(false);
  });
  it('at the profile limit, CREATE and DUPLICATE are off and the limit is explained', () => {
    let s = mergeSettings({});
    while (s.events.length < EVENT_LIMITS.maxEvents) s = addEventProfile(s, {}, false);
    const h = decode(card('events-list', s));
    expect(disabled(h, 'CREATE')).toBe(true);
    expect(disabled(h, 'DUPLICATE')).toBe(true);
    expect(h).toContain(`LIMIT OF ${EVENT_LIMITS.maxEvents} EVENTS`);
  });
  it('profile actions wait while there are unsaved changes, and the list says why', () => {
    const s = two();
    eventEditorStore.select('event-2');
    eventEditorStore.edit(s, { name: 'CHANGED' });
    const h = decode(card('events-list', s));
    for (const l of ['CREATE', 'MAKE ACTIVE', 'DUPLICATE', 'RESET TEXT', 'DELETE']) expect(disabled(h, l), l).toBe(true);
    expect(h).toContain('SAVE OR CANCEL YOUR CHANGES FIRST');
  });
  it('says DUPLICATE copies the text only (frames are not copied) and that CREATE makes an inactive event with just a name', () => {
    const h = decode(card('events-list', two()));
    expect(h).toContain('DUPLICATE copies the event text only. The frames are not copied');
    expect(h).toContain('CREATE makes a new event with just a name. It is not active.');
  });
  it('explains that MAKE ACTIVE applies to the next customer only', () => {
    expect(decode(card('events-list', two()))).toContain('NEXT customer');
  });
});

describe('edit form', () => {
  it('has a labelled control for every field of the real schema (name, header, three detail lines, thank-you, branding switch and text)', () => {
    const h = decode(card('events-edit', two()));
    for (const l of ['EVENT NAME', 'HEADER / TITLE', 'DETAIL LINE 1', 'DETAIL LINE 2', 'DETAIL LINE 3', 'THANK-YOU MESSAGE', 'SHOW BRANDING', 'BRANDING TEXT']) expect(h, l).toContain(l);
    expect(h).toContain('role="switch"');
    expect(h).toContain('Printed by Memorys'); // the default branding text as placeholder
    expect((h.match(/<input/g) ?? []).length).toBe(7);
  });
  it('shows the saved values and live character counters, and nothing limits typing', () => {
    const h = decode(card('events-edit', two()));
    expect(h).toContain('value="WEDDING"');
    expect(h).toContain('value="BALLROOM"');
    expect(h).toContain(`7/${EVENT_LIMITS.lineMax}`);
    expect(h).not.toContain('maxLength');
    expect(h).not.toContain('maxlength');
  });
  it('a clean form has Save and Cancel switched off and says so', () => {
    const h = decode(card('events-edit', two()));
    expect(disabled(h, 'SAVE')).toBe(true);
    expect(disabled(h, 'CANCEL')).toBe(true);
    expect(h).toContain('NO UNSAVED CHANGES');
  });
  it('a changed form shows UNSAVED CHANGES and turns Save and Cancel on', () => {
    const s = two();
    eventEditorStore.edit(s, { header: 'NEW HEADER' });
    const h = decode(card('events-edit', s));
    expect(h).toContain('UNSAVED CHANGES');
    expect(h).toContain('value="NEW HEADER"');
    expect(disabled(h, 'SAVE')).toBe(false);
    expect(disabled(h, 'CANCEL')).toBe(false);
  });
  it('the form edits a DRAFT: the saved profile is not touched', () => {
    const s = two();
    eventEditorStore.edit(s, { name: 'DRAFT' });
    expect(s.events[0].name).toBe('WEDDING');
  });
  it('too-long text is marked, counted, kept as typed, and Save is off', () => {
    const s = two(), long = 'X'.repeat(EVENT_LIMITS.lineMax + 5);
    eventEditorStore.edit(s, { name: long });
    const h = decode(card('events-edit', s));
    expect(h).toContain(long); // not truncated
    expect(h).toContain(`${EVENT_LIMITS.lineMax + 5}/${EVENT_LIMITS.lineMax}`);
    expect(h).toContain('TOO LONG');
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain('role="alert"');
    expect(h).toMatch(/1 PROBLEM TO FIX/);
    expect(disabled(h, 'SAVE')).toBe(true);
    expect(disabled(h, 'CANCEL')).toBe(false); // the owner can always back out
  });
  it('an empty name is flagged as required; empty optional fields are not', () => {
    const s = two();
    eventEditorStore.edit(s, { name: '', header: '', thankYou: '' });
    const h = decode(card('events-edit', s));
    expect(h).toContain('EVENT NAME IS REQUIRED');
    expect(h).not.toMatch(/HEADER[^<]*<\/span>[\s\S]{0,400}REQUIRED/);
    expect(disabled(h, 'SAVE')).toBe(true);
  });
  it('unprintable characters are named in the error', () => {
    const s = two();
    eventEditorStore.edit(s, { thankYou: 'THANKS \u{1F389}' });
    const h = decode(card('events-edit', s));
    expect(h).toContain('CANNOT BE PRINTED');
    expect(h).toContain('\u{1F389}');
  });
  it('turning branding off disables its text box; the switch reflects the draft', () => {
    const s = two();
    eventEditorStore.edit(s, { brandingEnabled: false });
    const h = decode(card('events-edit', s));
    expect(h).toContain('aria-checked="false"');
    expect(h).toMatch(/placeholder="Printed by Memorys"[^>]*disabled/);
  });
  it('tells the owner when they are editing the active event', () => {
    expect(decode(card('events-edit', two()))).toContain('This is the active event');
    eventEditorStore.select('event-2');
    expect(decode(card('events-edit', two()))).not.toContain('This is the active event');
  });
  it('Save and Cancel sit at the top of the form, above every field, so the on-screen keyboard cannot cover them', () => {
    const h = card('events-edit', two());
    expect(h.indexOf('Save or cancel')).toBeGreaterThan(-1);
    expect(h.indexOf('Save or cancel')).toBeLessThan(h.indexOf('EVENT NAME'));
  });
});

describe('preview card', () => {
  it('offers a frame choice and says nothing is printed, saved or sent', () => {
    const h = decode(card('events-preview', two()));
    expect(h).toContain('PREVIEW FRAME');
    expect(h).toContain('<select');
    expect(h).toContain('Nothing is printed, saved or sent');
    expect(h).toContain('DRAWING PREVIEW'); // first paint, before the effect has drawn it
  });
});

describe('confirmation dialog', () => {
  const html = renderToStaticMarkup(<ConfirmDialog title="DELETE THIS EVENT?" body="gone for good" confirmLabel="DELETE" cancelLabel="KEEP IT" danger onCancel={noop} onConfirm={noop} />);
  it('is an accessible alert dialog with a title, a message and both choices', () => {
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby');
    expect(html).toContain('aria-describedby');
    expect(html).toContain('DELETE THIS EVENT?');
    expect(html).toContain('KEEP IT');
    expect(html).toContain('btn danger');
  });
  it('lists the safe choice first', () => expect(html.indexOf('KEEP IT')).toBeLessThan(html.indexOf('>DELETE<')));
});

describe('access: only behind the existing PIN gate, never on guest screens', () => {
  it('opening ADMIN shows the PIN keypad and none of the event controls', () => {
    const h = decode(renderToStaticMarkup(<AdminScreen />));
    expect(h).toMatch(/OWNER PIN/);
    for (const forbidden of ['EVENT NAME', 'MAKE ACTIVE', 'NEW EVENT', 'DELETE', 'THANK-YOU MESSAGE', 'OWNER SETTINGS']) expect(h, forbidden).not.toContain(forbidden);
  });
  const GUEST = ['Standby', 'Layout', 'Camera', 'Edit', 'PreviewScreen', 'PrintScreen', 'ShareScreen', 'SuccessScreen', 'Placeholder'];
  it('no guest-facing screen imports the admin folder or any event-changing function', () => {
    const MUTATORS = /\b(addEventProfile|updateEventProfile|setActiveEvent|deleteEventProfile|duplicateEventProfile|resetEventProfile|eventEditorStore|saveSettings)\b/;
    for (const f of GUEST) {
      const src = readFileSync(`src/screens/${f}.tsx`, 'utf8');
      expect(src, `${f} imports admin`).not.toMatch(/from ['"][./]*admin\//);
      expect(src, `${f} imports AdminPanel/EventSection`).not.toMatch(/AdminPanel|EventSection|eventEditor/);
      expect(src, `${f} changes events or settings`).not.toMatch(MUTATORS);
    }
  });
  it('the event section is only mounted by AdminPanel, and AdminPanel only by AdminScreen (behind PinGate)', () => {
    const app = readFileSync('src/App.tsx', 'utf8'), gate = readFileSync('src/screens/AdminScreen.tsx', 'utf8');
    expect(app).not.toMatch(/AdminPanel|EventSection/);
    expect(gate).toMatch(/PinGate/);
    expect(gate.indexOf("stage === 'lock'")).toBeLessThan(gate.indexOf('<AdminPanel'));
  });
  it('event profiles hold no secrets: the schema is text and a branding switch only', () => {
    expect(Object.keys(mergeSettings({}).events[0]).sort()).toEqual(['brandingEnabled', 'brandingText', 'details', 'header', 'id', 'name', 'thankYou']);
  });
});
