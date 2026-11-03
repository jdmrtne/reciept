import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { describeStatus, updater, useUpdater } from '../../pwa/updater';
import { formatBytes, showVersion } from '../../pwa/version';
import { buildDefaultSource, isDefaultSource, isForeignSource, readSource, validateSource, writeSource } from '../../pwa/updateSource';
import { ConfirmDialog, Hint, Row, TextField } from './ui';
import { eventEditorStore, isDirty } from './eventEditor';
import { frameTextEditorStore, isFrameTextDirty } from './frameTextEditor';
import type { AdminCtx, SectionDef } from './types';

const fmtDate = (iso: string | null): string => (iso && !Number.isNaN(Date.parse(iso)) ? iso.slice(0, 10) : '');
const fmtTime = (t: number): string => { try { return new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } };

function Version({ label, version, build, date, hint }: { label: string; version: string; build?: string | null; date?: string; hint?: string }) {
  const extra = [build ? `BUILD ${build}` : '', date ?? ''].filter(Boolean).join(' / ');
  return (
    <Row label={label} hint={hint}>
      <output className="upd-ver" aria-label={label}>{version}{extra && <small>{extra}</small>}</output>
    </Row>
  );
}

function Check({ s, notify }: AdminCtx) {
  const u = useUpdater();
  const editor = useSyncExternalStore(eventEditorStore.subscribe, eventEditorStore.get, eventEditorStore.get);
  const frameDraft = useSyncExternalStore(frameTextEditorStore.subscribe, frameTextEditorStore.get, frameTextEditorStore.get);
  const unsaved = isDirty(s, editor) || isFrameTextDirty(s, frameDraft);
  const [confirm, setConfirm] = useState(false);

  // Problems stay on screen until dismissed (like every other owner action); good news is already in the status line.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (u.error && u.error !== shown.current) notify('error', u.error);
    shown.current = u.error;
  }, [u.error, notify]);

  const status = describeStatus(u);
  const working = u.phase === 'checking' || u.phase === 'downloading' || u.phase === 'installing';
  const retryDownload = u.phase === 'error' && u.errorStep === 'download' && !!u.latest;
  const canDownload = u.phase === 'available' || retryDownload;
  const canInstall = u.phase === 'ready';
  const p = u.progress;
  const pct = p?.total ? Math.min(100, Math.floor((p.loaded / Math.max(1, p.total)) * 100)) : null;
  const showBar = u.phase === 'downloading' || u.phase === 'installing';
  // Notes of the update being offered; otherwise the notes of the version this booth runs now (compiled in, so they show without pressing CHECK).
  const incoming = (u.phase === 'available' || u.phase === 'downloading' || u.phase === 'ready' || u.phase === 'installing' || retryDownload) ? u.latest?.notes ?? null : null;
  const installedNotes = u.installed.notes?.trim() || null;

  const askInstall = () => {
    if (unsaved) { notify('error', 'SAVE OR CANCEL THE UNSAVED EVENT OR FRAME TEXT FIRST, THEN INSTALL. RESTARTING WOULD LOSE IT'); return; }
    setConfirm(true);
  };

  return (
    <>
      <Hint>Updates replace only the app files. Settings, the owner PIN, custom frames, event layouts, the standby photo and the save folder live on this device and are kept. Nothing is uninstalled. Downloading never interrupts a guest; installing restarts the booth once, so do it between guests.</Hint>
      <Version label="INSTALLED VERSION" version={showVersion(u.installed.version)} build={u.installed.build} date={fmtDate(u.installed.builtAt)} hint="The version this booth is running right now." />
      <Version label="LATEST AVAILABLE" version={u.latest ? showVersion(u.latest.version) : 'NOT CHECKED'} build={u.latest?.build} date={u.latest ? fmtDate(u.latest.builtAt) : ''} hint={u.checkedAt ? `Last checked ${fmtTime(u.checkedAt)}` : 'Press CHECK FOR UPDATES to read the update source.'} />
      <Row label="STATUS" stack>
        <p role={status.tone === 'alert' ? 'alert' : 'status'} className={status.tone === 'alert' ? 'adm-alert' : undefined} aria-live="polite">{status.text}</p>
        {showBar && (
          <div className="upd-bar" role="progressbar" aria-label="Update progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} data-indeterminate={pct === null || p?.stage === 'package' || u.phase === 'installing' ? 'true' : 'false'}>
            <i style={pct !== null && p?.stage === 'files' && u.phase === 'downloading' ? { width: `${pct}%` } : undefined} />
          </div>
        )}
        {u.phase === 'downloading' && p?.stage === 'files' && p.total === null && <p className="hint">{formatBytes(p.loaded)} DOWNLOADED</p>}
        {u.notice && u.phase !== 'current' && <p role="status">{u.notice}</p>}
      </Row>
      <Row label="ACTIONS" stack>
        <div className="upd-acts">
          <button type="button" className="btn ghost" disabled={working} onClick={() => void updater.check()}>CHECK FOR UPDATES</button>
          <button type="button" className="btn ghost" disabled={!canDownload} onClick={() => void updater.download()}>{retryDownload ? 'RETRY DOWNLOAD' : 'DOWNLOAD UPDATE'}</button>
          {u.phase === 'downloading' && <button type="button" className="btn ghost" onClick={() => updater.cancel()}>CANCEL DOWNLOAD</button>}
          <button type="button" className="btn" disabled={!canInstall} onClick={askInstall}>INSTALL AND RESTART</button>
        </div>
      </Row>
      {incoming ? <Row label="WHAT IS NEW IN THE UPDATE" stack><p className="upd-notes">{incoming}</p></Row>
        : installedNotes ? <Row label="WHAT IS NEW IN THIS VERSION" stack><p className="upd-notes">{installedNotes}</p></Row> : null}
      {confirm && (
        <ConfirmDialog title="INSTALL THE UPDATE?" body="THE BOOTH RESTARTS FOR A FEW SECONDS AND COMES BACK ON THE NEW VERSION. YOUR SETTINGS, FRAMES AND LAYOUTS ARE KEPT. DO THIS BETWEEN GUESTS."
          confirmLabel="INSTALL AND RESTART" onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); updater.install(); }} />
      )}
    </>
  );
}

function Source({ notify }: AdminCtx) {
  const [saved, setSaved] = useState(() => readSource());
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | undefined>();
  const fallback = buildDefaultSource();
  const changed = draft.trim() !== saved;

  const save = (raw: string) => {
    const v = validateSource(raw);
    if (!v.ok) { setError(v.error); return; }
    if (!writeSource(v.value)) { setError('THIS DEVICE REFUSED TO STORE THE ADDRESS'); notify('error', 'COULD NOT SAVE THE UPDATE SOURCE. THIS DEVICE REFUSED TO STORE IT'); return; }
    setError(undefined); setSaved(v.value); setDraft(v.value);
    updater.reset(); // the previous check belonged to the old address
    notify('success', isDefaultSource(v.value) ? 'UPDATE SOURCE SET TO THE DEFAULT' : 'UPDATE SOURCE SAVED. PRESS CHECK FOR UPDATES');
  };

  return (
    <>
      <Hint>The update source is the address of a version.json file. Every build publishes one next to the app, so the default (/version.json) always reads the site this booth runs from. Another site works only if it allows this site to read it. Installing always updates the site the booth was opened from.</Hint>
      <Row label="CURRENT SOURCE" stack><p className="upd-src" role="status">{saved}{isDefaultSource(saved) ? ' (DEFAULT)' : ' (CUSTOM)'}</p></Row>
      <TextField label="UPDATE SOURCE ADDRESS" hint="A path on this site such as /version.json, or a full https:// address." value={draft} inputMode="url" placeholder={fallback} error={error} onChange={(v) => { setDraft(v); setError(undefined); }} />
      {isForeignSource(draft.trim() || saved) && <Hint important>This address is on another site. CHECK will read it, but INSTALL can only update this booth from the site it was opened from. Use it only to watch a different deployment.</Hint>}
      <div className="upd-acts">
        <button type="button" className="btn ghost" disabled={!changed} onClick={() => save(draft)}>SAVE SOURCE</button>
        <button type="button" className="btn ghost" disabled={isDefaultSource(saved) && draft.trim() === saved} onClick={() => save(fallback)}>USE DEFAULT</button>
      </div>
    </>
  );
}

export const updatesSection: SectionDef = {
  id: 'updates',
  label: 'Updates',
  icon: 'retry',
  description: 'See which version this booth runs, check for a newer one and install it without uninstalling the app. Settings, frames and layouts are kept.',
  tabs: [{ id: 'check', label: 'Check for Updates' }, { id: 'source', label: 'Update Source' }],
  cards: [
    { id: 'updates-check', tab: 'check', title: 'Software version', keywords: ['update', 'updates', 'upgrade', 'version', 'check for updates', 'download update', 'install', 'restart', 'latest', 'installed', 'new version', 'release', 'patch', 'software', 'app', 'progress'], render: (c) => <Check {...c} /> },
    { id: 'updates-source', tab: 'source', title: 'Update source', keywords: ['update source', 'version.json', 'address', 'url', 'link', 'release', 'releases', 'github', 'server', 'publish', 'update url'], render: (c) => <Source {...c} /> }
  ]
};
