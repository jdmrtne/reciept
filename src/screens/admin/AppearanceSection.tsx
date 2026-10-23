import { useRef, useState } from 'react';
import { THEME_PREFS, type ThemePref, useTheme } from '../../theme/theme';
import { loadSettings } from '../../config/settings';
import { removeStandbyPhoto, storeStandbyPhoto, type PhotoFailure } from '../../lib/standbyPhoto';
import { useStandbyPhoto } from '../../hooks/useStandbyPhoto';
import { Icon } from '../../components/Icon';
import { ChoiceRow, ConfirmDialog, Hint, Row, SwitchRow } from './ui';
import type { AdminCtx, SectionDef } from './types';

const LABEL: Record<ThemePref, { label: string; icon: string }> = {
  light: { label: 'LIGHT', icon: 'sun' },
  dark: { label: 'DARK', icon: 'moon' },
  system: { label: 'SYSTEM', icon: 'monitor' }
};

function Theme({ notify }: AdminCtx) {
  const { pref, resolved, setPref } = useTheme();
  return (
    <>
      <ChoiceRow label="THEME" hint="Applies to the whole booth, including the screens customers see" value={pref}
        options={THEME_PREFS.map((p) => ({ value: p, label: LABEL[p].label, icon: LABEL[p].icon }))}
        onChange={(p) => { if (!setPref(p)) notify('error', 'THEME CHANGED, BUT THIS DEVICE WOULD NOT REMEMBER IT'); }} />
      <Hint>{pref === 'system' ? `SYSTEM follows this device\u2019s light/dark setting (it is ${resolved} now).` : `Saved on this device. Choose SYSTEM to follow the device setting instead.`} Receipts always print black on white, whatever the theme.</Hint>
    </>
  );
}

const PHOTO_FAIL: Record<PhotoFailure, string> = {
  unsupported: 'THAT FILE IS NOT A PICTURE \u2014 CHOOSE A JPG, PNG OR WEBP PHOTO',
  unreadable: 'COULD NOT READ THAT PHOTO \u2014 TRY ANOTHER ONE',
  'too-large': 'PHOTO IS TOO LARGE EVEN AFTER SHRINKING \u2014 TRY A SMALLER ONE',
  storage: 'THIS DEVICE WOULD NOT STORE THE PHOTO (STORAGE FULL OR BLOCKED)'
};

/** Custom standby photo. Only small metadata goes into the settings; the picture itself is kept by lib/standbyPhoto. */
function StandbyScreen({ s, set, notify }: AdminCtx) {
  const p = s.standbyPhoto;
  const thumb = useStandbyPhoto(p.enabled, p.version);
  const [working, setWorking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setWorking(true);
    try {
      const r = await storeStandbyPhoto(file);
      if (!r.ok) { notify('error', PHOTO_FAIL[r.reason]); return; }
      const cur = loadSettings().standbyPhoto; // fresh: the version must always move forward
      if (set({ standbyPhoto: { ...cur, enabled: true, version: cur.version + 1 } })) notify('success', 'STANDBY PHOTO SAVED \u2014 GUESTS SEE IT NOW');
    } finally { setWorking(false); }
  };
  const remove = async () => {
    setConfirming(false);
    setWorking(true);
    try {
      await removeStandbyPhoto();
      const cur = loadSettings().standbyPhoto;
      if (set({ standbyPhoto: { ...cur, enabled: false, version: cur.version + 1 } })) notify('success', 'STANDBY PHOTO REMOVED \u2014 BACK TO THE RECEIPT LOOK');
    } finally { setWorking(false); }
  };

  return (
    <>
      <Row label="STANDBY PHOTO" hint="Shown behind the TAP TO START screen. Saved on this device only." stack>
        {p.enabled && thumb && <img className="standby-thumb" src={thumb} alt="Current standby photo" />}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f); }} />
        <div className="test-actions">
          <button type="button" className="btn" disabled={working} onClick={() => fileRef.current?.click()}><Icon name="photo" />{working ? 'WORKING\u2026' : p.enabled ? 'CHANGE PHOTO' : 'UPLOAD PHOTO'}</button>
          {p.enabled && <button type="button" className="btn ghost" disabled={working} onClick={() => setConfirming(true)}><Icon name="trash" />REMOVE PHOTO</button>}
        </div>
      </Row>
      <ChoiceRow label="PHOTO FIT" hint="COVER fills the whole screen and may crop the edges. CONTAIN shows the whole photo." value={p.fit} disabled={!p.enabled}
        options={[{ value: 'cover', label: 'COVER' }, { value: 'contain', label: 'CONTAIN' }]} onChange={(fit) => { set({ standbyPhoto: { ...p, fit } }); }} />
      <SwitchRow label="SHOW RECEIPT OVER PHOTO" hint="OFF = photo only, with a small TAP TO START label at the bottom." checked={p.showReceipt} disabled={!p.enabled}
        onChange={(showReceipt) => { set({ standbyPhoto: { ...p, showReceipt } }); }} />
      <Hint>Use a photo at least 1080 px wide, in the same orientation as the kiosk screen. Owner access: tap the top-right corner of the standby screen 3 times quickly (or open /admin), then enter the PIN.</Hint>
      {confirming && <ConfirmDialog title="REMOVE STANDBY PHOTO?" body="Guests will see the normal receipt standby screen again. You can upload a photo again at any time." confirmLabel="REMOVE" danger onConfirm={() => { void remove(); }} onCancel={() => setConfirming(false)} />}
    </>
  );
}

export const appearanceSection: SectionDef = {
  id: 'appearance',
  label: 'Appearance',
  icon: 'contrast',
  description: 'Light or dark look, and the photo guests see on the standby screen.',
  cards: [
    { id: 'appearance-theme', title: 'Colour scheme', keywords: ['theme', 'dark mode', 'light mode', 'dark', 'light', 'system', 'appearance', 'colour', 'color', 'night', 'display', 'screen'], render: (c) => <Theme {...c} /> },
    { id: 'appearance-standby', title: 'Standby screen', description: 'Use your own photo as the idle screen.', keywords: ['standby', 'idle', 'wallpaper', 'background', 'photo', 'image', 'picture', 'welcome screen', 'home screen', 'upload', 'cover', 'contain', 'fit', 'tap to start', 'receipt over photo', 'screen saver'], render: (c) => <StandbyScreen {...c} /> }
  ]
};
