import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionStore } from '../../state/session';
import { loadSettings, mergeSettings, saveSettings, type BoothSettings } from '../../config/settings';
import { PAPER_DOTS } from '../../layouts/engine';
import { getPrinterManager, PRINTER_MESSAGES, toPrinterError, type ThermalSettings } from '../../print';
import { makeTestPage } from '../../print/testpage';
import { bitmapToCanvas } from '../../print/browser';
import { canvasToBlob } from '../../render/render';
import { checkShare, type ShareFailure } from '../../share/service';
import { getShareStore, makeSessionId } from '../../share/backend';
import { normalizePublicBase, resolvePageBase } from '../../share/url';
import { Icon } from '../../components/Icon';
import '../../styles/admin.css';
import { SECTIONS } from './sections';
import { searchSettings } from './search';
import { SaveStatus, SettingsCard, Toast, type SaveState } from './ui';
import { ThemeToggle } from './ThemeToggle';
import type { AdminCtx, Notice, NoticeKind, SectionId } from './types';

/** Owner-facing failure text: the plain title plus the technical reason (customers never see this screen). */
const why = (e: unknown) => { const p = toPrinterError(e), t = PRINTER_MESSAGES[p.code].title; return p.message && p.message !== p.code ? `${t} \u2014 ${p.message}` : t; };
/** Read lazily (not at import) so it reflects the share backend actually configured. */
const shareCheckMessage = (code: ShareFailure): string => ({
  config: getShareStore() ? 'SITE URL MISSING: THIS SITE IS NOT REACHABLE FROM PHONES (NO localhost). TYPE THE ADDRESS WHERE THE BOOTH APP IS HOSTED' : 'PUBLIC URL MISSING OR NOT REACHABLE FROM PHONES (NO localhost)',
  upload: getShareStore() ? 'CANNOT UPLOAD TO SUPABASE \u2014 CHECK INTERNET, BUCKET photobooth-media AND ITS POLICIES (docs/SUPABASE.md)' : 'CANNOT UPLOAD TO THE BRIDGE \u2014 IS `npm run bridge` RUNNING? CHECK BRIDGE URL',
  unreachable: 'UPLOAD OK BUT THE PUBLIC URL DOES NOT SERVE IT \u2014 CHECK THE TUNNEL / PORT (SHARE_PORT, 9102)',
  collision: 'TEST FILE ID ALREADY EXISTS \u2014 TRY AGAIN',
  missing: 'TEST FILE MISSING', render: 'TEST FILE FAILED', qr: 'QR FAILED'
} as Record<ShareFailure, string>)[code];

let noticeSeq = 0;

/**
 * Owner settings, organised by topic: a section list on the left (a menu on small screens), that section's cards on the right,
 * and a search across all of them. Settings still save the moment they change, exactly as before: there is no Save button
 * because there is no unsaved state; the SAVED indicator and error notices say so instead.
 */
export function AdminPanel({ onChangePin, initialSection = 'printer' }: { onChangePin: () => void; initialSection?: SectionId }) {
  const [s, setS] = useState<BoothSettings>(loadSettings);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [active, setActive] = useState<SectionId>(initialSection);
  const [query, setQuery] = useState('');
  const [save, setSave] = useState<{ status: SaveState; n: number }>({ status: 'idle', n: 0 });
  const rootRef = useRef<HTMLElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const notify = useCallback((kind: NoticeKind, text: string) => setNotice({ id: ++noticeSeq, kind, text }), []);
  const clearNotice = useCallback(() => setNotice(null), []);
  // good news fades by itself; problems stay until dismissed
  useEffect(() => {
    if (notice?.kind !== 'success') return;
    const t = window.setTimeout(() => setNotice((n) => (n && n.id === notice.id ? null : n)), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);
  // the SAVED confirmation settles back to the resting label
  useEffect(() => {
    if (save.status !== 'saved') return;
    const t = window.setTimeout(() => setSave((p) => (p.n === save.n ? { ...p, status: 'idle' } : p)), 2200);
    return () => window.clearTimeout(t);
  }, [save]);

  const apply = (next: BoothSettings) => {
    const ok = saveSettings(next);
    setS(next);
    setSave((p) => ({ status: ok ? 'saved' : 'error', n: p.n + 1 }));
    if (!ok) notify('error', 'COULD NOT SAVE \u2014 THIS DEVICE REFUSED TO STORE SETTINGS. THEY WILL BE LOST WHEN THE PAGE CLOSES');
  };
  const set = (p: Partial<BoothSettings>) => apply(mergeSettings({ ...s, ...p }));
  const tune = (p: Partial<ThermalSettings>) => set({ thermal: { ...s.thermal, ...p } });

  const pair = async () => {
    notify('info', s.printer === 'network' || s.printer === 'windows' ? 'CHECKING PRINTER' : 'CHOOSE YOUR PRINTER IN THE POP-UP');
    setBusy(true);
    try { const mgr = getPrinterManager(); await mgr.select(s.printer); await mgr.pair(); notify('success', s.printer === 'network' || s.printer === 'windows' ? 'PRINTER REACHABLE \u2014 NOW TEST PRINT' : 'PRINTER PAIRED \u2014 NOW TEST PRINT'); }
    catch (e) { notify('error', why(e)); }
    finally { setBusy(false); }
  };

  const testShare = async () => {
    setBusy(true); notify('info', 'CHECKING PHOTO SHARING');
    try {
      const code = await checkShare(makeSessionId(), { fetch: (i, o) => fetch(i, o), bridgeUrl: s.network.bridgeUrl, publicBase: normalizePublicBase(s.share.publicBaseUrl), pageBase: resolvePageBase({ cloud: !!getShareStore(), publicBaseUrl: s.share.publicBaseUrl, origin: location.origin }), store: getShareStore() ?? undefined });
      if (code) notify('error', shareCheckMessage(code)); else notify('success', 'PHOTO SHARING WORKS \u2014 QR CODES WILL APPEAR AFTER PRINTING');
    } finally { setBusy(false); }
  };

  const testPrint = async () => {
    setBusy(true); notify('info', s.printer === 'mock' ? 'TEST PRINTER SELECTED \u2014 NOTHING WILL COME OUT. CHOOSE A REAL PRINTER UNDER PRINTER' : 'PRINTING TEST PAGE');
    try {
      const mgr = getPrinterManager();
      await mgr.select(s.printer);
      const r = await mgr.print(makeTestPage(PAPER_DOTS[s.paperWidthMm]), { thermal: s.thermal, paperDots: PAPER_DOTS[s.paperWidthMm] });
      const blob = await canvasToBlob(bitmapToCanvas(r.bitmap, 1));
      setUrl(URL.createObjectURL(blob));
      if (s.printer === 'mock') notify('info', 'TEST PRINTER ONLY \u2014 NOTHING WAS PRINTED. CHOOSE A REAL PRINTER UNDER PRINTER'); else notify('success', 'TEST PAGE SENT');
    } catch (e) {
      notify('error', why(e));
    } finally { setBusy(false); }
  };

  const ctx: AdminCtx = { s, set, tune, busy, testUrl: url, notify, clearNotice, actions: { pair, testPrint, testShare, changePin: onChangePin } };

  const searching = query.trim() !== '';
  const hits = searching ? searchSettings(SECTIONS, query) : [];
  const section = SECTIONS.find((x) => x.id === active) ?? SECTIONS[0];
  const shown = searching ? hits : section.cards.map((card) => ({ section, card }));
  const hasAside = !searching && shown.some((h) => h.card.aside);

  const go = (id: SectionId) => { setQuery(''); setActive(id); };
  useEffect(() => { paneRef.current?.scrollTo?.({ top: 0 }); rootRef.current?.scrollTo?.({ top: 0 }); }, [active, searching]);

  return (
    <main className="adm" ref={rootRef}>
      <header className="adm-head">
        <h2 className="prt-title adm-title">OWNER SETTINGS</h2>
        <div className="adm-tools">
          <ThemeToggle onFail={() => notify('error', 'THEME CHANGED, BUT THIS DEVICE WOULD NOT REMEMBER IT')} />
          <button type="button" className="btn ghost adm-exit" onClick={() => sessionStore.reset()}><Icon name="close" />EXIT</button>
        </div>
        <div className="adm-search" role="search">
          <Icon name="search" />
          <input type="search" className="adm-in" aria-label="Search settings" placeholder="SEARCH SETTINGS" value={query} autoComplete="off"
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }} />
          {searching && <button type="button" className="adm-clear" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="close" /></button>}
        </div>
      </header>

      <div className="adm-shell">
        <nav className="adm-nav" aria-label="Settings sections">
          {SECTIONS.map((x) => (
            <button key={x.id} type="button" className="adm-nav-i" aria-current={!searching && x.id === active ? 'page' : undefined} onClick={() => go(x.id)}>
              <Icon name={x.icon} /><span>{x.label}</span>
            </button>
          ))}
        </nav>
        <label className="adm-pick">
          <span className="adm-pick-l">SECTION</span>
          <select className="adm-in" value={searching ? '' : active} onChange={(e) => go(e.target.value as SectionId)}>
            {searching && <option value="">SEARCH RESULTS</option>}
            {SECTIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>

        <div className={hasAside ? 'adm-pane wide' : 'adm-pane'} ref={paneRef}>
          <div className="adm-pane-head">
            <div>
              <h3 className="adm-h"><Icon name={searching ? 'search' : section.icon} />{searching ? 'SEARCH RESULTS' : section.label}</h3>
              <p className="adm-sub">{searching ? `${hits.length} ${hits.length === 1 ? 'section' : 'sections'} match \u201C${query.trim()}\u201D` : section.description}</p>
            </div>
            <SaveStatus state={save.status} />
          </div>
          {searching && hits.length === 0 ? (
            <div className="empty">
              <Icon name="search" />
              <p>NOTHING MATCHES {'\u201C'}{query.trim()}{'\u201D'}</p>
              <small>Try {'\u201C'}printer{'\u201D'}, {'\u201C'}dark mode{'\u201D'}, {'\u201C'}brightness{'\u201D'} or {'\u201C'}QR{'\u201D'}.</small>
              <button type="button" className="btn ghost" onClick={() => setQuery('')}>CLEAR SEARCH</button>
            </div>
          ) : (
            <div className={hasAside ? 'cards has-aside' : 'cards'}>
              {shown.map(({ section: sec, card }) => (
                <SettingsCard key={card.id} title={card.title} description={card.description} tag={searching ? sec.label : undefined} aside={!searching && card.aside}>
                  {card.render(ctx)}
                </SettingsCard>
              ))}
            </div>
          )}
        </div>
      </div>
      <Toast notice={notice} onDismiss={clearNotice} />
    </main>
  );
}
