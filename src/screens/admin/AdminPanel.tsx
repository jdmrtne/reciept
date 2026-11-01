import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
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
import { ConfirmDialog, Help, SaveStatus, SettingsCard, Toast, type SaveState } from './ui';
import { eventEditorStore, isDirty } from './eventEditor';
import { frameTextEditorStore, isFrameTextDirty } from './frameTextEditor';
import { ThemeToggle } from './ThemeToggle';
import { SubTabs, panelId, tabId } from './SubTabs';
import { attachSwipe } from './swipe';
import type { AdminCtx, Notice, NoticeKind, SectionDef, SectionId, TabDef } from './types';

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
 * Owner settings, organised by topic: a section list on the left (a menu on small screens), then, for the selected section, a
 * compact row of horizontal sub-tabs (click, arrow keys or swipe) with only the selected tab's cards under it, and a search across all of them. Settings still save the moment they change, exactly as before: there is no Save button
 * because there is no unsaved state; the SAVED indicator and error notices say so instead.
 */
export function AdminPanel({ onChangePin, initialSection = 'printer', initialTab }: { onChangePin: () => void; initialSection?: SectionId; initialTab?: string }) {
  const [s, setS] = useState<BoothSettings>(loadSettings);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [active, setActive] = useState<SectionId>(initialSection);
  const [tabOf, setTabOf] = useState<Partial<Record<SectionId, string>>>(initialTab ? { [initialSection]: initialTab } : {}); // each category remembers its own tab
  const [seen, setSeen] = useState<string[]>([]); // tabs of the open category visited so far: they stay mounted (hidden) so their local state, previews and uploads survive a tab switch
  const [query, setQuery] = useState('');
  const [save, setSave] = useState<{ status: SaveState; n: number }>({ status: 'idle', n: 0 });
  const [leaving, setLeaving] = useState<(() => void) | null>(null); // what the owner wanted to do, waiting for an answer about unsaved event text
  const rootRef = useRef<HTMLElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const uid = useId();

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

  const apply = (next: BoothSettings): boolean => {
    const ok = saveSettings(next);
    setS(next);
    setSave((p) => ({ status: ok ? 'saved' : 'error', n: p.n + 1 }));
    if (!ok) notify('error', 'COULD NOT SAVE \u2014 THIS DEVICE REFUSED TO STORE SETTINGS. THEY WILL BE LOST WHEN THE PAGE CLOSES');
    return ok;
  };
  const set = (p: Partial<BoothSettings>): boolean => apply(mergeSettings({ ...s, ...p }));
  const tune = (p: Partial<ThermalSettings>) => { set({ thermal: { ...s.thermal, ...p } }); };

  // EP-3: unsaved event text. Everything that would throw it away (another section, search, EXIT, closing the page) asks first.
  const editor = useSyncExternalStore(eventEditorStore.subscribe, eventEditorStore.get, eventEditorStore.get);
  const frameDraft = useSyncExternalStore(frameTextEditorStore.subscribe, frameTextEditorStore.get, frameTextEditorStore.get);
  const dirty = isDirty(s, editor) || isFrameTextDirty(s, frameDraft); // unsaved event text OR unsaved frame text
  const leave = (action: () => void) => { if (dirty) setLeaving(() => action); else action(); };
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

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

  const searching = query.trim() !== '';
  const hits = searching ? searchSettings(SECTIONS, query) : [];
  const section = SECTIONS.find((x) => x.id === active) ?? SECTIONS[0];
  const tabs = section.tabs;
  const tab = tabs.find((x) => x.id === tabOf[section.id])?.id ?? tabs[0].id; // a remembered tab that no longer exists falls back to the first
  const tabbed = !searching && tabs.length > 1;
  const cardsOf = (id: string) => section.cards.filter((card) => card.tab === id);
  const hasAside = !searching && cardsOf(tab).some((card) => card.aside);

  // Switching tabs never touches a draft: event / frame text live in their own stores and the visited tabs stay mounted. So no leave() here.
  const showTab = (id: string, sec: SectionDef = section) => {
    setTabOf((p) => (p[sec.id] === id ? p : { ...p, [sec.id]: id }));
    // the tab being left stays mounted (hidden) too, so its drafts-in-progress, previews and uploads are not torn down
    setSeen((p) => { const add = [`${sec.id}/${id}`, ...(sec.id === section.id ? [`${sec.id}/${tab}`] : [])].filter((k) => !p.includes(k)); return add.length ? [...p, ...add] : p; });
  };
  const ctx: AdminCtx = { s, set, tune, busy, testUrl: url, notify, clearNotice, actions: { pair, testPrint, testShare, changePin: onChangePin }, goTab: (id) => { if (tabs.some((x) => x.id === id)) showTab(id); } };

  const go = (id: SectionId) => { if (id === active && !searching) return; leave(() => { setQuery(''); setActive(id); setSeen([]); }); };
  // A search result opens its own category AND tab; the unsaved-text question comes first, exactly like the section list.
  const openHit = (sec: SectionDef, tabId: string) => leave(() => { setQuery(''); setActive(sec.id); setSeen([]); showTab(tabId, sec); });
  const isDirtyTab = (x: TabDef) => (x.draft === 'event' ? isDirty(s, editor) : x.draft === 'frameText' ? isFrameTextDirty(s, frameDraft) : false);
  const tabLabel = (sec: SectionDef, id: string) => sec.tabs.find((x) => x.id === id)?.label ?? '';

  // swipe left = next tab, swipe right = previous (never wraps). Passive touch listeners on the settings body only: scrolling and controls keep working.
  const live = useRef({ tabs, tab, tabbed, section });
  live.current = { tabs, tab, tabbed, section };
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    return attachSwipe(el, (dir) => {
      const { tabs: ts, tab: cur, tabbed: on, section: sec } = live.current;
      if (!on) return;
      const to = ts[ts.findIndex((x) => x.id === cur) + dir];
      if (to) showTab(to.id, sec);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- reads the latest tab through `live`
  useEffect(() => { bodyRef.current?.scrollTo?.({ top: 0 }); paneRef.current?.scrollTo?.({ top: 0 }); rootRef.current?.scrollTo?.({ top: 0 }); }, [active, searching, tab]);

  return (
    <main className="adm" ref={rootRef}>
      <header className="adm-head">
        <h2 className="prt-title adm-title">OWNER SETTINGS</h2>
        <div className="adm-tools">
          <ThemeToggle onFail={() => notify('error', 'THEME CHANGED, BUT THIS DEVICE WOULD NOT REMEMBER IT')} />
          <button type="button" className="btn ghost adm-exit" onClick={() => leave(() => sessionStore.reset())}><Icon name="close" />EXIT</button>
        </div>
        <div className="adm-search" role="search">
          <Icon name="search" />
          <input type="search" className="adm-in" aria-label="Search settings" placeholder="SEARCH SETTINGS" value={query} autoComplete="off"
            onChange={(e) => { const v = e.target.value; if (query.trim() === '' && v.trim() !== '') leave(() => setQuery(v)); else setQuery(v); }} onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }} />
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
              <div className="help-host"><h3 className="adm-h"><Icon name={searching ? 'search' : section.icon} />{searching ? 'SEARCH RESULTS' : section.label}</h3>{!searching && <Help className="adm-sub">{section.description}</Help>}</div>
              {searching && <p className="adm-sub">{`${hits.length} ${hits.length === 1 ? 'section' : 'sections'} match \u201C${query.trim()}\u201D`}</p>}
            </div>
            <SaveStatus state={save.status} />
          </div>
          {tabbed && <SubTabs tabs={tabs} active={tab} onSelect={(id) => showTab(id)} label={`${section.label} sections`} prefix={`${uid}${section.id}`} dirty={isDirtyTab} />}
          <div className="adm-body" ref={bodyRef}>
            {searching ? (
              hits.length === 0 ? (
                <div className="empty">
                  <Icon name="search" />
                  <p>NOTHING MATCHES {'\u201C'}{query.trim()}{'\u201D'}</p>
                  <small>Try {'\u201C'}printer{'\u201D'}, {'\u201C'}dark mode{'\u201D'}, {'\u201C'}brightness{'\u201D'} or {'\u201C'}QR{'\u201D'}.</small>
                  <button type="button" className="btn ghost" onClick={() => setQuery('')}>CLEAR SEARCH</button>
                </div>
              ) : (
                <div className="cards">
                  {hits.map(({ section: sec, card }) => {
                    const multi = sec.tabs.length > 1, where = multi ? `${sec.label} \u203A ${tabLabel(sec, card.tab)}` : sec.label;
                    return (
                      <SettingsCard key={card.id} title={card.title} description={card.description} tag={where} open={{ label: multi ? `OPEN ${tabLabel(sec, card.tab).toUpperCase()}` : `OPEN ${sec.label.toUpperCase()}`, onOpen: () => openHit(sec, card.tab) }}>
                        {card.render(ctx)}
                      </SettingsCard>
                    );
                  })}
                </div>
              )
            ) : (
              tabs.map((x) => {
                const on = x.id === tab;
                if (!on && !seen.includes(`${section.id}/${x.id}`)) return null; // not visited yet: nothing mounted, nothing running
                const list = cardsOf(x.id), aside = list.some((card) => card.aside);
                return (
                  <div key={x.id} className="adm-tabpanel" role={tabbed ? 'tabpanel' : undefined} id={panelId(`${uid}${section.id}`, x.id)} aria-labelledby={tabbed ? tabId(`${uid}${section.id}`, x.id) : undefined} hidden={!on}>
                    <div className={aside ? 'cards has-aside' : 'cards'}>
                      {list.map((card) => (
                        <SettingsCard key={card.id} title={card.title} description={card.description} aside={card.aside}>
                          {card.render(ctx)}
                        </SettingsCard>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      <Toast notice={notice} onDismiss={clearNotice} />
      {leaving && (
        <ConfirmDialog title="UNSAVED CHANGES" body="You changed text but did not save it. Leaving now throws those changes away." confirmLabel="DISCARD AND LEAVE" cancelLabel="KEEP EDITING" danger
          onCancel={() => setLeaving(null)} onConfirm={() => { const go = leaving; setLeaving(null); eventEditorStore.cancel(); frameTextEditorStore.cancel(); go(); }} />
      )}
    </main>
  );
}
