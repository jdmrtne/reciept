import { useCallback, useEffect, useState } from 'react';
import { chooseFolder, folderStatus, folderSupported, type FolderStatus } from '../../autosave/folder';
import { lastAutoSave, onAutoSave } from '../../autosave/autosave';
import { Hint, Row, SwitchRow } from './ui';
import type { AdminCtx, SectionDef } from './types';

const text = (f: FolderStatus | null) => !f ? 'CHECKING\u2026' : ({
  unsupported: 'NOT AVAILABLE \u2014 THIS BROWSER CANNOT SAVE TO A FOLDER',
  none: 'NO FOLDER CHOSEN',
  ready: f.s === 'ready' ? `${f.name} / MEMORYS \u2014 ACCESS GRANTED` : '',
  permission: f.s === 'permission' ? `${f.name} \u2014 PERMISSION NEEDED (TAP RE-GRANT)` : '',
  error: f.s === 'error' ? `${f.name || 'FOLDER'} \u2014 ${f.message}` : ''
} as const)[f.s];

function Toggles({ s, set }: AdminCtx) {
  return (
    <>
      <SwitchRow label="AUTO-SAVE IMAGES" hint="Save each finished photo (frame and MEMORYS branding included) to MEMORYS/Images" checked={s.autoSave.images} onChange={(v) => set({ autoSave: { ...s.autoSave, images: v } })} />
      <SwitchRow label="AUTO-SAVE GIFS" hint="Save each finished animated GIF to MEMORYS/GIFs" checked={s.autoSave.gifs} onChange={(v) => set({ autoSave: { ...s.autoSave, gifs: v } })} />
    </>
  );
}

function Folder({ s, notify }: AdminCtx) {
  const [st, setSt] = useState<FolderStatus | null>(null);
  const [, bump] = useState(0);
  const refresh = useCallback(() => { void folderStatus().then(setSt); }, []);
  useEffect(() => { refresh(); return onAutoSave(() => bump((n) => n + 1)); }, [refresh]);
  const pick = async () => {
    const r = await chooseFolder(); setSt(r);
    if (r.s === 'ready') notify('success', `SAVING TO ${r.name} / MEMORYS (IMAGES + GIFS FOLDERS READY)`);
    else if (r.s === 'error') notify('error', `FOLDER NOT SET: ${r.message}`);
  };
  const regrant = async () => { const r = await folderStatus(true); setSt(r); if (r.s !== 'ready') notify('error', 'PERMISSION WAS NOT GRANTED \u2014 AUTO-SAVE CANNOT WRITE UNTIL IT IS'); };
  const last = lastAutoSave(), anyOn = s.autoSave.images || s.autoSave.gifs;
  const bad = st && (st.s === 'unsupported' || st.s === 'permission' || st.s === 'error' || (st.s === 'none' && anyOn));
  return (
    <>
      {!folderSupported() && <Hint>This browser cannot write to a chosen folder (needs Chrome or Edge on HTTPS, installed or not). Auto-save will NOT save anything here; use the manual download buttons or the QR page instead. Nothing is reported as saved.</Hint>}
      <Row label="SAVE FOLDER" hint="Pick any folder; MEMORYS/Images and MEMORYS/GIFs are created inside it" stack>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn ghost" disabled={!folderSupported()} onClick={() => void pick()}>CHOOSE SAVE FOLDER</button>
          {st?.s === 'permission' && <button type="button" className="btn ghost" onClick={() => void regrant()}>RE-GRANT ACCESS</button>}
        </div>
      </Row>
      <Row label="STATUS" hint="Current folder and permission" stack><p role={bad ? 'alert' : 'status'} style={bad ? { fontWeight: 700 } : undefined}>{text(st)}</p></Row>
      {st?.s === 'none' && anyOn && <Hint>Auto-save is ON but no folder is chosen, so nothing is being saved.</Hint>}
      {last && <Row label="LAST SAVE" stack><p role="status">{last.ok ? `${last.kind === 'image' ? 'IMAGE' : 'GIF'} SAVED: ${last.detail}` : `${last.kind === 'image' ? 'IMAGE' : 'GIF'} NOT SAVED: ${last.detail}`}</p></Row>}
    </>
  );
}

export const autoSaveSection: SectionDef = {
  id: 'autosave',
  label: 'Auto-save',
  icon: 'save',
  description: 'Automatically keep a copy of every finished photo and GIF in a folder on this device. Changes apply immediately.',
  cards: [
    { id: 'autosave-toggles', title: 'What to save', keywords: ['auto-save', 'autosave', 'images', 'gifs', 'gif', 'photos', 'save', 'automatic', 'backup'], render: (c) => <Toggles {...c} /> },
    { id: 'autosave-folder', title: 'Save folder', description: 'Where the files go.', keywords: ['folder', 'directory', 'choose save folder', 'permission', 'location', 'path', 'save', 'storage', 'memorys'], render: (c) => <Folder {...c} /> }
  ]
};
